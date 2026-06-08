/**
 * Server-side agents manager — headless variant of the `agents:*` IPC
 * handlers at `src/main/ipc/handlers/agents.ts`.
 *
 * Ported for W3-agents (closes the server half of `ISC-44.shim.agents_routes`,
 * tracked under the umbrella `ISC-44.shim.big_3_ipc_strategy` in `ISA.md`).
 * Mirrors the precedents established by W2-wakatime / W2-stats / W2-fonts /
 * W3-fs:
 *
 *   1. **No `electron` import.** Agent detection is platform code only; the
 *      renderer-side handler imports `electron` only for the `ipcMain` glue,
 *      not for the detection itself. The detection logic is pure-stdlib
 *      (`fs.access`, `child_process.execFile`, `path`, `os`).
 *
 *   2. **No `src/main/utils/execFile` import.** The server tsconfig
 *      (`tsconfig.server.json`) does not include `src/main/utils/execFile.ts`
 *      (sentry.ts is included for the WebServer's import graph, but the
 *      execFile helper isn't, and pulling it in would drag the full
 *      `getShellPath` + `runtime/` graph along). A minimal inline shim with
 *      the same `execFileNoThrow(command, args, env?)` signature (return
 *      `{ stdout, stderr, exitCode }`, never throw) is provided here,
 *      matching the shim used in `fonts-manager.ts` and `wakatime-manager.ts`.
 *
 *   3. **No `src/main/utils/logger` import.** Falls back to `console.*` with
 *      a `[Agents]` prefix — matches the rest of `src/server/`, which
 *      standardizes on `console.log/warn/error` to avoid re-pulling the
 *      main-process logger graph (sentry → @sentry/electron) into the
 *      server's runtime path.
 *
 *   4. **Re-uses `AGENT_DEFINITIONS` and `getAgentCapabilities` directly.**
 *      `src/main/agents/definitions.ts` and `src/main/agents/capabilities.ts`
 *      are pure-data modules whose only import is `shared/platformDetection`
 *      (already in the server tsconfig include set). They are added to
 *      `tsconfig.server.json` in this same patch — additive include, not a
 *      schema change. The renderer continues to import the same files; the
 *      "single source of truth" invariant is preserved.
 *
 *   5. **No detector cache.** The renderer-side `AgentDetector` class caches
 *      detection results and dedupes parallel detection promises. The
 *      server-side surface starts WITHOUT a detection cache — each
 *      `detectAgents()` call shells out fresh. A future brief can add
 *      caching once a real consumer benchmarks repeated detection.
 *
 *   6. **No SSH-remote dispatch.** The renderer-side handler accepts an
 *      optional `sshRemoteId` that proxies detection over SSH. The
 *      server-side surface is strictly local; SSH-remote support is its
 *      own future server-side port (the umbrella big_3_ipc_strategy
 *      Decision names `ISC-44.shim.ssh_remotes_routes` as a sibling sub-ISC).
 *      The route layer rejects with 501 when an `sshRemoteId` query param
 *      is present so callers don't silently get a local-host result when
 *      a remote was requested. This matches the W3-fs precedent at
 *      `apiRoutes.ts:1278+`.
 *
 *   7. **Agent-config persistence and model discovery ARE ported (W3-agents-writers).**
 *      Extends the original W3-agents detection-only surface with the
 *      writer surface the umbrella big_3_ipc_strategy Decision named as a
 *      follow-up: `getConfig` / `setConfig` (backed by a JSON FileStore at
 *      `<dataDir>/agents-config.json`, mirroring the marketplace JSON-file
 *      pattern) and `getModels` (local-only, mirrors `AgentDetector.runModelDiscovery`
 *      — only `opencode` actually shells out; other agents short-circuit to
 *      `[]`). Closes the NewInstanceModal preconditions at sites 284, 405,
 *      971, 1277, 1288, 1482, 1791 — the remaining 6 of 11 IPC call sites
 *      that the original W3-agents Decision audit named.
 *
 *      Out of scope for THIS extension brief (custom path/args/env handling):
 *      `getCustomPath` / `setCustomPath` / `getAllCustomPaths` /
 *      `getCustomArgs` / `setCustomArgs` / `getAllCustomArgs` /
 *      `getCustomEnvVars` / `setCustomEnvVars` / `getAllCustomEnvVars`.
 *      These ride on the same JSON store via the `customPath` / `customArgs`
 *      / `customEnvVars` sub-keys (per the renderer-side handler's storage
 *      shape), and would be additive sub-keys in a follow-up brief if a
 *      real webFull consumer materializes. The 3 routes this brief ships
 *      cover NewInstanceModal's preconditions; the custom-path surface is
 *      a Settings-panel feature, not a NewInstanceModal precondition.
 *
 *   8. **`stripAgentFunctions` inlined.** Agent definitions carry function
 *      properties (`resumeArgs`, `modelArgs`, `workingDirArgs`, `imageArgs`,
 *      `promptArgs`, and `configOptions[*].argBuilder`) that cannot be
 *      JSON-serialized for an HTTP response. Strip them at the manager
 *      boundary so the route layer sees a fully serializable object. This
 *      matches the renderer-side `stripAgentFunctions` helper at
 *      `src/main/ipc/handlers/agents.ts:78` byte-for-byte.
 *
 * The on-disk binary location is the contract between modes: both Electron
 * (renderer-side handler at `src/main/ipc/handlers/agents.ts`) and the
 * headless server probe the same paths (Homebrew, ~/.local/bin, npm-global,
 * etc.) and invoke `which`/`where` with the same expanded PATH. A hybrid
 * (Electron + headless sidecar) deployment is supported because the
 * underlying binary resolution is shared at the OS level.
 *
 * `src/main/ipc/handlers/agents.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to use the IPC channel via
 * `window.maestro.agents.*`.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import {
	AGENT_DEFINITIONS,
	type AgentDefinition,
	type AgentConfig,
} from '../main/agents/definitions';
import { getAgentCapabilities, type AgentCapabilities } from '../main/agents/capabilities';
import { isWindows, getWhichCommand } from '../shared/platformDetection';

/* ============ Config-store shape ============ */

/**
 * On-disk shape of `<dataDir>/agents-config.json`. Mirrors the renderer-side
 * `AgentConfigsData` shape at `src/main/ipc/handlers/agents.ts:33` exactly —
 * top-level `configs` keyed by agent id, each value an opaque `Record<string,
 * unknown>` (the renderer-side electron-store backs this same shape). Same
 * file on disk is the cross-mode contract: a hybrid Electron + headless
 * deployment writing to the same `dataDir` reads each other's edits without
 * schema translation.
 *
 * NOTE on storage location: the Electron path uses electron-store's default
 * (`~/Library/Application Support/<app>/agent-configs.json` on macOS), keyed
 * by the store NAME `agent-configs`. The headless server uses
 * `<dataDir>/agents-config.json` — same shape, sibling location. The umbrella
 * big_3_ipc_strategy Decision flagged config-CRUD as a follow-up brief; this
 * brief picks the headless-friendly `<dataDir>/...` location to match the
 * W3-marketplace precedent (also a JSON file under `<dataDir>/`). A future
 * brief MAY merge the two stores if a hybrid deployment needs unified config.
 */
interface AgentConfigsData {
	configs: Record<string, Record<string, unknown>>;
}

const LOG_CONTEXT = '[Agents]';
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;
const WHICH_TIMEOUT_MS = 5000;

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
 * no stdin-input variant (not used by detection), no Windows-shell PATHEXT
 * resolution (binaries are invoked by name and resolved off the expanded `$PATH`).
 *
 * The `env` parameter mirrors `execFileNoThrow(command, args, cwd, env)` in the
 * renderer-side helper — passed straight through to `child_process.execFile`.
 */
async function execFileNoThrow(
	command: string,
	args: string[] = [],
	env?: NodeJS.ProcessEnv
): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			encoding: 'utf8',
			maxBuffer: EXEC_MAX_BUFFER,
			env: env ?? process.env,
			timeout: WHICH_TIMEOUT_MS,
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

/* ============ Expanded PATH ============ */

/**
 * Build an expanded PATH that includes common binary installation locations.
 *
 * Headless variant of `getExpandedEnv()` in `src/main/agents/path-prober.ts`.
 * Inlined here because path-prober.ts pulls in `../runtime/getShellPath` and
 * `../utils/execFile` — neither in the server tsconfig include set, and
 * pulling them in would cascade into utils/logger → utils/sentry →
 * @sentry/electron. We keep the server's import graph clean by re-implementing
 * the PATH expansion locally; the two MUST stay in sync for cross-mode parity
 * (any new installation path added to path-prober.ts SHOULD be mirrored here).
 *
 * Coverage parity: the Unix list below matches path-prober.ts:106-120 line-for-
 * line. The Windows list matches path-prober.ts:55-103. When path-prober.ts is
 * updated, this function is the sibling to update.
 */
function getExpandedEnv(): NodeJS.ProcessEnv {
	const home = os.homedir();
	const env = { ...process.env };

	let additionalPaths: string[];

	if (isWindows()) {
		const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
		const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
		const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
		const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

		additionalPaths = [
			path.join(home, '.local', 'bin'),
			path.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
			path.join(programFiles, 'WinGet', 'Links'),
			path.join(localAppData, 'Microsoft', 'WinGet', 'Packages'),
			path.join(programFiles, 'WinGet', 'Packages'),
			path.join(appData, 'npm'),
			path.join(localAppData, 'npm'),
			path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli'),
			path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin'),
			path.join(localAppData, 'Programs'),
			path.join(localAppData, 'Microsoft', 'WindowsApps'),
			path.join(appData, 'Python', 'Scripts'),
			path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'),
			path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'),
			path.join(localAppData, 'Programs', 'Python', 'Python310', 'Scripts'),
			path.join(programFiles, 'Git', 'cmd'),
			path.join(programFiles, 'Git', 'bin'),
			path.join(programFiles, 'Git', 'usr', 'bin'),
			path.join(programFilesX86, 'Git', 'cmd'),
			path.join(programFilesX86, 'Git', 'bin'),
			path.join(programFiles, 'nodejs'),
			path.join(localAppData, 'Programs', 'node'),
			'C:\\nvm4w\\nodejs',
			path.join(home, 'nvm4w', 'nodejs'),
			path.join(home, '.volta', 'bin'),
			path.join(home, 'scoop', 'shims'),
			path.join(home, 'scoop', 'apps', 'opencode', 'current'),
			path.join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin'),
			path.join(home, 'go', 'bin'),
			path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
			path.join(process.env.SystemRoot || 'C:\\Windows'),
		];
	} else {
		additionalPaths = [
			'/opt/homebrew/bin',
			'/opt/homebrew/sbin',
			'/usr/local/bin',
			'/usr/local/sbin',
			`${home}/.local/bin`,
			`${home}/.npm-global/bin`,
			`${home}/bin`,
			`${home}/.claude/local`,
			`${home}/.opencode/bin`,
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
		];
	}

	const currentPath = env.PATH || '';
	const pathParts = currentPath.split(path.delimiter);

	for (const p of additionalPaths) {
		if (!pathParts.includes(p)) {
			pathParts.unshift(p);
		}
	}

	env.PATH = pathParts.join(path.delimiter);
	return env;
}

/* ============ Binary detection ============ */

/**
 * Check if a binary exists in PATH or known installation locations.
 *
 * Headless variant of `checkBinaryExists()` in
 * `src/main/agents/path-prober.ts`. The renderer-side function does a
 * two-tier probe: direct file probing of known installation paths first
 * (most reliable in packaged Electron apps), then falls back to `which`/
 * `where`. We use the SAME two-tier strategy here, but skip the
 * shell-path probe (that's an Electron-specific reliability hack for
 * packaged apps; the headless server already inherits the launching
 * shell's PATH).
 *
 * Returns `{ exists, path? }`.
 */
async function checkBinaryExists(binaryName: string): Promise<{ exists: boolean; path?: string }> {
	// Tier 1: direct probe of known installation paths (matches path-prober.ts logic).
	const probedPath = await probeKnownPaths(binaryName);
	if (probedPath) {
		return { exists: true, path: probedPath };
	}

	// Tier 2: fall back to `which`/`where` with expanded PATH.
	try {
		const command = getWhichCommand();
		const env = getExpandedEnv();
		const result = await execFileNoThrow(command, [binaryName], env);

		if (result.exitCode === 0 && result.stdout.trim()) {
			const matches = result.stdout
				.trim()
				.split(/\r?\n/)
				.map((p) => p.trim())
				.filter((p) => p);

			if (matches.length === 0) {
				return { exists: false };
			}

			if (isWindows()) {
				// Prefer .exe > extensionless > .cmd (matches path-prober.ts:517-557).
				const exeMatch = matches.find((p) => p.toLowerCase().endsWith('.exe'));
				const cmdMatch = matches.find((p) => p.toLowerCase().endsWith('.cmd'));
				const extensionlessMatch = matches.find(
					(p) => !p.toLowerCase().endsWith('.exe') && !p.toLowerCase().endsWith('.cmd')
				);
				const bestMatch = (exeMatch || extensionlessMatch || cmdMatch)!;
				return { exists: true, path: bestMatch };
			}

			return { exists: true, path: matches[0] };
		}

		return { exists: false };
	} catch {
		return { exists: false };
	}
}

/**
 * Probe known installation paths for a binary. Returns the first hit.
 *
 * Subset of `getUnixKnownPaths()` / `getWindowsKnownPaths()` from
 * path-prober.ts — covers the same binaries (`claude`, `codex`, `opencode`,
 * `gemini`, `aider`) so detection results match the renderer-side surface
 * for the cross-mode contract. Less exhaustive than path-prober.ts because
 * the headless server doesn't suffer Electron's "packaged app loses shell
 * env" problem; `which` is more reliable here, so the known-paths list is
 * the fast-path backup, not the primary probe.
 */
async function probeKnownPaths(binaryName: string): Promise<string | null> {
	const home = os.homedir();
	const pathsToCheck: string[] = [];

	if (isWindows()) {
		const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
		const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
		const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
		switch (binaryName) {
			case 'claude':
				pathsToCheck.push(
					path.join(home, '.local', 'bin', 'claude.exe'),
					path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
					path.join(programFiles, 'WinGet', 'Links', 'claude.exe'),
					path.join(appData, 'npm', 'claude.cmd'),
					path.join(localAppData, 'npm', 'claude.cmd'),
					path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude.exe')
				);
				break;
			case 'codex':
				pathsToCheck.push(
					path.join(appData, 'npm', 'codex.cmd'),
					path.join(localAppData, 'npm', 'codex.cmd'),
					path.join(home, '.local', 'bin', 'codex.exe')
				);
				break;
			case 'opencode':
				pathsToCheck.push(
					path.join(home, 'scoop', 'shims', 'opencode.exe'),
					path.join(home, 'scoop', 'apps', 'opencode', 'current', 'opencode.exe'),
					path.join(home, '.volta', 'bin', 'opencode'),
					path.join(home, '.volta', 'bin', 'opencode.cmd'),
					path.join(
						process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey',
						'bin',
						'opencode.exe'
					),
					path.join(home, 'go', 'bin', 'opencode.exe'),
					path.join(appData, 'npm', 'opencode.cmd'),
					path.join(localAppData, 'npm', 'opencode.cmd')
				);
				break;
			case 'gemini':
				pathsToCheck.push(
					path.join(appData, 'npm', 'gemini.cmd'),
					path.join(localAppData, 'npm', 'gemini.cmd')
				);
				break;
		}
	} else {
		switch (binaryName) {
			case 'claude':
				pathsToCheck.push(
					path.join(home, '.claude', 'local', 'claude'),
					path.join(home, '.local', 'bin', 'claude'),
					'/opt/homebrew/bin/claude',
					'/usr/local/bin/claude',
					path.join(home, '.npm-global', 'bin', 'claude'),
					path.join(home, 'bin', 'claude')
				);
				break;
			case 'codex':
				pathsToCheck.push(
					path.join(home, '.local', 'bin', 'codex'),
					'/opt/homebrew/bin/codex',
					'/usr/local/bin/codex',
					path.join(home, '.npm-global', 'bin', 'codex')
				);
				break;
			case 'opencode':
				pathsToCheck.push(
					path.join(home, '.opencode', 'bin', 'opencode'),
					path.join(home, 'go', 'bin', 'opencode'),
					path.join(home, '.local', 'bin', 'opencode'),
					'/opt/homebrew/bin/opencode',
					'/usr/local/bin/opencode'
				);
				break;
			case 'gemini':
				pathsToCheck.push(
					path.join(home, '.npm-global', 'bin', 'gemini'),
					'/opt/homebrew/bin/gemini',
					'/usr/local/bin/gemini'
				);
				break;
			case 'aider':
				pathsToCheck.push(
					path.join(home, '.local', 'bin', 'aider'),
					'/opt/homebrew/bin/aider',
					'/usr/local/bin/aider'
				);
				break;
			case 'droid':
				pathsToCheck.push(
					path.join(home, '.local', 'bin', 'droid'),
					'/opt/homebrew/bin/droid',
					'/usr/local/bin/droid',
					path.join(home, '.npm-global', 'bin', 'droid')
				);
				break;
		}
	}

	if (pathsToCheck.length === 0) {
		return null;
	}

	const results = await Promise.allSettled(
		pathsToCheck.map(async (probePath) => {
			// Match path-prober.ts:451 — check existence + executability on Unix.
			if (isWindows()) {
				await fs.promises.access(probePath, fs.constants.F_OK);
			} else {
				await fs.promises.access(probePath, fs.constants.F_OK | fs.constants.X_OK);
			}
			return probePath;
		})
	);

	for (const result of results) {
		if (result.status === 'fulfilled') {
			return result.value;
		}
	}

	return null;
}

/* ============ Function stripping for HTTP serialization ============ */

/**
 * Strip non-serializable function properties from an agent config object.
 *
 * Agent definitions carry function fields that JSON cannot serialize:
 * - `resumeArgs`, `modelArgs`, `workingDirArgs`, `imageArgs`, `promptArgs`
 *   at the agent level
 * - `argBuilder` inside `configOptions[*]`
 *
 * Mirrors the renderer-side `stripAgentFunctions` helper at
 * `src/main/ipc/handlers/agents.ts:78`. The two MUST stay in sync — if the
 * renderer-side helper grows new function fields, this one MUST too.
 */
function stripAgentFunctions(agent: AgentConfig | null): unknown {
	if (!agent) return null;

	const {
		resumeArgs: _resumeArgs,
		modelArgs: _modelArgs,
		workingDirArgs: _workingDirArgs,
		imageArgs: _imageArgs,
		promptArgs: _promptArgs,
		...serializableAgent
	} = agent as AgentConfig & Record<string, unknown>;

	return {
		...serializableAgent,
		configOptions: agent.configOptions?.map((opt) => {
			const { argBuilder: _argBuilder, ...serializableOpt } = opt as typeof opt & {
				argBuilder?: unknown;
			};
			return serializableOpt;
		}),
	};
}

/* ============ AgentsManager (server-side) ============ */

/**
 * Reply shape for the `/api/agents/detect/<agentId>` route. Mirrors the
 * renderer-side `agents:refresh` IPC reply at agents.ts:399-405.
 *
 * `debugInfo` is non-null when the agent was not detected, populated with
 * the environment context the renderer-side handler emits for debugging.
 * When the agent IS detected the field is `null`.
 */
export interface AgentDetectDebugInfo {
	agentId: string;
	available: boolean;
	path: string | null;
	binaryName: string;
	envPath: string;
	homeDir: string;
	platform: string;
	whichCommand: string;
	error: string | null;
}

export interface AgentDetectResult {
	agents: unknown[];
	debugInfo: AgentDetectDebugInfo | null;
}

/**
 * Server-side agents manager. Mirrors the read-side surface of the
 * renderer-side `agents:*` IPC handlers.
 *
 * Surface (6 methods after W3-agents-writers — original 3 + 3 new):
 *   - `detectAgents()`         → `agents:detect` (returns list)
 *   - `detectAgent(agentId)`   → `agents:refresh` (returns list + debug info)
 *   - `getCapabilities(agentId)` → `agents:getCapabilities` (returns matrix)
 *   - `getConfig(agentId)`     → `agents:getConfig` (merged defaults + stored)
 *   - `setConfig(agentId, cfg)`→ `agents:setConfig` (overwrites stored)
 *   - `getModels(agentId, forceRefresh?)` → `agents:getModels` (local-only,
 *     `[]` for agents without model discovery, `opencode models` for opencode)
 *
 * Constructor takes `dataDir` to back the config FileStore at
 * `<dataDir>/agents-config.json`. The pre-W3-agents-writers surface was
 * stateless (parameterless constructor); the writer surface needs a disk
 * location, so the constructor now takes a single `dataDir` argument.
 * Callers that only need the read surface can pass any string (the file is
 * not opened until `getConfig` / `setConfig` is called).
 *
 * Not ported (deliberately out of scope):
 *   - `agents:discoverSlashCommands` — Claude Code only, expensive to
 *     invoke; no current webFull consumer.
 *   - `agents:setCustomPath` / `agents:setCustomArgs` / `agents:setCustomEnvVars`
 *     and their getters — Settings-panel feature, not a NewInstanceModal
 *     precondition. The same JSON store can back them via sub-keys when a
 *     consumer materializes.
 */
export class AgentsManager {
	private readonly configFilePath: string;
	private modelCache = new Map<string, { models: string[]; timestamp: number }>();
	private readonly modelCacheTtlMs = 5 * 60 * 1000;

	/**
	 * @param dataDir Directory containing `agents-config.json`. The file is
	 *   lazily read on first `getConfig` call; it does NOT need to exist at
	 *   construction time (the manager writes it on first `setConfig`).
	 */
	constructor(dataDir: string) {
		this.configFilePath = path.join(dataDir, 'agents-config.json');
	}
	/**
	 * Detect all available agents on the local host.
	 *
	 * Mirrors `agents:detect` (local path). Iterates `AGENT_DEFINITIONS`,
	 * probes each binary, attaches capabilities, strips functions, returns
	 * the serializable list.
	 */
	async detectAgents(): Promise<unknown[]> {
		const agents: AgentConfig[] = [];

		for (const agentDef of AGENT_DEFINITIONS) {
			const detection = await checkBinaryExists(agentDef.binaryName);

			if (detection.exists) {
				console.log(`${LOG_CONTEXT} agent "${agentDef.name}" found at: ${detection.path}`);
			} else if (agentDef.binaryName !== 'bash' && agentDef.binaryName !== 'powershell.exe') {
				console.warn(
					`${LOG_CONTEXT} agent "${agentDef.name}" (binary: ${agentDef.binaryName}) not found`
				);
			}

			agents.push({
				...(agentDef as AgentDefinition),
				available: detection.exists,
				path: detection.path,
				capabilities: getAgentCapabilities(agentDef.id),
			});
		}

		const available = agents.filter((a) => a.available).map((a) => a.id);
		console.log(`${LOG_CONTEXT} detection complete. Available: ${available.join(', ') || 'none'}`);

		return agents.map(stripAgentFunctions);
	}

	/**
	 * Fresh detection for a specific agent. Mirrors `agents:refresh` (debug
	 * variant) — returns the full agent list PLUS a `debugInfo` payload
	 * targeted at the requested agent when it is NOT available, or `null`
	 * when it IS available.
	 *
	 * The renderer-side handler also clears the detector cache before
	 * re-detecting; the server-side surface has no cache to clear (see
	 * design note #5), so every call is already "fresh".
	 */
	async detectAgent(agentId: string): Promise<AgentDetectResult> {
		const list = (await this.detectAgents()) as Array<{
			id: string;
			binaryName?: string;
			available?: boolean;
			path?: string;
		}>;

		const agent = list.find((a) => a.id === agentId);

		if (!agent) {
			// Caller asked for an agent id we don't define. Return the full
			// list with a debugInfo payload pointing at the bad input, matching
			// the renderer-side handler's posture (no throw, just empty
			// debug info with available=false).
			return {
				agents: list,
				debugInfo: {
					agentId,
					available: false,
					path: null,
					binaryName: agentId,
					envPath: process.env.PATH || '',
					homeDir: process.env.HOME || '',
					platform: process.platform,
					whichCommand: getWhichCommand(),
					error: `Unknown agent id: ${agentId}`,
				},
			};
		}

		if (agent.available) {
			// Agent found — debugInfo is null per the renderer-side contract.
			return { agents: list, debugInfo: null };
		}

		// Agent not found — populate debugInfo with environment context plus
		// the `which`/`where` failure output so callers can diagnose missing
		// installs without round-tripping. Matches agents.ts:373-396.
		const command = getWhichCommand();
		const probeResult = await execFileNoThrow(
			command,
			[agent.binaryName || agentId],
			getExpandedEnv()
		);
		const error =
			probeResult.exitCode !== 0
				? `${command} ${agent.binaryName || agentId} failed (exit code ${probeResult.exitCode}): ${
						probeResult.stderr || 'Binary not found in PATH'
					}`
				: null;

		return {
			agents: list,
			debugInfo: {
				agentId,
				available: false,
				path: null,
				binaryName: agent.binaryName || agentId,
				envPath: process.env.PATH || '',
				homeDir: process.env.HOME || '',
				platform: process.platform,
				whichCommand: command,
				error,
			},
		};
	}

	/**
	 * Get the capabilities matrix for an agent id. Mirrors
	 * `agents:getCapabilities` 1:1 — pure lookup against
	 * `AGENT_CAPABILITIES`. Unknown ids return `DEFAULT_CAPABILITIES` per
	 * `getAgentCapabilities()`'s contract.
	 */
	getCapabilities(agentId: string): AgentCapabilities {
		return getAgentCapabilities(agentId);
	}

	/* ============ Config FileStore (lazy) ============ */

	/**
	 * Read the entire `<dataDir>/agents-config.json` file. Returns the empty
	 * shape `{ configs: {} }` on ENOENT or parse failure (matches the
	 * renderer-side electron-store posture, which auto-initializes to the
	 * default on first read of a fresh install).
	 *
	 * Race-condition note: the JSON-file pattern (read → mutate in memory →
	 * write whole file) is the same pattern marketplace-manager uses for
	 * playbooks.json. Two concurrent `setConfig` calls against different
	 * agent ids COULD race and lose one write; that's an accepted trade-off
	 * for the JSON-file simplicity (the renderer-side electron-store has the
	 * same race posture). The Settings-panel UX writes one agent at a time
	 * from a single client, so the race is theoretical for the current
	 * consumer surface. A future brief MAY add a file-level mutex if a
	 * batch-write consumer materializes.
	 */
	private async readConfigStore(): Promise<AgentConfigsData> {
		try {
			const content = await fs.promises.readFile(this.configFilePath, 'utf-8');
			const data = JSON.parse(content) as Partial<AgentConfigsData>;
			if (!data || typeof data !== 'object' || !data.configs || typeof data.configs !== 'object') {
				console.warn(`${LOG_CONTEXT} agents-config.json has invalid shape, returning empty`);
				return { configs: {} };
			}
			return { configs: data.configs as Record<string, Record<string, unknown>> };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				return { configs: {} };
			}
			console.warn(`${LOG_CONTEXT} failed to read agents-config.json: ${(error as Error).message}`);
			return { configs: {} };
		}
	}

	private async writeConfigStore(data: AgentConfigsData): Promise<void> {
		// Ensure parent dir exists — `<dataDir>` may not have been created yet
		// on a fresh headless install. Matches the marketplace-manager posture
		// at marketplace-manager.ts:306.
		await fs.promises.mkdir(path.dirname(this.configFilePath), { recursive: true });
		await fs.promises.writeFile(this.configFilePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	/**
	 * Get the merged config for an agent id — defaults from
	 * `AGENT_DEFINITIONS[*].configOptions[*].default` overlaid with the
	 * stored config from `<dataDir>/agents-config.json`. Mirrors the
	 * renderer-side `agents:getConfig` handler at agents.ts:556 byte-for-byte:
	 *
	 *   const defaults = {};
	 *   for (option of agentDef.configOptions) if (option.default !== undefined)
	 *       defaults[option.key] = option.default;
	 *   return { ...defaults, ...storedConfig };
	 *
	 * Unknown agent ids: returns just the stored config (or `{}` if none) —
	 * matches the renderer-side handler's behavior (the `agentDef` lookup
	 * returns undefined, the for-loop is skipped, defaults is `{}`).
	 *
	 * The merged shape includes `customPath`, `customArgs`, `customEnvVars`
	 * sub-keys when those have been written to the store via the
	 * renderer-side handlers (the same JSON file backs both surfaces) — they
	 * pass through transparently because the merge is shallow.
	 */
	async getConfig(agentId: string): Promise<Record<string, unknown>> {
		const store = await this.readConfigStore();
		const storedConfig = store.configs[agentId] || {};

		const agentDef = AGENT_DEFINITIONS.find((a) => a.id === agentId);
		const defaults: Record<string, unknown> = {};
		if (agentDef?.configOptions) {
			for (const option of agentDef.configOptions) {
				if (option.default !== undefined) {
					defaults[option.key] = option.default;
				}
			}
		}

		return { ...defaults, ...storedConfig };
	}

	/**
	 * Overwrite the stored config for an agent id. Mirrors the renderer-side
	 * `agents:setConfig` handler at agents.ts:578 — replaces (does NOT merge)
	 * the per-agent record. Unknown agent ids are accepted (the renderer-side
	 * handler accepts them too — no `AGENT_DEFINITIONS` lookup runs before
	 * the write). Returns `true` on success to match the renderer-side
	 * handler's reply shape.
	 *
	 * Note: this OVERWRITES, it doesn't merge. A caller that wants to update
	 * a single key should read-modify-write via `getConfig` first. Matches
	 * the renderer-side handler's semantics so the cross-mode contract stays
	 * symmetric.
	 */
	async setConfig(agentId: string, config: Record<string, unknown>): Promise<boolean> {
		const store = await this.readConfigStore();
		store.configs[agentId] = config;
		await this.writeConfigStore(store);
		console.log(`${LOG_CONTEXT} updated config for agent: ${agentId}`);
		return true;
	}

	/**
	 * Discover available models for an agent id. LOCAL ONLY — SSH-remote
	 * dispatch is a sibling brief. Mirrors the renderer-side
	 * `AgentDetector.discoverModels` at detector.ts:208 + `runModelDiscovery`
	 * at detector.ts:247:
	 *
	 *   1. If agent not detected → `[]` (cannot discover models on a missing
	 *      binary).
	 *   2. If agent does NOT support model selection (`capabilities.supportsModelSelection
	 *      === false`) → `[]`.
	 *   3. Else: agent-specific fan-out. Currently only `opencode` has a
	 *      `models` subcommand implementation; other agents that claim
	 *      `supportsModelSelection: true` (codex, gemini-cli) fall through to
	 *      the `default` branch and return `[]` (the renderer-side detector
	 *      does the same). When/if they get model-discovery implementations,
	 *      THIS function is the sibling to update.
	 *
	 * Cache TTL is 5 minutes (matches `AgentDetector.modelCacheTtlMs`). Pass
	 * `forceRefresh: true` to bypass.
	 *
	 * Resilience: every exception is caught and logged; the function returns
	 * `[]` on failure so the route never 500s on a missing/broken agent
	 * binary. Matches the renderer-side `runModelDiscovery` posture (try/
	 * catch at detector.ts:251, returns `[]` on throw).
	 */
	async getModels(agentId: string, forceRefresh = false): Promise<string[]> {
		// Cache check
		if (!forceRefresh) {
			const cached = this.modelCache.get(agentId);
			if (cached && Date.now() - cached.timestamp < this.modelCacheTtlMs) {
				console.log(`${LOG_CONTEXT} returning cached models for ${agentId}`);
				return cached.models;
			}
		}

		// Detect the agent first — model discovery shells out to the agent
		// binary, so we need its path. detectAgents() shells out fresh each
		// call (no detector cache yet); cheap enough for this consumer (the
		// modal calls this on tool-type change, not on every keystroke).
		const list = (await this.detectAgents()) as Array<{
			id: string;
			binaryName?: string;
			command?: string;
			path?: string;
			available?: boolean;
			capabilities?: { supportsModelSelection?: boolean };
		}>;
		const agent = list.find((a) => a.id === agentId);

		if (!agent || !agent.available) {
			console.warn(`${LOG_CONTEXT} cannot discover models: agent ${agentId} not available`);
			return [];
		}

		if (!agent.capabilities?.supportsModelSelection) {
			console.log(`${LOG_CONTEXT} agent ${agentId} does not support model selection`);
			return [];
		}

		// Agent-specific model discovery. Mirrors detector.ts:253-283.
		const command = agent.path || agent.command;
		if (!command) {
			console.warn(`${LOG_CONTEXT} no command path for agent ${agentId}, cannot discover models`);
			return [];
		}

		const env = getExpandedEnv();
		let models: string[] = [];

		try {
			switch (agentId) {
				case 'opencode': {
					// `opencode models` returns one model per line (e.g.
					// "opencode/gpt-5-nano", "ollama/gpt-oss:latest").
					const result = await execFileNoThrow(command, ['models'], env);
					if (result.exitCode !== 0) {
						console.warn(
							`${LOG_CONTEXT} model discovery failed for ${agentId}: exit code ${result.exitCode}`
						);
						return [];
					}
					models = result.stdout
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
					console.log(`${LOG_CONTEXT} discovered ${models.length} models for ${agentId}`);
					break;
				}
				default:
					// Other agents that claim `supportsModelSelection: true`
					// (codex, gemini-cli) don't have a `models` subcommand
					// implemented in the renderer-side detector either —
					// they fall through to `[]`. THIS switch is the sibling
					// to update when they get model-discovery implementations.
					console.log(`${LOG_CONTEXT} no model discovery implemented for ${agentId}`);
					return [];
			}
		} catch (error) {
			console.error(
				`${LOG_CONTEXT} model discovery threw for ${agentId}: ${(error as Error).message}`
			);
			return [];
		}

		this.modelCache.set(agentId, { models, timestamp: Date.now() });
		return models;
	}
}

/* ============ Singleton accessor for the headless server ============ */

let agentsManager: AgentsManager | null = null;

/**
 * Get-or-create the singleton AgentsManager for the headless server.
 *
 * Matches the `getHistoryManager()` / `getWakaTimeManager()` /
 * `getStatsManager()` / `getFontsManager()` / `getFsManager()` / `getMarketplaceManager()`
 * patterns. Lazy-init: the FIRST call MUST supply `dataDir`; subsequent calls
 * ignore the argument (matching the marketplace-manager.ts:814 posture). The
 * `dataDir` is needed for the config FileStore at
 * `<dataDir>/agents-config.json` (W3-agents-writers).
 *
 * For backward compatibility with the pre-W3-agents-writers signature, callers
 * MAY pass no argument — but the FIRST caller (`src/server/index.ts`) MUST
 * supply `dataDir`, or `getConfig` / `setConfig` will write to `./agents-config.json`
 * relative to the process cwd. Defensive: if no `dataDir` was ever supplied,
 * the manager logs a warning on first config-related call.
 */
export function getAgentsManager(dataDir?: string): AgentsManager {
	if (!agentsManager) {
		if (!dataDir) {
			console.warn(
				`${LOG_CONTEXT} getAgentsManager() called before initialization with dataDir. ` +
					`Config FileStore will be written to process cwd. The first call MUST supply dataDir.`
			);
		}
		agentsManager = new AgentsManager(dataDir ?? '.');
	}
	return agentsManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetAgentsManager(): void {
	agentsManager = null;
}
