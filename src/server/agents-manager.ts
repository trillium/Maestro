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
 *   5. **No detector cache and no model discovery.** The renderer-side
 *      `AgentDetector` class caches detection results, dedupes parallel
 *      detection promises, and runs agent-specific `models` subcommands.
 *      The server-side surface starts WITHOUT those features — each
 *      `detectAgents()` call shells out fresh. A future brief can add
 *      caching and model discovery once a real consumer needs them (the
 *      NewInstanceModal sites that this brief unblocks need detection +
 *      capabilities, but model discovery is a separate IPC channel that
 *      will get its own route cluster).
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
 *   7. **No agent-config persistence and no custom-path/args/env handling.**
 *      The renderer-side handler exposes a full read/write surface for agent
 *      configuration (electron-store backed). That state is desktop-mode-only
 *      — the headless web shell does not edit per-agent configs at this
 *      stage. The umbrella Decision names this as out of scope for the
 *      shim cluster; a future brief can add `/api/agents/config/*` against
 *      a server-side FileStore if a real webFull consumer materializes.
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
 * Surface (3 methods — one per route the brief names):
 *   - `detectAgents()`         → `agents:detect` (returns list)
 *   - `detectAgent(agentId)`   → `agents:refresh` (returns list + debug info)
 *   - `getCapabilities(agentId)` → `agents:getCapabilities` (returns matrix)
 *
 * Not ported (deliberately out of scope per the brief audit):
 *   - `agents:getConfig` / `agents:setConfig` / config CRUD — needs a
 *     headless-side config store (electron-store equivalent) that doesn't
 *     yet exist; the umbrella big_3_ipc_strategy Decision marks agent-config
 *     persistence as out of scope for the shim cluster.
 *   - `agents:getModels` — local model discovery shells out to each agent's
 *     `models` subcommand; the route surface here covers detection only.
 *     Model discovery can ride on a follow-up brief if NewInstanceModal in
 *     webFull needs it.
 *   - `agents:discoverSlashCommands` — Claude Code only, expensive to
 *     invoke; no current webFull consumer.
 *   - `agents:setCustomPath` / `agents:setCustomArgs` / `agents:setCustomEnvVars`
 *     and their getters — same config-store gap as getConfig/setConfig.
 *
 * The IPC surprise these omissions surface: the NewInstanceModal port to
 * webFull will need a separate brief to land the agent-config CRUD routes
 * (and probably model discovery) before the modal becomes fully functional
 * in web mode. This brief lands the detection + capabilities sub-surface
 * that the umbrella Decision named as the first dependency in the
 * IPC-shim unblock chain.
 */
export class AgentsManager {
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
}

/* ============ Singleton accessor for the headless server ============ */

let agentsManager: AgentsManager | null = null;

/**
 * Get-or-create the singleton AgentsManager for the headless server.
 *
 * Matches the `getHistoryManager()` / `getWakaTimeManager()` /
 * `getStatsManager()` / `getFontsManager()` / `getFsManager()` patterns.
 * Parameterless because detection is pure-stdlib (no config / DB / network).
 */
export function getAgentsManager(): AgentsManager {
	if (!agentsManager) {
		agentsManager = new AgentsManager();
	}
	return agentsManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetAgentsManager(): void {
	agentsManager = null;
}
