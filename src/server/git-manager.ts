/**
 * Server-side git manager — headless variant of the `git:*` IPC handlers at
 * `src/main/ipc/handlers/git.ts`.
 *
 * Ported for W3-git (closes the server half of `ISC-44.server.api_git_cluster`,
 * tracked under the umbrella `ISC-44.shim.big_3_ipc_strategy` in `ISA.md`).
 * Mirrors the precedents established by W2-wakatime / W2-stats / W2-fonts /
 * W3-fs / W3-agents:
 *
 *   1. **No `electron` import.** The renderer-side handler imports `electron`
 *      only for `ipcMain` / `BrowserWindow` (the worktree-discovered event
 *      fan-out). This server-side surface does NOT port the watcher — the
 *      headless server does not own a renderer window to broadcast to. A
 *      future brief MAY add WebSocket frames for worktree-discovered events;
 *      this brief is read-side only.
 *
 *   2. **No `src/main/utils/execFile` import.** The server tsconfig
 *      (`tsconfig.server.json`) does not include `src/main/utils/execFile.ts`
 *      (sentry.ts is included for the WebServer's import graph, but the
 *      execFile helper isn't, and pulling it in would drag the full
 *      `getShellPath` + `runtime/` graph along). A minimal inline shim with
 *      the same `execFileNoThrow(command, args, cwd, env?)` signature (return
 *      `{ stdout, stderr, exitCode }`, never throw) is provided here,
 *      matching the shim used in `agents-manager.ts` and `wakatime-manager.ts`.
 *
 *   3. **No `src/main/utils/logger` import.** Falls back to `console.*` with
 *      a `[Git]` prefix — matches the rest of `src/server/`, which standardizes
 *      on `console.log/warn/error` to avoid re-pulling the main-process logger
 *      graph (sentry → @sentry/electron) into the server's runtime path.
 *
 *   4. **Re-uses `src/shared/gitUtils` directly.** The shared utils module is
 *      already in the server tsconfig include set (`src/shared/**\/*.ts`). The
 *      parsing helpers (`parseGitBranches`, `parseGitTags`, `parseGitBehindAhead`,
 *      `countUncommittedChanges`, `isImageFile`, `getImageMimeType`) are pure
 *      string parsers — the "single source of truth" invariant is preserved.
 *
 *   5. **NO SSH remote dispatch.** The renderer-side handlers accept an
 *      optional `sshRemoteId` that proxies to `execGit` with an SSH config /
 *      `worktreeInfoRemote` / `worktreeSetupRemote` / etc. The server-side
 *      manager is strictly local. SSH-remote git is a sibling brief
 *      (`ISC-44.server.api_git_ssh_support`, open) — it wraps every git call
 *      via `wrapSpawnWithSsh` from `src/main/utils/ssh-spawn-wrapper.ts` which
 *      lives outside the server tsconfig include set and is significant
 *      enough to warrant its own brief. The route layer passes through any
 *      incoming `sshRemoteId` query param but returns 501 when one is present
 *      so callers don't silently get a local result when a remote was
 *      requested.
 *
 *   6. **NO `gh` CLI integration.** `git:createPR`, `git:checkGhCli`,
 *      `git:createGist`, and `git:getDefaultBranch` (the gh-touching half) are
 *      DEFERRED to a sibling brief — they need `resolveGhPath()` +
 *      `getShellPath()` + `getCachedGhStatus()` + Sentry-aware error paths,
 *      all of which pull in the runtime / utils graph. The browser-side need
 *      for those routes is also lower priority than the read-side (`isRepo`,
 *      `status`, `log`, etc.) which gates WizardResumeModal and
 *      DirectorySelectionScreen. Tracked as `ISC-44.server.api_git_gh_cli`
 *      (open).
 *
 *   7. **NO worktree watcher.** `git:watchWorktreeDirectory` /
 *      `git:unwatchWorktreeDirectory` / `git:onWorktreeDiscovered` are not
 *      ported. They depend on `chokidar` + a renderer event channel
 *      (`win.webContents.send('worktree:discovered', …)`); the equivalent in
 *      webFull would be a WebSocket frame. Tracked as
 *      `ISC-44.server.api_git_worktree_watcher` (open).
 *
 *   8. **NO `git:showFile` for image files.** The renderer-side handler uses
 *      `spawnSync('git', ['show', `${ref}:${filePath}`], {encoding: 'buffer'})`
 *      to capture raw binary content for images and returns a `data:` URL.
 *      This is a niche read path used by `ImageDiffViewer` (one component);
 *      the text-side fallback is also ported here. Tracked as
 *      `ISC-44.server.api_git_show_file_image` (open) for the image branch.
 *
 *   9. **Singleton accessor matches `FsManager` / `AgentsManager` patterns.**
 *      `getGitManager()` returns a cached instance; the constructor is
 *      parameterless (no settings store / app version needed — git ops are
 *      pure-subprocess). A `_resetGitManager()` test helper clears the cache
 *      for unit tests.
 *
 * `src/main/ipc/handlers/git.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to import from the main
 * variant. Both can run side by side in a hybrid (Electron + headless
 * sidecar) deployment because the underlying git repository on disk is the
 * cross-mode contract.
 */

import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import * as fsp from 'fs/promises';
import * as path from 'path';

import {
	parseGitBranches,
	parseGitTags,
	parseGitBehindAhead,
	countUncommittedChanges,
	isImageFile,
	getImageMimeType,
} from '../shared/gitUtils';

const LOG_CONTEXT = '[Git]';
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

/* ============ Inline execFile shim ============ */

const execFileAsync = promisify(execFile);

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | string;
}

/**
 * Minimal `execFileNoThrow` — never throws, returns `{ stdout, stderr, exitCode }`.
 * Matches the subset of `src/main/utils/execFile.ts` behavior this manager needs:
 * no stdin-input variant, no Windows-shell PATHEXT resolution (`git` is invoked
 * by name and resolved off `$PATH`).
 */
async function execFileNoThrow(
	command: string,
	args: string[] = [],
	cwd?: string
): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			cwd,
			encoding: 'utf8',
			maxBuffer: EXEC_MAX_BUFFER,
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (error: any) {
		return {
			stdout: error.stdout || '',
			stderr: error.stderr || error.message || '',
			exitCode: error.code ?? 1,
		};
	}
}

/* ============ Reply shapes ============ */

export interface StdoutStderrResult {
	stdout: string;
	stderr: string;
}

export interface GitInfoResult {
	branch: string;
	remote: string;
	behind: number;
	ahead: number;
	uncommittedChanges: number;
}

export interface GitLogEntry {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	refs: string[];
	subject: string;
	additions: number;
	deletions: number;
}

export interface GitLogResult {
	entries: GitLogEntry[];
	error: string | null;
}

export interface GitCommitCountResult {
	count: number;
	error: string | null;
}

export interface GitBranchesResult {
	branches: string[];
	stderr?: string;
}

export interface GitTagsResult {
	tags: string[];
	stderr?: string;
}

export interface GitShowFileResult {
	content?: string;
	error?: string;
}

export interface WorktreeInfoResult {
	exists: boolean;
	isWorktree?: boolean;
	currentBranch?: string;
	repoRoot?: string;
}

export interface WorktreeEntry {
	path: string;
	head: string;
	branch: string | null;
	isBare: boolean;
}

export interface WorktreeListResult {
	worktrees: WorktreeEntry[];
}

export interface GitSubdirEntry {
	path: string;
	name: string;
	isWorktree: boolean;
	branch: string | null;
	repoRoot: string | null;
}

export interface ScanWorktreeDirectoryResult {
	gitSubdirs: GitSubdirEntry[];
}

export interface GetRepoRootResult {
	root: string;
}

export interface GetDefaultBranchResult {
	branch: string;
}

/* ============ GitManager (server-side) ============ */

export class GitManager {
	/**
	 * Get git status in porcelain format. Matches `git:status` IPC reply shape.
	 */
	async status(cwd: string): Promise<StdoutStderrResult> {
		const result = await execFileNoThrow('git', ['status', '--porcelain'], cwd);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	/**
	 * Get git diff (whole repo or specific file). Matches `git:diff` IPC reply.
	 */
	async diff(cwd: string, file?: string): Promise<StdoutStderrResult> {
		const args = file ? ['diff', file] : ['diff'];
		const result = await execFileNoThrow('git', args, cwd);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	/**
	 * Check if a directory is inside a git work tree. Matches `git:isRepo`.
	 * Returns `false` when the path is not a repo OR when the path does not
	 * exist (the underlying `git rev-parse` exits non-zero in both cases).
	 */
	async isRepo(cwd: string): Promise<boolean> {
		const result = await execFileNoThrow('git', ['rev-parse', '--is-inside-work-tree'], cwd);
		return result.exitCode === 0;
	}

	/**
	 * Get `git diff --numstat`. Matches `git:numstat`.
	 */
	async numstat(cwd: string): Promise<StdoutStderrResult> {
		const result = await execFileNoThrow('git', ['diff', '--numstat'], cwd);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	/**
	 * Get current branch name. Matches `git:branch`.
	 */
	async branch(cwd: string): Promise<StdoutStderrResult> {
		const result = await execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
		return { stdout: result.stdout.trim(), stderr: result.stderr };
	}

	/**
	 * List all branches (local + remote, short format). Matches `git:branches`.
	 * Returns parsed branch list via the shared `parseGitBranches` util.
	 */
	async branches(cwd: string): Promise<GitBranchesResult> {
		const result = await execFileNoThrow('git', ['branch', '-a', '--format=%(refname:short)'], cwd);
		if (result.exitCode !== 0) {
			return { branches: [], stderr: result.stderr };
		}
		const branches = parseGitBranches(result.stdout);
		return { branches };
	}

	/**
	 * List all tags. Matches `git:tags`.
	 */
	async tags(cwd: string): Promise<GitTagsResult> {
		const result = await execFileNoThrow('git', ['tag', '--list'], cwd);
		if (result.exitCode !== 0) {
			return { tags: [], stderr: result.stderr };
		}
		const tags = parseGitTags(result.stdout);
		return { tags };
	}

	/**
	 * Get origin remote URL. Matches `git:remote`.
	 */
	async remote(cwd: string): Promise<StdoutStderrResult> {
		const result = await execFileNoThrow('git', ['remote', 'get-url', 'origin'], cwd);
		return { stdout: result.stdout.trim(), stderr: result.stderr };
	}

	/**
	 * Get comprehensive git info (branch + remote + behind/ahead + uncommitted)
	 * in a single call. Matches `git:info` — runs the four `git` invocations
	 * in parallel, then assembles the reply.
	 */
	async info(cwd: string): Promise<GitInfoResult> {
		const [branchResult, remoteResult, statusResult, behindAheadResult] = await Promise.all([
			execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
			execFileNoThrow('git', ['remote', 'get-url', 'origin'], cwd),
			execFileNoThrow('git', ['status', '--porcelain'], cwd),
			execFileNoThrow('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], cwd),
		]);

		const { behind, ahead } =
			behindAheadResult.exitCode === 0
				? parseGitBehindAhead(behindAheadResult.stdout)
				: { behind: 0, ahead: 0 };
		const uncommittedChanges = countUncommittedChanges(statusResult.stdout);

		return {
			branch: branchResult.stdout.trim(),
			remote: remoteResult.stdout.trim(),
			behind,
			ahead,
			uncommittedChanges,
		};
	}

	/**
	 * Get git log entries. Matches `git:log` byte-for-byte:
	 *   - `--max-count=<limit>` (default 100)
	 *   - `--pretty=format:COMMIT_START%H|%an|%ad|%D|%s`
	 *   - `--date=iso-strict`
	 *   - `--shortstat`
	 *   - optional `--grep=<search>` filter
	 *
	 * Entries are split on the COMMIT_START marker and each block's mainline +
	 * shortstat parsed into the reply shape.
	 */
	async log(cwd: string, options?: { limit?: number; search?: string }): Promise<GitLogResult> {
		const limit = options?.limit || 100;
		const args = [
			'log',
			`--max-count=${limit}`,
			'--pretty=format:COMMIT_START%H|%an|%ad|%D|%s',
			'--date=iso-strict',
			'--shortstat',
		];

		if (options?.search) {
			args.push('--all', `--grep=${options.search}`, '-i');
		}

		const result = await execFileNoThrow('git', args, cwd);
		if (result.exitCode !== 0) {
			return { entries: [], error: result.stderr };
		}

		const commits = result.stdout.split('COMMIT_START').filter((c) => c.trim());
		const entries: GitLogEntry[] = commits.map((commitBlock) => {
			const lines = commitBlock.split('\n').filter((l) => l.trim());
			const mainLine = lines[0];
			const [hash, author, date, refs, ...subjectParts] = mainLine.split('|');

			let additions = 0;
			let deletions = 0;
			const statLine = lines.find((l) => l.includes('changed'));
			if (statLine) {
				const addMatch = statLine.match(/(\d+) insertion/);
				const delMatch = statLine.match(/(\d+) deletion/);
				if (addMatch) additions = parseInt(addMatch[1], 10);
				if (delMatch) deletions = parseInt(delMatch[1], 10);
			}

			return {
				hash,
				shortHash: hash?.slice(0, 7),
				author,
				date,
				refs: refs ? refs.split(', ').filter((r) => r.trim()) : [],
				subject: subjectParts.join('|'),
				additions,
				deletions,
			};
		});

		return { entries, error: null };
	}

	/**
	 * Get total commit count for HEAD. Matches `git:commitCount`.
	 */
	async commitCount(cwd: string): Promise<GitCommitCountResult> {
		const result = await execFileNoThrow('git', ['rev-list', '--count', 'HEAD'], cwd);
		if (result.exitCode !== 0) {
			return { count: 0, error: result.stderr };
		}
		return { count: parseInt(result.stdout.trim(), 10) || 0, error: null };
	}

	/**
	 * Show a specific commit (stat + patch). Matches `git:show`.
	 */
	async show(cwd: string, hash: string): Promise<StdoutStderrResult> {
		const result = await execFileNoThrow('git', ['show', '--stat', '--patch', hash], cwd);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	/**
	 * Show file content at a specific ref. Matches `git:showFile` — for image
	 * files, captures raw binary via `spawnSync` and returns a `data:` URL; for
	 * text files, returns raw content.
	 */
	async showFile(cwd: string, ref: string, filePath: string): Promise<GitShowFileResult> {
		const ext = filePath.split('.').pop()!.toLowerCase();

		if (isImageFile(filePath)) {
			const result = spawnSync('git', ['show', `${ref}:${filePath}`], {
				cwd,
				encoding: 'buffer',
				maxBuffer: 50 * 1024 * 1024,
			});

			if (result.status !== 0) {
				return { error: result.stderr?.toString() || 'Failed to read file from git' };
			}

			const base64 = result.stdout.toString('base64');
			const mimeType = getImageMimeType(ext);
			return { content: `data:${mimeType};base64,${base64}` };
		}

		const result = await execFileNoThrow('git', ['show', `${ref}:${filePath}`], cwd);
		if (result.exitCode !== 0) {
			return { error: result.stderr || 'Failed to read file from git' };
		}
		return { content: result.stdout };
	}

	/**
	 * Get the root directory of the git repository. Matches `git:getRepoRoot`.
	 * Throws when the path is not a git repository so the route layer can
	 * surface a 400 / 404.
	 */
	async getRepoRoot(cwd: string): Promise<GetRepoRootResult> {
		const result = await execFileNoThrow('git', ['rev-parse', '--show-toplevel'], cwd);
		if (result.exitCode !== 0) {
			const err = new Error(result.stderr || 'Not a git repository');
			(err as any).notARepo = true;
			throw err;
		}
		return { root: result.stdout.trim() };
	}

	/**
	 * Get the default branch name (main / master). Matches `git:getDefaultBranch`.
	 * Tries `git remote show origin` first; falls back to local main / master
	 * existence checks. Throws when neither can be determined so the route
	 * layer can surface a 404.
	 */
	async getDefaultBranch(cwd: string): Promise<GetDefaultBranchResult> {
		const remoteResult = await execFileNoThrow('git', ['remote', 'show', 'origin'], cwd);
		if (remoteResult.exitCode === 0) {
			const match = remoteResult.stdout.match(/HEAD branch:\s*(\S+)/);
			if (match) {
				return { branch: match[1] };
			}
		}

		const mainResult = await execFileNoThrow('git', ['rev-parse', '--verify', 'main'], cwd);
		if (mainResult.exitCode === 0) {
			return { branch: 'main' };
		}

		const masterResult = await execFileNoThrow('git', ['rev-parse', '--verify', 'master'], cwd);
		if (masterResult.exitCode === 0) {
			return { branch: 'master' };
		}

		const err = new Error('Could not determine default branch');
		(err as any).notFound = true;
		throw err;
	}

	/**
	 * Get worktree information for a path. Matches `git:worktreeInfo`.
	 * Returns `{exists: false}` for missing paths and `{exists: true,
	 * isWorktree: false}` for non-git paths.
	 */
	async worktreeInfo(worktreePath: string): Promise<WorktreeInfoResult> {
		try {
			await fsp.access(worktreePath);
		} catch {
			return { exists: false, isWorktree: false };
		}

		const isInsideWorkTree = await execFileNoThrow(
			'git',
			['rev-parse', '--is-inside-work-tree'],
			worktreePath
		);
		if (isInsideWorkTree.exitCode !== 0) {
			return { exists: true, isWorktree: false };
		}

		const [gitDirResult, gitCommonDirResult, branchResult, repoRootResult] = await Promise.all([
			execFileNoThrow('git', ['rev-parse', '--git-dir'], worktreePath),
			execFileNoThrow('git', ['rev-parse', '--git-common-dir'], worktreePath),
			execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath),
			execFileNoThrow('git', ['rev-parse', '--show-toplevel'], worktreePath),
		]);

		if (gitDirResult.exitCode !== 0) {
			const err = new Error('Failed to get git directory');
			(err as any).gitDirFailed = true;
			throw err;
		}
		const gitDir = gitDirResult.stdout.trim();
		const gitCommonDir =
			gitCommonDirResult.exitCode === 0 ? gitCommonDirResult.stdout.trim() : gitDir;

		const isWorktree = gitDir !== gitCommonDir;
		const currentBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : undefined;

		let repoRoot: string | undefined;
		if (isWorktree && gitCommonDir) {
			const commonDirAbs = path.isAbsolute(gitCommonDir)
				? gitCommonDir
				: path.resolve(worktreePath, gitCommonDir);
			repoRoot = path.dirname(commonDirAbs);
		} else if (repoRootResult.exitCode === 0) {
			repoRoot = repoRootResult.stdout.trim();
		}

		return {
			exists: true,
			isWorktree,
			currentBranch,
			repoRoot,
		};
	}

	/**
	 * List all worktrees for a git repository. Matches `git:listWorktrees`.
	 * Returns `{worktrees: []}` when the path is not a git repo (matches the
	 * renderer-side fail-soft behavior).
	 */
	async listWorktrees(cwd: string): Promise<WorktreeListResult> {
		const result = await execFileNoThrow('git', ['worktree', 'list', '--porcelain'], cwd);
		if (result.exitCode !== 0) {
			return { worktrees: [] };
		}

		const worktrees: WorktreeEntry[] = [];
		const lines = result.stdout.split('\n');
		let current: {
			path?: string;
			head?: string;
			branch?: string | null;
			isBare?: boolean;
		} = {};

		for (const line of lines) {
			if (line.startsWith('worktree ')) {
				current.path = line.substring(9);
			} else if (line.startsWith('HEAD ')) {
				current.head = line.substring(5);
			} else if (line.startsWith('branch ')) {
				const branchRef = line.substring(7);
				current.branch = branchRef.replace('refs/heads/', '');
			} else if (line === 'bare') {
				current.isBare = true;
			} else if (line === 'detached') {
				current.branch = null;
			} else if (line === '' && current.path) {
				worktrees.push({
					path: current.path,
					head: current.head || '',
					branch: current.branch ?? null,
					isBare: current.isBare || false,
				});
				current = {};
			}
		}

		if (current.path) {
			worktrees.push({
				path: current.path,
				head: current.head || '',
				branch: current.branch ?? null,
				isBare: current.isBare || false,
			});
		}

		return { worktrees };
	}

	/**
	 * Scan a parent directory for sub-directories that are git repositories or
	 * worktrees. Matches `git:scanWorktreeDirectory`. Parallelizes the git
	 * queries across sub-directories to keep latency tractable on directories
	 * with many worktrees.
	 */
	async scanWorktreeDirectory(parentPath: string): Promise<ScanWorktreeDirectoryResult> {
		try {
			const entries = await fsp.readdir(parentPath, { withFileTypes: true });
			const subdirs = entries
				.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
				.map((e) => ({ name: e.name }));

			const results = await Promise.all(
				subdirs.map(async (subdir) => {
					const subdirPath = path.join(parentPath, subdir.name);

					const isInsideWorkTree = await execFileNoThrow(
						'git',
						['rev-parse', '--is-inside-work-tree'],
						subdirPath
					);
					if (isInsideWorkTree.exitCode !== 0) {
						return null;
					}

					const toplevelResult = await execFileNoThrow(
						'git',
						['rev-parse', '--show-toplevel'],
						subdirPath
					);
					if (toplevelResult.exitCode !== 0) {
						return null;
					}
					const toplevel = toplevelResult.stdout.trim();

					let normalizedSubdir = subdirPath;
					let normalizedToplevel = toplevel;
					[normalizedSubdir, normalizedToplevel] = await Promise.all([
						fsp.realpath(subdirPath).catch(() => path.resolve(subdirPath)),
						fsp.realpath(toplevel).catch(() => path.resolve(toplevel)),
					]);
					if (normalizedSubdir !== normalizedToplevel) {
						return null;
					}

					const [gitDirResult, gitCommonDirResult, branchResult] = await Promise.all([
						execFileNoThrow('git', ['rev-parse', '--git-dir'], subdirPath),
						execFileNoThrow('git', ['rev-parse', '--git-common-dir'], subdirPath),
						execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], subdirPath),
					]);

					const gitDir = gitDirResult.exitCode === 0 ? gitDirResult.stdout.trim() : '';
					const gitCommonDir =
						gitCommonDirResult.exitCode === 0 ? gitCommonDirResult.stdout.trim() : gitDir;
					const isWorktree = gitDir !== gitCommonDir;
					const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;

					let repoRoot: string | null = null;
					if (isWorktree && gitCommonDir) {
						const commonDirAbs = path.isAbsolute(gitCommonDir)
							? gitCommonDir
							: path.resolve(subdirPath, gitCommonDir);
						repoRoot = path.dirname(commonDirAbs);
					} else {
						const repoRootResult = await execFileNoThrow(
							'git',
							['rev-parse', '--show-toplevel'],
							subdirPath
						);
						if (repoRootResult.exitCode === 0) {
							repoRoot = repoRootResult.stdout.trim();
						}
					}

					return {
						path: subdirPath,
						name: subdir.name,
						isWorktree,
						branch,
						repoRoot,
					};
				})
			);

			const gitSubdirs = results.filter((r): r is NonNullable<typeof r> => r !== null);
			return { gitSubdirs };
		} catch (err) {
			console.error(`${LOG_CONTEXT} Failed to scan directory ${parentPath}: ${err}`);
			return { gitSubdirs: [] };
		}
	}
}

/* ============ Singleton accessor for the headless server ============ */

let gitManager: GitManager | null = null;

/**
 * Get-or-create the singleton GitManager for the headless server.
 *
 * Matches the `getHistoryManager()` / `getWakaTimeManager()` / `getStatsManager()`
 * / `getFontsManager()` / `getFsManager()` patterns. Parameterless because git
 * ops are pure-subprocess (no config / DB / network).
 */
export function getGitManager(): GitManager {
	if (!gitManager) {
		gitManager = new GitManager();
	}
	return gitManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetGitManager(): void {
	gitManager = null;
}
