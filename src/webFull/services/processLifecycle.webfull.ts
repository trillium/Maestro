/**
 * webFull WS process-lifecycle client.
 *
 * Mirrors the Electron `window.maestro.process.*` surface
 * (`src/main/preload/process.ts:25-243`) over the WS frame family pinned
 * by the umbrella Decision 2026-06-08 (`docs/ws-process-lifecycle-decision`,
 * commit `9ec71a510`).
 *
 * Family members handled here:
 *   - `process_spawn`               (Client→Server, awaits `process_spawn_result`)
 *   - `process_kill`                (Client→Server, awaits `process_kill_result`)
 *   - `process_data`                (Server→Client, dispatched per-sessionId)
 *   - `process_exit`                (Server→Client, dispatched per-sessionId)
 *   - `process_thinking_chunk`      (Server→Client, OPTIONAL — gated by per-callsite opt-in)
 *   - `process_tool_execution`      (Server→Client, OPTIONAL — gated by per-callsite opt-in)
 *
 * Three load-bearing contracts (verbatim from the Decision):
 *   1. SSH passthrough — every `spawn()` call MUST forward
 *      `sessionSshRemoteConfig` verbatim. The server-side handler routes it
 *      through `wrapSpawnWithSsh` before `ProcessManager.spawn`.
 *   2. `onData` raw chunking — each `process_data` frame delivers ONE raw
 *      chunk; the dispatcher invokes subscribers synchronously per chunk,
 *      NO buffering, NO newline framing.
 *   3. Optional capability flags — `onThinkingChunk` / `onToolExecution`
 *      subscribers are wired identically to required listeners, but the
 *      frame only arrives for agents that surface partial-thinking /
 *      structured-tool-execution (Claude Code emits thinking-chunk;
 *      OpenCode / Codex emit tool-execution). Callers MUST tolerate
 *      "never fires" without treating it as an error.
 *
 * Integration shape — App.tsx provides `send` (typically the `send` returned
 * by `useWebSocket`) and routes every incoming frame through `handleFrame`.
 * Subscribers register per-sessionId so multiplexing many sessions on one
 * client stays cheap.
 */

// ============================================================================
// Public types — mirror src/main/preload/process.ts (NOT imported from there
// because that module pulls `electron`, which webFull bundles cannot resolve).
// Shapes are kept structurally identical so future renderer→webFull lifts
// stay copy-paste compatible.
// ============================================================================

/**
 * Tool execution event — structurally identical to
 * `ToolExecutionEvent` in `src/main/preload/process.ts:117-121` and
 * `ToolExecution` in `src/main/process-manager/types.ts:123-127`.
 */
export interface ToolExecutionEvent {
	toolName: string;
	state?: unknown;
	timestamp: number;
}

/** Subset of `ProcessConfig` carried in the `process_spawn` WS frame. */
export interface ProcessSpawnConfig {
	sessionId: string;
	toolType: string;
	cwd: string;
	command: string;
	args: string[];
	prompt?: string;
	shell?: string;
	images?: string[];
	agentSessionId?: string;
	readOnlyMode?: boolean;
	modelId?: string;
	yoloMode?: boolean;
	querySource?: 'user' | 'auto';
	tabId?: string;
	sessionCustomPath?: string;
	sessionCustomArgs?: string;
	sessionCustomEnvVars?: Record<string, string>;
	sessionCustomModel?: string;
	sessionCustomContextWindow?: number;
	/**
	 * Load-bearing SSH passthrough — contract vector 1 in the umbrella
	 * Decision. Forwarded verbatim. Server-side handler routes through
	 * `wrapSpawnWithSsh()` before `ProcessManager.spawn()`.
	 */
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

/** Result returned by `spawn()` — mirrors `ProcessSpawnResponse` in preload. */
export interface ProcessSpawnResult {
	pid: number;
	success: boolean;
	/** Set to the SSH remote id when SSH was applied; `null` for local. */
	sshRemoteUsed?: string | null;
}

/** Raw chunk delivered by `process_data` (contract vector 2). */
export interface ProcessDataEvent {
	sessionId: string;
	chunk: string;
	source: 'stdout' | 'stderr';
}

/** Payload of `process_exit`. */
export interface ProcessExitEvent {
	sessionId: string;
	code: number;
	signal: string | null;
}

/** Synchronous unsubscriber returned by every on* subscription. */
export type Unsubscribe = () => void;

/** The `send` shape the host App.tsx (or test harness) provides. */
export type SendFn = (message: Record<string, unknown>) => boolean;

/**
 * Server frame envelope. Only the `type` discriminant is required —
 * additional fields are dispatched into the matching listener.
 */
export interface ServerFrame {
	type: string;
	[key: string]: unknown;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Per-frame waiting promise (used by spawn/kill round-trips). Keyed by
 * sessionId so multiple in-flight calls don't collide.
 */
interface PendingResult<T> {
	resolve: (value: T) => void;
	reject: (err: Error) => void;
}

/**
 * Per-sessionId subscriber registries. We use Sets so subscribers can be
 * added/removed by reference (matches the Electron preload's
 * `ipcRenderer.removeListener(handler)` semantics).
 */
type DataListener = (event: ProcessDataEvent) => void;
type ExitListener = (event: ProcessExitEvent) => void;
type ThinkingListener = (sessionId: string, content: string) => void;
type ToolExecListener = (sessionId: string, toolEvent: ToolExecutionEvent) => void;

export interface ProcessLifecycleClient {
	/**
	 * Spawn a process for the given session. Returns the server's
	 * `process_spawn_result` payload. Resolves `{pid: -1, success: false}`
	 * when the server reports a soft failure; rejects when the WS send
	 * fails OR an `error` frame arrives carrying the same sessionId before
	 * the result.
	 */
	spawn(config: ProcessSpawnConfig): Promise<ProcessSpawnResult>;

	/** Kill a session's process. Returns the `success` field verbatim. */
	kill(sessionId: string): Promise<boolean>;

	/**
	 * Subscribe to `process_data` frames for one session. Listener is
	 * invoked per chunk, in arrival order, synchronously from the WS
	 * message handler — no batching, no newline framing.
	 */
	onData(sessionId: string, listener: DataListener): Unsubscribe;

	/** Subscribe to `process_exit` for one session. */
	onExit(sessionId: string, listener: ExitListener): Unsubscribe;

	/**
	 * OPTIONAL capability — subscribe to `process_thinking_chunk` frames.
	 * The frame only arrives for agents that emit partial thinking events
	 * (Claude Code today). Callers MUST tolerate the listener never firing.
	 */
	onThinkingChunk(sessionId: string, listener: ThinkingListener): Unsubscribe;

	/**
	 * OPTIONAL capability — subscribe to `process_tool_execution` frames.
	 * The frame only arrives for agents that surface structured tool
	 * events (OpenCode, Codex today). Callers MUST tolerate the listener
	 * never firing.
	 */
	onToolExecution(sessionId: string, listener: ToolExecListener): Unsubscribe;

	/**
	 * Feed a server frame into the dispatcher. App.tsx wires this into
	 * the `onMessage` handler of `useWebSocket`. Returns `true` when the
	 * frame matched a known process-lifecycle type, `false` otherwise so
	 * the caller can chain other dispatchers.
	 */
	handleFrame(frame: ServerFrame): boolean;

	/** Drop every subscriber + pending round-trip. Idempotent. */
	dispose(): void;
}

/**
 * Build a process-lifecycle client around a `send` function.
 *
 * `send` typically comes from `useWebSocket().send`, but any function with
 * the same `(message) => boolean` signature works — including a mock for
 * tests.
 */
export function createProcessLifecycleClient(send: SendFn): ProcessLifecycleClient {
	const dataListeners = new Map<string, Set<DataListener>>();
	const exitListeners = new Map<string, Set<ExitListener>>();
	const thinkingListeners = new Map<string, Set<ThinkingListener>>();
	const toolExecListeners = new Map<string, Set<ToolExecListener>>();

	const pendingSpawns = new Map<string, PendingResult<ProcessSpawnResult>>();
	const pendingKills = new Map<string, PendingResult<boolean>>();

	function registerListener<L>(
		registry: Map<string, Set<L>>,
		sessionId: string,
		listener: L
	): Unsubscribe {
		let bucket = registry.get(sessionId);
		if (!bucket) {
			bucket = new Set();
			registry.set(sessionId, bucket);
		}
		bucket.add(listener);
		return () => {
			const current = registry.get(sessionId);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) registry.delete(sessionId);
		};
	}

	function spawn(config: ProcessSpawnConfig): Promise<ProcessSpawnResult> {
		return new Promise((resolve, reject) => {
			// Re-shape into the wire frame — preserves the snake_case type
			// + camelCase fields convention from the create_session precedent.
			const ok = send({
				type: 'process_spawn',
				...config,
			});
			if (!ok) {
				reject(new Error('WS send failed for process_spawn'));
				return;
			}
			// Replace any prior pending spawn on the same sessionId — a re-spawn
			// before the previous result lands is a caller error; we surface it
			// by rejecting the stale promise.
			const prev = pendingSpawns.get(config.sessionId);
			if (prev) {
				prev.reject(new Error('Superseded by a later process_spawn for the same sessionId'));
			}
			pendingSpawns.set(config.sessionId, { resolve, reject });
		});
	}

	function kill(sessionId: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const ok = send({ type: 'process_kill', sessionId });
			if (!ok) {
				reject(new Error('WS send failed for process_kill'));
				return;
			}
			const prev = pendingKills.get(sessionId);
			if (prev) {
				prev.reject(new Error('Superseded by a later process_kill for the same sessionId'));
			}
			pendingKills.set(sessionId, { resolve, reject });
		});
	}

	function handleFrame(frame: ServerFrame): boolean {
		switch (frame.type) {
			case 'process_spawn_result': {
				const sessionId = frame.sessionId as string | undefined;
				if (!sessionId) return true;
				const pending = pendingSpawns.get(sessionId);
				if (pending) {
					pendingSpawns.delete(sessionId);
					pending.resolve({
						pid: (frame.pid as number | undefined) ?? -1,
						success: (frame.success as boolean | undefined) ?? false,
						sshRemoteUsed: (frame.sshRemoteUsed as string | null | undefined) ?? null,
					});
				}
				return true;
			}
			case 'process_kill_result': {
				const sessionId = frame.sessionId as string | undefined;
				if (!sessionId) return true;
				const pending = pendingKills.get(sessionId);
				if (pending) {
					pendingKills.delete(sessionId);
					pending.resolve((frame.success as boolean | undefined) ?? false);
				}
				return true;
			}
			case 'process_data': {
				// Contract vector 2 — synchronous per-chunk dispatch, no buffering.
				const sessionId = frame.sessionId as string | undefined;
				const chunk = frame.chunk as string | undefined;
				const source = frame.source as 'stdout' | 'stderr' | undefined;
				if (!sessionId || chunk === undefined || !source) return true;
				const bucket = dataListeners.get(sessionId);
				if (bucket) {
					for (const listener of bucket) {
						listener({ sessionId, chunk, source });
					}
				}
				return true;
			}
			case 'process_exit': {
				const sessionId = frame.sessionId as string | undefined;
				if (!sessionId) return true;
				const code = (frame.code as number | undefined) ?? 0;
				const signal = (frame.signal as string | null | undefined) ?? null;
				const bucket = exitListeners.get(sessionId);
				if (bucket) {
					for (const listener of bucket) {
						listener({ sessionId, code, signal });
					}
				}
				return true;
			}
			case 'process_thinking_chunk': {
				// Contract vector 3 — OPTIONAL. Frame only arrives for agents
				// that surface partial-thinking events.
				const sessionId = frame.sessionId as string | undefined;
				const content = frame.content as string | undefined;
				if (!sessionId || content === undefined) return true;
				const bucket = thinkingListeners.get(sessionId);
				if (bucket) {
					for (const listener of bucket) {
						listener(sessionId, content);
					}
				}
				return true;
			}
			case 'process_tool_execution': {
				// Contract vector 3 — OPTIONAL. Frame only arrives for agents
				// that surface structured tool-execution events.
				const sessionId = frame.sessionId as string | undefined;
				const toolEvent = frame.toolEvent as ToolExecutionEvent | undefined;
				if (!sessionId || !toolEvent) return true;
				const bucket = toolExecListeners.get(sessionId);
				if (bucket) {
					for (const listener of bucket) {
						listener(sessionId, toolEvent);
					}
				}
				return true;
			}
			default:
				return false;
		}
	}

	function dispose(): void {
		dataListeners.clear();
		exitListeners.clear();
		thinkingListeners.clear();
		toolExecListeners.clear();
		for (const pending of pendingSpawns.values()) {
			pending.reject(new Error('ProcessLifecycleClient disposed'));
		}
		for (const pending of pendingKills.values()) {
			pending.reject(new Error('ProcessLifecycleClient disposed'));
		}
		pendingSpawns.clear();
		pendingKills.clear();
	}

	return {
		spawn,
		kill,
		onData: (sessionId, listener) => registerListener(dataListeners, sessionId, listener),
		onExit: (sessionId, listener) => registerListener(exitListeners, sessionId, listener),
		onThinkingChunk: (sessionId, listener) =>
			registerListener(thinkingListeners, sessionId, listener),
		onToolExecution: (sessionId, listener) =>
			registerListener(toolExecListeners, sessionId, listener),
		handleFrame,
		dispose,
	};
}
