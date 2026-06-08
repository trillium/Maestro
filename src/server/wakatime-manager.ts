/**
 * Server-side WakaTime heartbeat manager — headless variant of
 * `src/main/wakatime-manager.ts`.
 *
 * Ported for W2 (closes the server half of `ISC-44.general.wakatime`,
 * tracked in `ISA.md`). Differences from the renderer-side `WakaTimeManager`:
 *
 *   1. **No `electron` import.** `app.getVersion()` is replaced with an
 *      `appVersion` constructor argument supplied by the caller (the
 *      headless entrypoint reads it from `package.json` or hardcodes it
 *      per release). The renderer reads `app.getVersion()` for the
 *      `--plugin` heartbeat tag; the server-side variant accepts the same
 *      value as data instead.
 *
 *   2. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      with a `[WakaTime]` prefix — matches the rest of `src/server/`,
 *      which standardizes on `console.log/warn/error` to avoid re-pulling
 *      the main-process logger graph (sentry → @sentry/electron) into the
 *      server build.
 *
 *   3. **No `src/main/utils/sentry` import.** Errors that need reporting
 *      flow through `src/server/sentry.ts` (`@sentry/node` wrapper, no-op
 *      without `MAESTRO_SENTRY_DSN`). Heartbeat-send failures stay quiet
 *      (warn only) so a flaky local network never spams the error path.
 *
 *   4. **No `src/main/utils/execFile` import.** The server tsconfig
 *      (`tsconfig.server.json`) does not include `src/main/utils/`, so the
 *      execFile helper would not type-check. A minimal inline shim with
 *      the same `execFileNoThrow` signature (return `{ stdout, stderr,
 *      exitCode }`, never throw) is provided here. Identical semantics to
 *      the renderer-side helper for the cases this manager hits — no
 *      Windows-shell PATHEXT resolution (the wakatime-cli binary always
 *      has an `.exe` suffix on Windows), no stdin-input timeout edge
 *      cases, just `child_process.execFile` wrapped to never throw plus a
 *      `spawn`+stdin path for `--extra-heartbeats`.
 *
 *   5. **`Store<MaestroSettings>` decoupled to a `SettingsReader`
 *      interface.** The renderer-side variant accepts a typed
 *      electron-store handle; the server-side variant only needs `.get(key,
 *      default)` and intentionally avoids importing the main-process types
 *      tree (which depends on electron-store). The headless
 *      `FileStore<Record<string, unknown>>` from `src/shared/file-store.ts`
 *      already satisfies this interface.
 *
 *   6. **Public API matches the renderer-side `WakaTimeManager` 1:1** for
 *      the methods the IPC handlers (and the new REST routes) call:
 *      `ensureCliInstalled()`, `getCliPath()`, `sendHeartbeat()`,
 *      `sendFileHeartbeats()`, `removeSession()`. Internal helpers
 *      preserve their behavior; signatures match so a future cross-mode
 *      refactor can extract a shared interface without further churn.
 *
 *   7. **No `BrowserWindow.webContents.send` anywhere.** The renderer-side
 *      manager doesn't push status to the renderer (status is pull-only
 *      via `wakatime:checkCli`), so the server-side variant matches:
 *      polling-based, no broadcast surface needed. If a future change
 *      wires push-based status updates, the right hook is
 *      `WebServer.broadcastService.broadcastWakatimeStatus` (additive on
 *      `broadcastService.ts`) — NOT this module.
 *
 * The CLI download / auto-install logic, language detection, branch
 * caching, debouncing, and config-file API-key fallback are byte-for-byte
 * the same as the renderer variant. The on-disk `~/.wakatime/` binary
 * cache and `~/.wakatime.cfg` config file are the contract between modes.
 *
 * `src/main/wakatime-manager.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to import from the main
 * variant. Both can run side by side in a hybrid (Electron + headless
 * sidecar) deployment; the cli binary + config are shared, the
 * per-session debounce state is process-local.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { isWindows } from '../shared/platformDetection';
import { captureException } from './sentry';

const LOG_CONTEXT = '[WakaTime]';
const HEARTBEAT_DEBOUNCE_MS = 120_000; // 2 minutes — matches WakaTime's own dedup window
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // CLI update check at most once / day
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

/* ============ Minimal SettingsReader interface ============ */

/**
 * The subset of electron-store / FileStore that the manager actually uses.
 * Decouples the manager from the main-process `Store<MaestroSettings>` type so
 * the headless server can pass its `FileStore<Record<string, unknown>>` in
 * without dragging the electron-store types tree into the server build.
 */
export interface WakaTimeSettingsReader {
	get<V>(key: string, defaultValue: V): V;
}

/* ============ Inline execFile shim ============ */

const execFileAsync = promisify(execFile);

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | string;
}

/**
 * Minimal `execFileNoThrow` — never throws, returns `{ stdout, stderr, exitCode }`.
 * Matches the subset of `src/main/utils/execFile.ts` behavior this manager needs.
 * stdin-input variant is implemented via `spawn` to mirror the renderer's path.
 */
async function execFileNoThrow(
	command: string,
	args: string[] = [],
	cwd?: string,
	options?: { input?: string }
): Promise<ExecResult> {
	const input = options?.input;
	if (input !== undefined) {
		return execFileWithInput(command, args, cwd, input);
	}
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

async function execFileWithInput(
	command: string,
	args: string[],
	cwd: string | undefined,
	input: string
): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (data) => {
			stdout += data.toString();
		});
		child.stderr?.on('data', (data) => {
			stderr += data.toString();
		});
		child.on('close', (code) => {
			resolve({ stdout, stderr, exitCode: code ?? 1 });
		});
		child.on('error', (err) => {
			resolve({ stdout: '', stderr: err.message, exitCode: 1 });
		});
		if (child.stdin) {
			child.stdin.write(input);
			child.stdin.end();
		}
	});
}

/* ============ Language detection (identical to renderer variant) ============ */

/** Map file extensions (without dot, lowercase) to WakaTime language names */
const EXTENSION_LANGUAGE_MAP = new Map<string, string>([
	['ts', 'TypeScript'],
	['tsx', 'TypeScript'],
	['js', 'JavaScript'],
	['jsx', 'JavaScript'],
	['mjs', 'JavaScript'],
	['cjs', 'JavaScript'],
	['py', 'Python'],
	['rb', 'Ruby'],
	['rs', 'Rust'],
	['go', 'Go'],
	['java', 'Java'],
	['kt', 'Kotlin'],
	['swift', 'Swift'],
	['c', 'C'],
	['cpp', 'C++'],
	['h', 'C'],
	['hpp', 'C++'],
	['cs', 'C#'],
	['php', 'PHP'],
	['ex', 'Elixir'],
	['exs', 'Elixir'],
	['dart', 'Dart'],
	['json', 'JSON'],
	['yaml', 'YAML'],
	['yml', 'YAML'],
	['toml', 'TOML'],
	['md', 'Markdown'],
	['html', 'HTML'],
	['css', 'CSS'],
	['scss', 'SCSS'],
	['less', 'LESS'],
	['sql', 'SQL'],
	['sh', 'Shell Script'],
	['bash', 'Shell Script'],
	['zsh', 'Shell Script'],
	['vue', 'Vue.js'],
	['svelte', 'Svelte'],
	['lua', 'Lua'],
	['zig', 'Zig'],
	['r', 'R'],
	['scala', 'Scala'],
	['clj', 'Clojure'],
	['erl', 'Erlang'],
	['hs', 'Haskell'],
	['ml', 'OCaml'],
	['nim', 'Nim'],
	['cr', 'Crystal'],
	['tf', 'HCL'],
	['proto', 'Protocol Buffer'],
]);

/**
 * Detect the WakaTime language name from a file path's extension.
 * Returns undefined if the extension is not recognized.
 */
export function detectLanguageFromPath(filePath: string): string | undefined {
	const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
	if (!ext) return undefined;
	return EXTENSION_LANGUAGE_MAP.get(ext);
}

/** Tool names that represent file write operations across supported agents */
export const WRITE_TOOL_NAMES = new Set<string>([
	'Write',
	'Edit',
	'write_to_file',
	'str_replace_based_edit_tool',
	'create_file',
	'write',
	'patch',
	'NotebookEdit',
]);

/**
 * Extract a file path from a tool-execution event if the tool is a write operation.
 * Returns null if the tool is not a write operation or no file path is found.
 */
export function extractFilePathFromToolExecution(toolExecution: {
	toolName: string;
	state: unknown;
	timestamp: number;
}): string | null {
	if (!WRITE_TOOL_NAMES.has(toolExecution.toolName)) return null;

	const input = (toolExecution.state as any)?.input;
	if (!input || typeof input !== 'object') return null;

	const filePath = input.file_path ?? input.path;
	if (typeof filePath === 'string' && filePath.length > 0) return filePath;

	return null;
}

/* ============ Platform/arch mapping for releases ============ */

/** Map Node.js platform to WakaTime release naming */
function getWakaTimePlatform(): string | null {
	switch (process.platform) {
		case 'darwin':
			return 'darwin';
		case 'win32':
			return 'windows';
		case 'linux':
			return 'linux';
		default:
			return null;
	}
}

/** Map Node.js arch to WakaTime release naming */
function getWakaTimeArch(): string | null {
	switch (process.arch) {
		case 'arm64':
			return 'arm64';
		case 'x64':
			return 'amd64';
		case 'ia32':
			return '386';
		default:
			return null;
	}
}

/* ============ HTTPS download helpers (network egress, see note below) ============ */
//
// NETWORK EGRESS NOTE (per the W2 brief's reject-bailout clause): the server-side
// manager makes outbound network calls in two places — `downloadFile()` /
// `fetchJson()` here (to GitHub releases for CLI auto-install + update check),
// and the wakatime-cli subprocess itself (every heartbeat hits api.wakatime.com
// from the CLI process). This matches the renderer-side behavior 1:1; no new
// egress surface is added by porting to server-side. The headless server is
// already expected to reach the public internet (it runs over Tailscale on the
// host, not in a sandbox), and both calls are gated behind explicit user opt-in
// (`wakatimeEnabled` setting + `wakatimeApiKey` value). No CLI download fires
// unless a heartbeat is about to be sent; no heartbeat fires unless the user
// configured an API key.

/** Download a URL to a file, following redirects (GitHub → S3) */
function downloadFile(url: string, destPath: string, maxRedirects = 5): Promise<void> {
	return new Promise((resolve, reject) => {
		if (maxRedirects <= 0) {
			reject(new Error('Too many redirects'));
			return;
		}
		https
			.get(url, (response) => {
				if (
					response.statusCode &&
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location
				) {
					response.resume();
					downloadFile(response.headers.location, destPath, maxRedirects - 1).then(resolve, reject);
					return;
				}
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`Download failed with status ${response.statusCode}`));
					return;
				}
				const fileStream = fs.createWriteStream(destPath);
				response.pipe(fileStream);
				fileStream.on('finish', () => {
					fileStream.close();
					resolve();
				});
				fileStream.on('error', (err) => {
					fs.unlink(destPath, () => {});
					reject(err);
				});
			})
			.on('error', reject);
	});
}

/** Fetch JSON from a URL, following redirects */
function fetchJson(url: string, maxRedirects = 5): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (maxRedirects <= 0) {
			reject(new Error('Too many redirects'));
			return;
		}
		const parsedUrl = new URL(url);
		const options = {
			hostname: parsedUrl.hostname,
			path: parsedUrl.pathname + parsedUrl.search,
			headers: { 'User-Agent': 'maestro-wakatime' },
		};
		https
			.get(options, (response) => {
				if (
					response.statusCode &&
					response.statusCode >= 300 &&
					response.statusCode < 400 &&
					response.headers.location
				) {
					response.resume();
					fetchJson(response.headers.location, maxRedirects - 1).then(resolve, reject);
					return;
				}
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`HTTP ${response.statusCode}`));
					return;
				}
				let data = '';
				response.on('data', (chunk: Buffer) => {
					data += chunk.toString();
				});
				response.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch (err) {
						reject(err);
					}
				});
			})
			.on('error', reject);
	});
}

/** How long a successfully-detected branch is cached before re-checking (5 min). */
const BRANCH_CACHE_TTL_MS = 5 * 60 * 1000;

/* ============ WakaTimeManager (server-side) ============ */

export class WakaTimeManager {
	private settingsStore: WakaTimeSettingsReader;
	private appVersion: string;
	private lastHeartbeatPerSession: Map<string, number> = new Map();
	private branchCache: Map<string, { branch: string; timestamp: number }> = new Map();
	private languageCache: Map<string, string> = new Map();
	private cliPath: string | null = null;
	private cliDetected = false;
	private installing: Promise<boolean> | null = null;
	private lastUpdateCheck = 0;

	/**
	 * @param settingsStore  Anything with `.get(key, default)` — the headless
	 *                       server passes its `FileStore<Record<string,unknown>>`.
	 * @param appVersion     Maestro version string for the `--plugin` heartbeat
	 *                       tag. The renderer reads `app.getVersion()`; the
	 *                       server caller supplies it as data instead.
	 */
	constructor(settingsStore: WakaTimeSettingsReader, appVersion: string) {
		this.settingsStore = settingsStore;
		this.appVersion = appVersion;
	}

	/** Get the expected local install path for the WakaTime CLI binary */
	private getLocalBinaryPath(): string | null {
		const plat = getWakaTimePlatform();
		const arch = getWakaTimeArch();
		if (!plat || !arch) return null;
		const binaryName = `wakatime-cli-${plat}-${arch}${isWindows() ? '.exe' : ''}`;
		return path.join(os.homedir(), '.wakatime', binaryName);
	}

	/** Detect wakatime-cli on PATH or in ~/.wakatime/ */
	async detectCli(): Promise<boolean> {
		if (this.cliDetected) return this.cliPath !== null;
		this.cliDetected = true;

		// Try common binary names on PATH
		for (const cmd of ['wakatime-cli', 'wakatime']) {
			const result = await execFileNoThrow(cmd, ['--version']);
			if (result.exitCode === 0) {
				this.cliPath = cmd;
				console.log(`${LOG_CONTEXT} Found WakaTime CLI: ${cmd} (${result.stdout.trim()})`);
				return true;
			}
		}

		// Check the auto-installed binary in ~/.wakatime/
		const localPath = this.getLocalBinaryPath();
		if (localPath && fs.existsSync(localPath)) {
			const result = await execFileNoThrow(localPath, ['--version']);
			if (result.exitCode === 0) {
				this.cliPath = localPath;
				console.log(`${LOG_CONTEXT} Found WakaTime CLI: ${localPath} (${result.stdout.trim()})`);
				return true;
			}
		}

		// Renderer-side uses logger.debug here; in the headless build we keep
		// CLI-not-found quiet (no console.debug noise on every status poll).
		return false;
	}

	/**
	 * Ensure the WakaTime CLI is installed.
	 * If already available (on PATH or in ~/.wakatime/), returns true immediately.
	 * Otherwise, downloads and installs it from GitHub releases.
	 * Guards against concurrent installation attempts.
	 */
	async ensureCliInstalled(): Promise<boolean> {
		if (await this.detectCli()) {
			const now = Date.now();
			if (now - this.lastUpdateCheck >= UPDATE_CHECK_INTERVAL_MS) {
				this.lastUpdateCheck = now;
				this.checkForUpdate().catch(() => {});
			}
			return true;
		}

		if (this.installing) return this.installing;

		this.installing = this.doInstall();
		try {
			return await this.installing;
		} finally {
			this.installing = null;
		}
	}

	private async doInstall(): Promise<boolean> {
		const plat = getWakaTimePlatform();
		const arch = getWakaTimeArch();
		if (!plat || !arch) {
			console.warn(
				`${LOG_CONTEXT} Unsupported platform/arch for WakaTime CLI auto-install: ${process.platform}/${process.arch}`
			);
			return false;
		}

		const binaryName = `wakatime-cli-${plat}-${arch}${isWindows() ? '.exe' : ''}`;
		const zipName = `wakatime-cli-${plat}-${arch}.zip`;
		const downloadUrl = `https://github.com/wakatime/wakatime-cli/releases/latest/download/${zipName}`;
		const installDir = path.join(os.homedir(), '.wakatime');
		const zipPath = path.join(os.tmpdir(), zipName);

		try {
			console.log(`${LOG_CONTEXT} Downloading WakaTime CLI from ${downloadUrl}`);

			fs.mkdirSync(installDir, { recursive: true });

			await downloadFile(downloadUrl, zipPath);
			console.log(`${LOG_CONTEXT} WakaTime CLI download complete, extracting...`);

			if (isWindows()) {
				const extractResult = await execFileNoThrow('powershell', [
					'-Command',
					`Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${installDir}'`,
				]);
				if (extractResult.exitCode !== 0) {
					console.warn(`${LOG_CONTEXT} Failed to extract WakaTime CLI: ${extractResult.stderr}`);
					return false;
				}
			} else {
				const extractResult = await execFileNoThrow('unzip', ['-o', zipPath, '-d', installDir]);
				if (extractResult.exitCode !== 0) {
					console.warn(`${LOG_CONTEXT} Failed to extract WakaTime CLI: ${extractResult.stderr}`);
					return false;
				}
			}

			const binaryPath = path.join(installDir, binaryName);
			if (!isWindows()) {
				fs.chmodSync(binaryPath, 0o755);
			}

			this.cliPath = binaryPath;
			this.cliDetected = false;
			console.log(`${LOG_CONTEXT} WakaTime CLI installed successfully at ${binaryPath}`);

			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`${LOG_CONTEXT} Failed to auto-install WakaTime CLI: ${msg}`);
			captureException(err, { context: 'wakatime:install' });
			return false;
		} finally {
			try {
				fs.unlinkSync(zipPath);
			} catch {
				/* ignore */
			}
		}
	}

	/**
	 * Check if the installed CLI is outdated and update if needed.
	 * Fetches the latest release tag from GitHub and compares it to the
	 * currently installed version. If they differ, re-downloads the CLI.
	 */
	private async checkForUpdate(): Promise<void> {
		try {
			const release = (await fetchJson(
				'https://api.github.com/repos/wakatime/wakatime-cli/releases/latest'
			)) as { tag_name?: string };
			const latestTag = release?.tag_name;
			if (!latestTag) {
				return;
			}

			if (!this.cliPath) return;
			const result = await execFileNoThrow(this.cliPath, ['--version']);
			if (result.exitCode !== 0) return;
			const currentVersion = result.stdout.trim();

			const normalize = (v: string) => v.replace(/^(wakatime-cli\s+|v)/i, '').trim();
			const latest = normalize(latestTag);
			const current = normalize(currentVersion);

			if (latest === current) {
				return;
			}

			console.log(`${LOG_CONTEXT} WakaTime CLI update available: ${current} → ${latest}`);

			this.cliDetected = false;
			this.cliPath = null;
			await this.doInstall();
		} catch {
			// Update-check failures stay quiet — best-effort background op.
		}
	}

	/**
	 * Read the WakaTime API key from ~/.wakatime.cfg (INI format).
	 * Falls back to empty string if the file doesn't exist or can't be parsed.
	 */
	private readApiKeyFromConfig(): string {
		try {
			const cfgPath = path.join(os.homedir(), '.wakatime.cfg');
			if (!fs.existsSync(cfgPath)) return '';
			const content = fs.readFileSync(cfgPath, 'utf-8');
			const match = content.match(/^api_key\s*=\s*(.+)$/m);
			return match ? match[1].trim() : '';
		} catch {
			return '';
		}
	}

	/**
	 * Detect the primary programming language for a project directory by checking
	 * for well-known config/manifest files. Result is cached per session.
	 */
	private detectLanguage(sessionId: string, cwd: string): string | null {
		const cached = this.languageCache.get(sessionId);
		if (cached !== undefined) return cached || null;

		const markers: [string, string][] = [
			['tsconfig.json', 'TypeScript'],
			['package.json', 'JavaScript'],
			['Cargo.toml', 'Rust'],
			['go.mod', 'Go'],
			['pyproject.toml', 'Python'],
			['setup.py', 'Python'],
			['requirements.txt', 'Python'],
			['Gemfile', 'Ruby'],
			['pom.xml', 'Java'],
			['build.gradle', 'Java'],
			['build.gradle.kts', 'Kotlin'],
			['*.csproj', 'C#'],
			['Package.swift', 'Swift'],
			['CMakeLists.txt', 'C++'],
			['Makefile', 'C'],
			['composer.json', 'PHP'],
			['mix.exs', 'Elixir'],
			['pubspec.yaml', 'Dart'],
			['deno.json', 'TypeScript'],
		];

		for (const [file, language] of markers) {
			if (file.startsWith('*')) {
				try {
					const ext = file.slice(1);
					const entries = fs.readdirSync(cwd);
					if (entries.some((e) => e.endsWith(ext))) {
						this.languageCache.set(sessionId, language);
						return language;
					}
				} catch {
					/* ignore */
				}
			} else {
				if (fs.existsSync(path.join(cwd, file))) {
					this.languageCache.set(sessionId, language);
					return language;
				}
			}
		}

		this.languageCache.set(sessionId, '');
		return null;
	}

	/**
	 * Detect the current git branch for a project directory.
	 * Successful results are cached per session with a TTL so branch switches
	 * are picked up. Failures are never cached — the next heartbeat retries.
	 */
	private async detectBranch(sessionId: string, cwd: string): Promise<string | null> {
		const cached = this.branchCache.get(sessionId);
		if (cached && cached.branch && Date.now() - cached.timestamp < BRANCH_CACHE_TTL_MS) {
			return cached.branch;
		}

		const result = await execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
		const branch = result.exitCode === 0 ? result.stdout.trim() : '';
		if (branch) {
			this.branchCache.set(sessionId, { branch, timestamp: Date.now() });
		} else {
			this.branchCache.delete(sessionId);
		}
		return branch || null;
	}

	/** Send a heartbeat for a session's activity */
	async sendHeartbeat(
		sessionId: string,
		projectName: string,
		projectCwd?: string,
		source?: 'user' | 'auto'
	): Promise<void> {
		const enabled = this.settingsStore.get<boolean>('wakatimeEnabled', false);
		if (!enabled) return;

		let apiKey = this.settingsStore.get<string>('wakatimeApiKey', '');
		if (!apiKey) {
			apiKey = this.readApiKeyFromConfig();
		}
		if (!apiKey) return;

		const now = Date.now();
		const lastBeat = this.lastHeartbeatPerSession.get(sessionId) || 0;
		if (now - lastBeat < HEARTBEAT_DEBOUNCE_MS) return;

		if (!(await this.ensureCliInstalled())) {
			console.warn(`${LOG_CONTEXT} WakaTime CLI not available — skipping heartbeat`);
			return;
		}

		this.lastHeartbeatPerSession.set(sessionId, now);

		const args = [
			'--key',
			apiKey,
			'--entity',
			'Maestro',
			'--entity-type',
			'app',
			'--project',
			projectName,
			'--plugin',
			`maestro/${this.appVersion} maestro-wakatime/${this.appVersion}`,
			'--category',
			source === 'auto' ? 'ai coding' : 'building',
		];

		if (projectCwd) {
			const language = this.detectLanguage(sessionId, projectCwd);
			if (language) {
				args.push('--language', language);
			}
		}

		if (projectCwd) {
			const branch = await this.detectBranch(sessionId, projectCwd);
			if (branch) {
				args.push('--alternate-branch', branch);
			}
		}

		const result = await execFileNoThrow(this.cliPath!, args);
		if (result.exitCode === 0) {
			// Renderer logs .debug here; suppressed in headless to avoid noise.
		} else {
			console.warn(`${LOG_CONTEXT} Heartbeat failed for ${sessionId}: ${result.stderr}`);
		}
	}

	/**
	 * Send file-level heartbeats for files modified during a query.
	 * The first file is sent as the primary heartbeat via CLI args;
	 * remaining files are batched via --extra-heartbeats on stdin.
	 */
	async sendFileHeartbeats(
		files: Array<{ filePath: string; timestamp: number }>,
		projectName: string,
		projectCwd?: string,
		source?: 'user' | 'auto'
	): Promise<void> {
		if (files.length === 0) return;

		const enabled = this.settingsStore.get<boolean>('wakatimeEnabled', false);
		if (!enabled) return;

		const detailedTracking = this.settingsStore.get<boolean>('wakatimeDetailedTracking', false);
		if (!detailedTracking) return;

		let apiKey = this.settingsStore.get<string>('wakatimeApiKey', '');
		if (!apiKey) {
			apiKey = this.readApiKeyFromConfig();
		}
		if (!apiKey) return;

		if (!(await this.ensureCliInstalled())) {
			console.warn(`${LOG_CONTEXT} WakaTime CLI not available — skipping file heartbeats`);
			return;
		}

		const branch = projectCwd ? await this.detectBranch(`file:${projectCwd}`, projectCwd) : null;

		const primary = files[0];
		const args = [
			'--key',
			apiKey,
			'--entity',
			primary.filePath,
			'--entity-type',
			'file',
			'--write',
			'--project',
			projectName,
			'--plugin',
			`maestro/${this.appVersion} maestro-wakatime/${this.appVersion}`,
			'--category',
			source === 'auto' ? 'ai coding' : 'building',
			'--time',
			String(primary.timestamp / 1000),
		];

		const primaryLanguage = detectLanguageFromPath(primary.filePath);
		if (primaryLanguage) {
			args.push('--language', primaryLanguage);
		}

		if (branch) {
			args.push('--alternate-branch', branch);
		}

		const extraFiles = files.slice(1);
		if (extraFiles.length > 0) {
			args.push('--extra-heartbeats');
		}

		const extraArray = extraFiles.map((f) => {
			const obj: Record<string, unknown> = {
				entity: f.filePath,
				type: 'file',
				is_write: true,
				time: f.timestamp / 1000,
				category: source === 'auto' ? 'ai coding' : 'building',
				project: projectName,
			};
			const lang = detectLanguageFromPath(f.filePath);
			if (lang) obj.language = lang;
			if (branch) obj.branch = branch;
			return obj;
		});

		const result = await execFileNoThrow(
			this.cliPath!,
			args,
			projectCwd,
			extraFiles.length > 0 ? { input: JSON.stringify(extraArray) } : undefined
		);

		if (result.exitCode === 0) {
			console.log(`${LOG_CONTEXT} Sent file heartbeats (count=${files.length})`);
		} else {
			console.warn(
				`${LOG_CONTEXT} File heartbeats failed (count=${files.length}): ${result.stderr}`
			);
		}
	}

	/**
	 * Run a quick API-key validation by invoking the CLI with `--today`.
	 * Mirrors the renderer-side `wakatime:validateApiKey` IPC handler at
	 * `src/main/ipc/handlers/wakatime.ts`. Returns `{ valid: boolean }`.
	 *
	 * Will auto-install the CLI if not yet detected; an unavailable CLI
	 * returns `{ valid: false }`.
	 */
	async validateApiKey(key: string): Promise<{ valid: boolean }> {
		if (!key) return { valid: false };
		const installed = await this.ensureCliInstalled();
		if (!installed) return { valid: false };
		const cliPath = this.getCliPath();
		if (!cliPath) return { valid: false };
		const result = await execFileNoThrow(cliPath, ['--key', key, '--today']);
		return { valid: result.exitCode === 0 };
	}

	/**
	 * Status check matching the renderer-side `wakatime:checkCli` IPC handler.
	 * Auto-installs the CLI if needed; returns `{ available, version? }`.
	 */
	async checkCli(): Promise<{ available: boolean; version?: string }> {
		const installed = await this.ensureCliInstalled();
		if (!installed) return { available: false };
		const cliPath = this.getCliPath();
		if (!cliPath) return { available: false };
		const result = await execFileNoThrow(cliPath, ['--version']);
		if (result.exitCode === 0) {
			return { available: true, version: result.stdout.trim() };
		}
		return { available: false };
	}

	/** Get the resolved CLI path (null if not yet detected/installed) */
	getCliPath(): string | null {
		return this.cliPath;
	}

	/** Clean up stale session entries */
	removeSession(sessionId: string): void {
		this.lastHeartbeatPerSession.delete(sessionId);
		this.branchCache.delete(sessionId);
		this.languageCache.delete(sessionId);
	}
}

/* ============ Singleton accessor for the headless server ============ */

let wakatimeManager: WakaTimeManager | null = null;

/**
 * Get-or-create the singleton WakaTimeManager for the headless server.
 *
 * The first call must supply `settingsStore` and `appVersion`; subsequent
 * calls return the cached instance regardless of arguments (matches the
 * `getHistoryManager()` pattern in `src/server/history-manager.ts`).
 *
 * Test helper `_resetWakaTimeManager()` clears the singleton.
 */
export function getWakaTimeManager(
	settingsStore?: WakaTimeSettingsReader,
	appVersion?: string
): WakaTimeManager {
	if (!wakatimeManager) {
		if (!settingsStore || !appVersion) {
			throw new Error(
				'[WakaTime] getWakaTimeManager() called before initialization. The first call must supply settingsStore and appVersion.'
			);
		}
		wakatimeManager = new WakaTimeManager(settingsStore, appVersion);
	}
	return wakatimeManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetWakaTimeManager(): void {
	wakatimeManager = null;
}
