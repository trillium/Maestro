/**
 * Server-side processes manager — headless variant of the read-side
 * `process:*` IPC handlers at `src/main/ipc/handlers/process.ts`.
 *
 * Ported under `ISC-44.server.api_processes_cluster`. Closes the server
 * half of the read-side `window.maestro.process.*` surface. Mirrors the
 * existing W3 cluster precedent (FsManager / AgentsManager /
 * SshRemotesManager / AutorunManager).
 *
 * Scope — READ side only:
 *
 *   The IPC `process:*` namespace at `src/main/ipc/handlers/process.ts`
 *   has 7 channels:
 *     - process:spawn         (mutation → WS lifecycle, see umbrella `9ec71a510`)
 *     - process:write         (mutation → WS lifecycle)
 *     - process:interrupt     (mutation → WS lifecycle)
 *     - process:kill          (mutation → WS lifecycle)
 *     - process:resize        (mutation → WS lifecycle)
 *     - process:runCommand    (mutation + streaming → WS lifecycle)
 *     - process:getActiveProcesses  (READ)
 *
 *   Plus 14 event listeners (`onData`, `onExit`, `onSessionId`,
 *   `onSlashCommands`, `onThinkingChunk`, `onToolExecution`,
 *   `onSshRemote`, `onUsage`, `onAgentError`, `onStderr`,
 *   `onCommandExit`, `onRemoteCommand`, …) — all streaming, all
 *   belong on the WS process-lifecycle family per the umbrella
 *   Decision committed at `9ec71a510`.
 *
 *   This manager ports ONLY the read surface — `getActiveProcesses`
 *   plus a single-process lookup that the IPC layer expresses
 *   implicitly via the renderer's `processes.find(p => p.sessionId === …)`
 *   pattern but is naturally REST-shaped as a `GET /api/processes/:sessionId`
 *   route.
 *
 * Differences from the renderer-side handlers:
 *
 *   1. **No `electron` import.** ProcessManager is the same singleton in
 *      both modes — the renderer-side handler at process.ts:623 reaches
 *      for `getProcessManager()` from the Electron entrypoint; this
 *      manager accepts a `ProcessManager` instance via constructor so
 *      the headless boot path can hand in the same singleton it
 *      already owns (the boot path constructs ProcessManager early for
 *      the WS lifecycle work; this manager is a thin read-projection
 *      over that instance, NOT a second ProcessManager).
 *
 *   2. **Serialization parity.** Both `list()` and `get()` return the
 *      same 9-field subset of `ManagedProcess` the IPC reply at
 *      process.ts:628-638 ships:
 *        { sessionId, toolType, pid, cwd, isTerminal, isBatchMode,
 *          startTime, command, args }
 *      The PTY / child-process handles and the parser instance are
 *      excluded because they are not serializable.
 *
 *   3. **`get(sessionId)` returns `null` for missing sessions** rather
 *      than throwing. The route layer translates `null` to a 404 so
 *      callers can distinguish "process not running" from "couldn't
 *      ask" without parsing error text. Matches the `FsManager.readFile`
 *      / `SshRemotesManager.getConfigs` semantics — soft-fail on
 *      "not found" so the REST layer maps cleanly to HTTP.
 *
 *   4. **No SSH-remote dispatch.** The renderer-side `process:spawn` /
 *      `process:runCommand` handlers honor `sessionSshRemoteConfig` to
 *      proxy execution to a remote host. That codepath is a write-side
 *      concern — execution, not status — and lives on the WS
 *      process-lifecycle family. The read-side routes here are LOCAL
 *      ONLY (the `ProcessManager` singleton tracks both local and
 *      remote-spawned processes by `sessionId`, so a GET on a
 *      remote-spawned session id still returns the local
 *      bookkeeping view — `sshRemoteId` / `sshRemoteHost` are
 *      included in the projected fields when present).
 *
 * `src/main/ipc/handlers/process.ts` is NOT touched. This file is the
 * new server-side surface; the renderer continues to import from the
 * main variant. Both can run side by side in a hybrid (Electron +
 * headless sidecar) deployment because the underlying
 * `ProcessManager` singleton is the cross-mode contract.
 */

import type { ProcessManager } from '../main/process-manager/ProcessManager';
import type { ManagedProcess } from '../main/process-manager/types';

const LOG_CONTEXT = '[processes]';

/* ============ Serialization shape ============ */

/**
 * Serializable projection of `ManagedProcess` — matches the IPC reply
 * shape at `src/main/ipc/handlers/process.ts:628-638` (the 9 fields the
 * `process:getActiveProcesses` channel ships) plus the two optional
 * SSH bookkeeping fields the route layer surfaces unmodified when
 * present.
 *
 * Non-serializable fields excluded: `ptyProcess`, `childProcess`,
 * `outputParser`, `dataBuffer`, `dataBufferTimeout`,
 * `stderrBuffer`, `stdoutBuffer`, `jsonBuffer`. Internal flags also
 * excluded (`sessionIdEmitted`, `resultEmitted`, `errorEmitted`,
 * `tempImageFiles`, `lastUsageTotals`, `usageIsCumulative`) — those
 * are write-side bookkeeping the read surface should not expose.
 */
export interface ProcessInfo {
	sessionId: string;
	toolType: string;
	pid: number;
	cwd: string;
	isTerminal: boolean;
	isBatchMode: boolean;
	startTime: number;
	command?: string;
	args?: string[];
	/** Present when the process was spawned through an SSH remote. */
	sshRemoteId?: string;
	/** Present when the process was spawned through an SSH remote. */
	sshRemoteHost?: string;
}

/* ============ Projection helper ============ */

/**
 * Project a `ManagedProcess` to the 9-field IPC reply shape plus the
 * two optional SSH bookkeeping fields. Inlined here rather than
 * re-using a helper in the IPC handler because:
 *   1. The IPC handler is renderer-only (would import `electron`
 *      transitively if we re-used it).
 *   2. Inlining keeps the wire contract co-located with the manager
 *      that owns it.
 */
function projectProcess(p: ManagedProcess): ProcessInfo {
	const info: ProcessInfo = {
		sessionId: p.sessionId,
		toolType: p.toolType,
		pid: p.pid,
		cwd: p.cwd,
		isTerminal: p.isTerminal,
		isBatchMode: p.isBatchMode || false,
		startTime: p.startTime,
		command: p.command,
		args: p.args,
	};
	if (p.sshRemoteId) info.sshRemoteId = p.sshRemoteId;
	if (p.sshRemoteHost) info.sshRemoteHost = p.sshRemoteHost;
	return info;
}

/* ============ ProcessesManager (server-side) ============ */

export class ProcessesManager {
	private readonly processManager: ProcessManager;

	constructor(processManager: ProcessManager) {
		this.processManager = processManager;
	}

	/**
	 * List all active processes. Matches the `process:getActiveProcesses`
	 * IPC reply shape at `src/main/ipc/handlers/process.ts:623-639`.
	 *
	 * Returns an empty array when no processes are active (the
	 * underlying `ProcessManager.getAll()` returns `[]` for a fresh
	 * instance). NEVER throws — read against the in-memory Map.
	 */
	list(): ProcessInfo[] {
		const processes = this.processManager.getAll();
		return processes.map(projectProcess);
	}

	/**
	 * Look up a single process by sessionId. Returns `null` when no
	 * process is tracked for the id — the route layer maps `null` to
	 * a 404 so callers distinguish "not running" from "couldn't ask".
	 *
	 * Matches the implicit `processes.find(p => p.sessionId === …)`
	 * pattern the renderer uses (e.g. ProcessMonitor.tsx after a
	 * `getActiveProcesses` round-trip). NEVER throws.
	 */
	get(sessionId: string): ProcessInfo | null {
		const p = this.processManager.get(sessionId);
		if (!p) return null;
		return projectProcess(p);
	}
}

/* ============ Singleton accessor for the headless server ============ */

let processesManager: ProcessesManager | null = null;

/**
 * Get-or-create the singleton ProcessesManager for the headless server.
 *
 * Matches the `getFsManager()` / `getAgentsManager()` / etc. patterns.
 * UNLIKE those managers, this constructor takes a `ProcessManager`
 * dependency because the read surface is a projection over the live
 * `ProcessManager` singleton the headless boot path already owns —
 * we MUST NOT construct a second `ProcessManager` (it would track an
 * empty / divergent process set).
 *
 * Callers MUST pass the same `ProcessManager` instance the WS
 * lifecycle layer uses; passing different instances would yield
 * different active-process lists between the WS process-lifecycle
 * frames and the REST read surface.
 */
export function getProcessesManager(processManager: ProcessManager): ProcessesManager {
	if (!processesManager) {
		processesManager = new ProcessesManager(processManager);
		console.log(`${LOG_CONTEXT} initialized`);
	}
	return processesManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetProcessesManager(): void {
	processesManager = null;
}
