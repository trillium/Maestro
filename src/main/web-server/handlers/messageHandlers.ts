/**
 * WebSocket Message Handlers for Web Server
 *
 * This module contains all WebSocket message handlers extracted from web-server.ts.
 * It handles incoming messages from web clients including commands, mode switching,
 * session/tab management, and health checks.
 *
 * Message Types Handled:
 * - ping: Health check, responds with pong
 * - subscribe: Subscribe to session updates
 * - send_command: Execute command in session (AI or terminal)
 * - switch_mode: Switch between AI and terminal mode
 * - select_session: Select/switch to a session in desktop
 * - get_sessions: Request updated sessions list
 * - select_tab: Select a tab within a session
 * - new_tab: Create a new tab within a session
 * - close_tab: Close a tab within a session
 * - rename_tab: Rename a tab within a session
 */

import { WebSocket } from 'ws';
import { logger } from '../../utils/logger';

// Logger context for all message handler logs
const LOG_CONTEXT = 'WebServer';

/**
 * Web client message interface
 */
export interface WebClientMessage {
	type: string;
	sessionId?: string;
	tabId?: string;
	command?: string;
	mode?: 'ai' | 'terminal';
	inputMode?: 'ai' | 'terminal';
	newName?: string;
	[key: string]: unknown;
}

/**
 * Web client connection info
 */
export interface WebClient {
	socket: WebSocket;
	id: string;
	connectedAt: number;
	subscribedSessionId?: string;
}

/**
 * Session detail for command validation
 */
export interface SessionDetailForHandler {
	state: string;
	inputMode: string;
	agentSessionId?: string;
}

/**
 * Live session info for enriching sessions
 */
export interface LiveSessionInfo {
	sessionId: string;
	agentSessionId?: string;
	enabledAt: number;
}

/**
 * Audit #13 — webFull `NewInstanceModal` `onCreate` wiring. Mirrors the
 * renderer's `useSessionCrud.createNewSession` arg shape so the client can
 * forward the modal's submission directly.
 *
 * Duplicated from `web-server/types.ts#CreateSessionRequest` to keep this
 * module free of cross-imports (the existing handler module follows the same
 * "interfaces local to the handler file" convention for the other callback
 * shapes — `MessageHandlerCallbacks`, `LiveSessionInfo`, etc.).
 */
export interface CreateSessionMessageRequest {
	agentId: string;
	workingDir: string;
	name: string;
	nudgeMessage?: string;
	customPath?: string;
	customArgs?: string;
	customEnvVars?: Record<string, string>;
	customModel?: string;
	customContextWindow?: number;
	customProviderPath?: string;
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
	groupId?: string;
}

/**
 * WS process-lifecycle family — `process_spawn` Client→Server frame payload.
 *
 * Mirror of the Electron `process:spawn` payload at
 * `src/main/ipc/handlers/process.ts:85-117` — the relevant subset that
 * webFull callers send across the wire. Renderer-side spawn options that
 * the webFull surface doesn't yet expose (`querySource`, `tabId`,
 * `readOnlyMode`, `yoloMode`, `modelId`, `agentSessionId`, etc.) are kept
 * optional so future client features can opt in without a contract bump.
 *
 * **SSH passthrough.** `sessionSshRemoteConfig` is the load-bearing field —
 * the server-side handler MUST forward it to `wrapSpawnWithSsh()` BEFORE
 * `ProcessManager.spawn()` (matches the `create_session` precedent at
 * `messageHandlers.ts:609-611`).
 *
 * Per umbrella Decision 2026-06-08
 * (`docs/ws-process-lifecycle-decision`, commit `9ec71a510`):
 * snake_case frame field on the wire, camelCase TS field in code.
 */
export interface ProcessSpawnMessageRequest {
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
	/** Load-bearing SSH passthrough — see contract vector 1 in umbrella Decision. */
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

/**
 * WS process-lifecycle family — server-side spawn callback contract.
 *
 * Returns `{pid, success}` matching the Electron `process:spawn` IPC return
 * shape. `null` indicates the callback is not configured OR the spawn
 * failed before producing a result. The server-side wiring in
 * `src/server/index.ts` MUST route through `wrapSpawnWithSsh` BEFORE
 * invoking `ProcessManager.spawn`.
 */
export type ProcessSpawnCallback = (
	request: ProcessSpawnMessageRequest
) => Promise<{ pid: number; success: boolean; sshRemoteUsed?: string | null } | null>;

/**
 * WS process-lifecycle family — server-side kill callback contract.
 *
 * Mirrors the Electron `process:kill` IPC at
 * `src/main/ipc/handlers/process.ts:599`. Returns whether the process was
 * tracked + signaled; `false` includes the "no such process" case.
 */
export type ProcessKillCallback = (sessionId: string) => Promise<boolean>;

/**
 * Layer 6.1: raw PTY callbacks. Implemented server-side by wiring through
 * RawPtyMultiplexer + ProcessManager. The MessageHandler stays decoupled
 * from those concretions via this callback shape. All four are optional —
 * a deployment that hasn't wired the multiplexer (e.g. the desktop Electron
 * server) simply doesn't receive any pty_* messages.
 */
export interface PtyMessageCallbacks {
	/**
	 * Subscribe a client to a session's raw PTY stream. Implementations
	 * should: (a) register the client with the multiplexer using
	 * `subscribe(sessionId, clientId, lastSeq)`, (b) immediately deliver
	 * any backfill bytes via `broadcastPtyBackfill`, and (c) deliver a
	 * `broadcastPtyDropped` marker first if the ring rotated past lastSeq.
	 * Returns true if the session exists / subscription succeeded.
	 */
	ptySubscribe: (clientId: string, sessionId: string, lastSeq?: number) => boolean;
	/** Drop the client from one session. */
	ptyUnsubscribe: (clientId: string, sessionId: string) => void;
	/** Write decoded bytes to the PTY's stdin (delegates to processManager.write). */
	ptyInput: (sessionId: string, data: string) => boolean;
	/** Forward a SIGWINCH-equivalent resize to the PTY (processManager.resize). */
	ptyResize: (sessionId: string, cols: number, rows: number) => boolean;
}

/**
 * Callbacks required by the message handler
 */
export interface MessageHandlerCallbacks {
	getSessionDetail: (sessionId: string) => SessionDetailForHandler | null;
	executeCommand: (
		sessionId: string,
		command: string,
		inputMode?: 'ai' | 'terminal'
	) => Promise<boolean>;
	switchMode: (sessionId: string, mode: 'ai' | 'terminal') => Promise<boolean>;
	selectSession: (sessionId: string, tabId?: string) => Promise<boolean>;
	selectTab: (sessionId: string, tabId: string) => Promise<boolean>;
	newTab: (sessionId: string) => Promise<{ tabId: string } | null>;
	/**
	 * Audit #13 — webFull `NewInstanceModal` `onCreate` wiring. Mirrors the
	 * renderer's `useSessionCrud.createNewSession` arg shape so the client can
	 * forward the modal's submission directly. Returns `{ sessionId }` on
	 * success or `null` on validation / persistence failure.
	 */
	createSession: (request: CreateSessionMessageRequest) => Promise<{ sessionId: string } | null>;
	closeTab: (sessionId: string, tabId: string) => Promise<boolean>;
	renameTab: (sessionId: string, tabId: string, newName: string) => Promise<boolean>;
	starTab: (sessionId: string, tabId: string, starred: boolean) => Promise<boolean>;
	reorderTab: (sessionId: string, fromIndex: number, toIndex: number) => Promise<boolean>;
	toggleBookmark: (sessionId: string) => Promise<boolean>;
	getSessions: () => Array<{
		id: string;
		name: string;
		toolType: string;
		state: string;
		inputMode: string;
		cwd: string;
		agentSessionId?: string | null;
	}>;
	getLiveSessionInfo: (sessionId: string) => LiveSessionInfo | undefined;
	isSessionLive: (sessionId: string) => boolean;
	/**
	 * WS process-lifecycle family — `process_spawn` Client→Server frame.
	 * Optional so the Electron desktop server (which owns the `process:*`
	 * IPC namespace directly) can omit; the headless webFull server wires
	 * it through `wrapSpawnWithSsh` + `ProcessManager.spawn`.
	 */
	processSpawn?: ProcessSpawnCallback;
	/**
	 * WS process-lifecycle family — `process_kill` Client→Server frame.
	 * Optional for the same reason as `processSpawn`.
	 */
	processKill?: ProcessKillCallback;
	// Layer 6.1 raw PTY surface (optional — Electron desktop server omits)
	ptySubscribe?: PtyMessageCallbacks['ptySubscribe'];
	ptyUnsubscribe?: PtyMessageCallbacks['ptyUnsubscribe'];
	ptyInput?: PtyMessageCallbacks['ptyInput'];
	ptyResize?: PtyMessageCallbacks['ptyResize'];
}

/**
 * WebSocket Message Handler Class
 *
 * Handles all incoming WebSocket messages from web clients.
 * Uses dependency injection for callbacks to maintain separation from WebServer class.
 */
export class WebSocketMessageHandler {
	private callbacks: Partial<MessageHandlerCallbacks> = {};

	/**
	 * Set the callbacks for message handling
	 */
	setCallbacks(callbacks: Partial<MessageHandlerCallbacks>): void {
		this.callbacks = { ...this.callbacks, ...callbacks };
	}

	/**
	 * Helper to send a JSON message to a client with timestamp
	 */
	private send(client: WebClient, data: Record<string, unknown>): void {
		client.socket.send(JSON.stringify({ ...data, timestamp: Date.now() }));
	}

	/**
	 * Helper to send an error message to a client
	 */
	private sendError(client: WebClient, message: string, extra?: Record<string, unknown>): void {
		this.send(client, { type: 'error', message, ...extra });
	}

	/**
	 * Handle incoming WebSocket message from a web client
	 *
	 * @param client - The web client connection info
	 * @param message - The parsed message from the client
	 */
	handleMessage(client: WebClient, message: WebClientMessage): void {
		// Log all incoming messages for debugging
		logger.info(
			`[Web] handleWebClientMessage: type=${message.type}, clientId=${client.id}`,
			LOG_CONTEXT
		);

		switch (message.type) {
			case 'ping':
				this.handlePing(client);
				break;

			case 'subscribe':
				this.handleSubscribe(client, message);
				break;

			case 'send_command':
				this.handleSendCommand(client, message);
				break;

			case 'switch_mode':
				this.handleSwitchMode(client, message);
				break;

			case 'select_session':
				this.handleSelectSession(client, message);
				break;

			case 'get_sessions':
				this.handleGetSessions(client);
				break;

			case 'select_tab':
				this.handleSelectTab(client, message);
				break;

			case 'new_tab':
				this.handleNewTab(client, message);
				break;

			case 'create_session':
				this.handleCreateSession(client, message);
				break;

			case 'close_tab':
				this.handleCloseTab(client, message);
				break;

			case 'rename_tab':
				this.handleRenameTab(client, message);
				break;

			case 'star_tab':
				this.handleStarTab(client, message);
				break;

			case 'reorder_tab':
				this.handleReorderTab(client, message);
				break;

			case 'toggle_bookmark':
				this.handleToggleBookmark(client, message);
				break;

			// WS process-lifecycle family (umbrella Decision 2026-06-08).
			// `process_spawn` / `process_kill` are the Client→Server frames;
			// the matching Server→Client emissions (`process_data`,
			// `process_exit`, `process_thinking_chunk`, `process_tool_execution`)
			// are pushed by listeners wired in `src/server/index.ts` against
			// the shared `ProcessManager` singleton.
			case 'process_spawn':
				this.handleProcessSpawn(client, message);
				break;

			case 'process_kill':
				this.handleProcessKill(client, message);
				break;

			// Layer 6.1: raw PTY protocol — see scoping doc §2.
			case 'pty_subscribe':
				this.handlePtySubscribe(client, message);
				break;

			case 'pty_unsubscribe':
				this.handlePtyUnsubscribe(client, message);
				break;

			case 'pty_input':
				this.handlePtyInput(client, message);
				break;

			case 'pty_resize':
				this.handlePtyResize(client, message);
				break;

			default:
				this.handleUnknown(client, message);
		}
	}

	/**
	 * Handle ping message - respond with pong
	 */
	private handlePing(client: WebClient): void {
		this.send(client, { type: 'pong' });
	}

	/**
	 * Handle subscribe message - update client's session subscription
	 */
	private handleSubscribe(client: WebClient, message: WebClientMessage): void {
		if (message.sessionId) {
			client.subscribedSessionId = message.sessionId as string;
		}
		this.send(client, { type: 'subscribed', sessionId: message.sessionId });
	}

	/**
	 * Handle send_command message - execute command in session
	 */
	private handleSendCommand(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const command = message.command as string;
		// inputMode from web client - use this instead of server state to avoid sync issues
		const clientInputMode = message.inputMode as 'ai' | 'terminal' | undefined;

		logger.info(
			`[Web Command] Received: sessionId=${sessionId}, inputMode=${clientInputMode}, command=${command?.substring(
				0,
				50
			)}`,
			LOG_CONTEXT
		);

		if (!sessionId || !command) {
			logger.warn(
				`[Web Command] Missing sessionId or command: sessionId=${sessionId}, commandLen=${command?.length}`,
				LOG_CONTEXT
			);
			this.sendError(client, 'Missing sessionId or command');
			return;
		}

		// Get session details to check state and determine how to handle
		const sessionDetail = this.callbacks.getSessionDetail?.(sessionId);
		if (!sessionDetail) {
			this.sendError(client, 'Session not found');
			return;
		}

		// Check if session is busy - prevent race conditions between desktop and web
		if (sessionDetail.state === 'busy') {
			this.sendError(
				client,
				'Session is busy - please wait for the current operation to complete',
				{
					sessionId,
				}
			);
			logger.debug(`Command rejected - session ${sessionId} is busy`, LOG_CONTEXT);
			return;
		}

		// Use client's inputMode if provided, otherwise fall back to server state
		const effectiveMode = clientInputMode || sessionDetail.inputMode;
		const isAiMode = effectiveMode === 'ai';
		const mode = isAiMode ? 'AI' : 'CLI';
		const claudeId = sessionDetail.agentSessionId || 'none';

		// Log all web interface commands prominently
		logger.info(
			`[Web Command] Mode: ${mode} | Session: ${sessionId}${
				isAiMode ? ` | Claude: ${claudeId}` : ''
			} | Message: ${command}`,
			LOG_CONTEXT
		);

		// Route ALL commands through the renderer for consistent handling
		// The renderer handles both AI and terminal modes, updating UI and state
		// Pass clientInputMode so renderer uses the web's intended mode
		if (this.callbacks.executeCommand) {
			this.callbacks
				.executeCommand(sessionId, command, clientInputMode)
				.then((success) => {
					this.send(client, { type: 'command_result', success, sessionId });
					if (!success) {
						logger.warn(
							`[Web Command] ${mode} command rejected for session ${sessionId}`,
							LOG_CONTEXT
						);
					}
				})
				.catch((error) => {
					logger.error(
						`[Web Command] ${mode} command failed for session ${sessionId}: ${error.message}`,
						LOG_CONTEXT
					);
					this.sendError(client, `Failed to execute command: ${error.message}`);
				});
		} else {
			this.sendError(client, 'Command execution not configured');
		}
	}

	/**
	 * Handle switch_mode message - switch between AI and terminal mode
	 */
	private handleSwitchMode(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const mode = message.mode as 'ai' | 'terminal';
		logger.info(
			`[Web] Received switch_mode message: session=${sessionId}, mode=${mode}`,
			LOG_CONTEXT
		);

		if (!sessionId || !mode) {
			this.sendError(client, 'Missing sessionId or mode');
			return;
		}

		if (!this.callbacks.switchMode) {
			logger.warn(`[Web] switchModeCallback is not set!`, LOG_CONTEXT);
			this.sendError(client, 'Mode switching not configured');
			return;
		}

		// Forward to desktop's mode switching logic
		// This ensures single source of truth - desktop handles state updates and broadcasts
		logger.info(`[Web] Calling switchModeCallback for session ${sessionId}: ${mode}`, LOG_CONTEXT);
		this.callbacks
			.switchMode(sessionId, mode)
			.then((success) => {
				this.send(client, { type: 'mode_switch_result', success, sessionId, mode });
				logger.debug(
					`Mode switch for session ${sessionId} to ${mode}: ${success ? 'success' : 'failed'}`,
					LOG_CONTEXT
				);
			})
			.catch((error) => {
				this.sendError(client, `Failed to switch mode: ${error.message}`);
			});
	}

	/**
	 * Handle select_session message - select/switch to a session in desktop
	 */
	private handleSelectSession(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const tabId = message.tabId as string | undefined;
		logger.info(
			`[Web] Received select_session message: session=${sessionId}, tab=${tabId || 'none'}`,
			LOG_CONTEXT
		);

		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}

		if (!this.callbacks.selectSession) {
			logger.warn(`[Web] selectSessionCallback is not set!`, LOG_CONTEXT);
			this.sendError(client, 'Session selection not configured');
			return;
		}

		// Forward to desktop's session selection logic (include tabId if provided)
		logger.info(
			`[Web] Calling selectSessionCallback for session ${sessionId}${
				tabId ? `, tab ${tabId}` : ''
			}`,
			LOG_CONTEXT
		);
		this.callbacks
			.selectSession(sessionId, tabId)
			.then((success) => {
				if (success) {
					// Subscribe client to this session's output so they receive session_output messages
					client.subscribedSessionId = sessionId;
					logger.debug(`Session ${sessionId} selected in desktop, client subscribed`, LOG_CONTEXT);
				} else {
					logger.warn(`Failed to select session ${sessionId} in desktop`, LOG_CONTEXT);
				}
				this.send(client, { type: 'select_session_result', success, sessionId });
			})
			.catch((error) => {
				this.sendError(client, `Failed to select session: ${error.message}`);
			});
	}

	/**
	 * Handle get_sessions message - request updated sessions list
	 */
	private handleGetSessions(client: WebClient): void {
		if (
			this.callbacks.getSessions &&
			this.callbacks.getLiveSessionInfo &&
			this.callbacks.isSessionLive
		) {
			const allSessions = this.callbacks.getSessions();
			// Enrich sessions with live info if available
			const sessionsWithLiveInfo = allSessions.map((s) => {
				const liveInfo = this.callbacks.getLiveSessionInfo!(s.id);
				return {
					...s,
					agentSessionId: liveInfo?.agentSessionId || s.agentSessionId,
					liveEnabledAt: liveInfo?.enabledAt,
					isLive: this.callbacks.isSessionLive!(s.id),
				};
			});
			this.send(client, { type: 'sessions_list', sessions: sessionsWithLiveInfo });
		}
	}

	/**
	 * Handle select_tab message - select a tab within a session
	 */
	private handleSelectTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const tabId = message.tabId as string;
		logger.info(
			`[Web] Received select_tab message: session=${sessionId}, tab=${tabId}`,
			LOG_CONTEXT
		);

		if (!sessionId || !tabId) {
			this.sendError(client, 'Missing sessionId or tabId');
			return;
		}

		if (!this.callbacks.selectTab) {
			this.sendError(client, 'Tab selection not configured');
			return;
		}

		this.callbacks
			.selectTab(sessionId, tabId)
			.then((success) => {
				this.send(client, { type: 'select_tab_result', success, sessionId, tabId });
			})
			.catch((error) => {
				this.sendError(client, `Failed to select tab: ${error.message}`);
			});
	}

	/**
	 * Handle new_tab message - create a new tab within a session
	 */
	private handleNewTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		logger.info(`[Web] Received new_tab message: session=${sessionId}`, LOG_CONTEXT);

		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}

		if (!this.callbacks.newTab) {
			this.sendError(client, 'Tab creation not configured');
			return;
		}

		this.callbacks
			.newTab(sessionId)
			.then((result) => {
				this.send(client, {
					type: 'new_tab_result',
					success: !!result,
					sessionId,
					tabId: result?.tabId,
				});
			})
			.catch((error) => {
				this.sendError(client, `Failed to create tab: ${error.message}`);
			});
	}

	/**
	 * Handle create_session message — create a brand-new session.
	 *
	 * Audit #13. The renderer ships this via direct store mutation; on webFull
	 * the client sends a `create_session` WS frame with the same arg shape as
	 * `useSessionCrud.createNewSession`. The server applies the mutation,
	 * persists, broadcasts `session_added`, and responds with `create_session_result`.
	 *
	 * Validation surface is intentionally thin — the modal already enforces
	 * the renderer's validation rules (non-empty name, non-empty cwd, agent
	 * selection). The server only re-checks the bare minimum (agentId / name /
	 * workingDir present) so a malformed client frame doesn't poison the store.
	 */
	private handleCreateSession(client: WebClient, message: WebClientMessage): void {
		const agentId = message.agentId as string | undefined;
		const workingDir = message.workingDir as string | undefined;
		const name = message.name as string | undefined;

		logger.info(
			`[Web] Received create_session message: agentId=${agentId}, name=${name}, cwd=${workingDir}`,
			LOG_CONTEXT
		);

		if (!agentId || !workingDir || !name) {
			this.sendError(client, 'Missing agentId, workingDir, or name');
			return;
		}

		if (!this.callbacks.createSession) {
			this.sendError(client, 'Session creation not configured');
			return;
		}

		const request: CreateSessionMessageRequest = {
			agentId,
			workingDir,
			name,
			nudgeMessage: message.nudgeMessage as string | undefined,
			customPath: message.customPath as string | undefined,
			customArgs: message.customArgs as string | undefined,
			customEnvVars: message.customEnvVars as Record<string, string> | undefined,
			customModel: message.customModel as string | undefined,
			customContextWindow: message.customContextWindow as number | undefined,
			customProviderPath: message.customProviderPath as string | undefined,
			sessionSshRemoteConfig: message.sessionSshRemoteConfig as
				| { enabled: boolean; remoteId: string | null; workingDirOverride?: string }
				| undefined,
			groupId: message.groupId as string | undefined,
		};

		this.callbacks
			.createSession(request)
			.then((result) => {
				this.send(client, {
					type: 'create_session_result',
					success: !!result,
					sessionId: result?.sessionId,
				});
				if (!result) {
					logger.warn(
						`[Web] create_session rejected (agent=${agentId}, name=${name})`,
						LOG_CONTEXT
					);
				}
			})
			.catch((error) => {
				this.sendError(client, `Failed to create session: ${error.message}`);
			});
	}

	/**
	 * Handle process_spawn message — spawn a managed process for a session.
	 *
	 * Umbrella Decision 2026-06-08 (`docs/ws-process-lifecycle-decision`).
	 * Mirrors the Electron `process:spawn` IPC handler at
	 * `src/main/ipc/handlers/process.ts:81-117`.
	 *
	 * **SSH passthrough is load-bearing.** This handler forwards the entire
	 * payload (including `sessionSshRemoteConfig`) to the wired callback,
	 * which MUST route through `wrapSpawnWithSsh()` BEFORE invoking
	 * `ProcessManager.spawn` — matching the `create_session` precedent.
	 * The handler itself does NOT touch the SSH layer; that contract lives
	 * with the callback wiring in `src/server/index.ts`.
	 *
	 * Validation surface is intentionally thin (mirrors `handleCreateSession`):
	 * required {sessionId, toolType, cwd, command, args} only. Optional
	 * fields are forwarded verbatim when present, OMITTED when undefined.
	 */
	private handleProcessSpawn(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;
		const toolType = message.toolType as string | undefined;
		const cwd = message.cwd as string | undefined;
		const command = message.command as string | undefined;
		const args = message.args as string[] | undefined;

		logger.info(
			`[Web] Received process_spawn message: session=${sessionId}, toolType=${toolType}, cmd=${command}`,
			LOG_CONTEXT
		);

		if (!sessionId || !toolType || !cwd || !command || !Array.isArray(args)) {
			this.sendError(client, 'Missing required fields (sessionId, toolType, cwd, command, args[])');
			return;
		}

		if (!this.callbacks.processSpawn) {
			this.sendError(client, 'Process spawn not configured');
			return;
		}

		const request: ProcessSpawnMessageRequest = {
			sessionId,
			toolType,
			cwd,
			command,
			args,
			prompt: message.prompt as string | undefined,
			shell: message.shell as string | undefined,
			images: message.images as string[] | undefined,
			agentSessionId: message.agentSessionId as string | undefined,
			readOnlyMode: message.readOnlyMode as boolean | undefined,
			modelId: message.modelId as string | undefined,
			yoloMode: message.yoloMode as boolean | undefined,
			querySource: message.querySource as 'user' | 'auto' | undefined,
			tabId: message.tabId as string | undefined,
			sessionCustomPath: message.sessionCustomPath as string | undefined,
			sessionCustomArgs: message.sessionCustomArgs as string | undefined,
			sessionCustomEnvVars: message.sessionCustomEnvVars as Record<string, string> | undefined,
			sessionCustomModel: message.sessionCustomModel as string | undefined,
			sessionCustomContextWindow: message.sessionCustomContextWindow as number | undefined,
			// SSH passthrough — contract vector 1 in umbrella Decision. Forwarded
			// verbatim; the callback wires it to `wrapSpawnWithSsh`.
			sessionSshRemoteConfig: message.sessionSshRemoteConfig as
				| { enabled: boolean; remoteId: string | null; workingDirOverride?: string }
				| undefined,
		};

		this.callbacks
			.processSpawn(request)
			.then((result) => {
				this.send(client, {
					type: 'process_spawn_result',
					success: !!result?.success,
					sessionId,
					pid: result?.pid ?? -1,
					sshRemoteUsed: result?.sshRemoteUsed ?? null,
				});
				if (!result || !result.success) {
					logger.warn(
						`[Web] process_spawn failed (session=${sessionId}, toolType=${toolType})`,
						LOG_CONTEXT
					);
				}
			})
			.catch((error) => {
				this.sendError(client, `Failed to spawn process: ${error.message}`);
			});
	}

	/**
	 * Handle process_kill message — terminate a managed process by sessionId.
	 *
	 * Umbrella Decision 2026-06-08. Mirrors the Electron `process:kill`
	 * IPC handler at `src/main/ipc/handlers/process.ts:599`.
	 */
	private handleProcessKill(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;

		logger.info(`[Web] Received process_kill message: session=${sessionId}`, LOG_CONTEXT);

		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}

		if (!this.callbacks.processKill) {
			this.sendError(client, 'Process kill not configured');
			return;
		}

		this.callbacks
			.processKill(sessionId)
			.then((success) => {
				this.send(client, {
					type: 'process_kill_result',
					success,
					sessionId,
				});
			})
			.catch((error) => {
				this.sendError(client, `Failed to kill process: ${error.message}`);
			});
	}

	/**
	 * Handle close_tab message - close a tab within a session
	 */
	private handleCloseTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const tabId = message.tabId as string;
		logger.info(
			`[Web] Received close_tab message: session=${sessionId}, tab=${tabId}`,
			LOG_CONTEXT
		);

		if (!sessionId || !tabId) {
			this.sendError(client, 'Missing sessionId or tabId');
			return;
		}

		if (!this.callbacks.closeTab) {
			this.sendError(client, 'Tab closing not configured');
			return;
		}

		this.callbacks
			.closeTab(sessionId, tabId)
			.then((success) => {
				this.send(client, { type: 'close_tab_result', success, sessionId, tabId });
			})
			.catch((error) => {
				this.sendError(client, `Failed to close tab: ${error.message}`);
			});
	}

	/**
	 * Handle rename_tab message - rename a tab within a session
	 */
	private handleRenameTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const tabId = message.tabId as string;
		const newName = message.newName as string;
		logger.info(
			`[Web] Received rename_tab message: session=${sessionId}, tab=${tabId}, newName=${newName}`,
			LOG_CONTEXT
		);

		if (!sessionId || !tabId) {
			this.sendError(client, 'Missing sessionId or tabId');
			return;
		}

		if (!this.callbacks.renameTab) {
			this.sendError(client, 'Tab renaming not configured');
			return;
		}

		// newName can be empty string to clear the name
		this.callbacks
			.renameTab(sessionId, tabId, newName || '')
			.then((success) => {
				this.send(client, {
					type: 'rename_tab_result',
					success,
					sessionId,
					tabId,
					newName: newName || '',
				});
			})
			.catch((error) => {
				this.sendError(client, `Failed to rename tab: ${error.message}`);
			});
	}

	/**
	 * Handle star_tab message - star/unstar a tab within a session
	 */
	private handleStarTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const tabId = message.tabId as string;
		const starred = message.starred as boolean;
		logger.info(
			`[Web] Received star_tab message: session=${sessionId}, tab=${tabId}, starred=${starred}`,
			LOG_CONTEXT
		);

		if (!sessionId || !tabId) {
			this.sendError(client, 'Missing sessionId or tabId');
			return;
		}

		if (!this.callbacks.starTab) {
			this.sendError(client, 'Tab starring not configured');
			return;
		}

		this.callbacks
			.starTab(sessionId, tabId, !!starred)
			.then((success) => {
				this.send(client, { type: 'star_tab_result', success, sessionId, tabId, starred });
			})
			.catch((error) => {
				this.sendError(client, `Failed to star tab: ${error.message}`);
			});
	}

	/**
	 * Handle reorder_tab message - move a tab to a new position within a session
	 */
	private handleReorderTab(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		const fromIndex = message.fromIndex as number;
		const toIndex = message.toIndex as number;
		logger.info(
			`[Web] Received reorder_tab message: session=${sessionId}, from=${fromIndex}, to=${toIndex}`,
			LOG_CONTEXT
		);

		if (!sessionId || fromIndex == null || toIndex == null) {
			this.sendError(client, 'Missing sessionId, fromIndex, or toIndex');
			return;
		}

		if (!this.callbacks.reorderTab) {
			this.sendError(client, 'Tab reordering not configured');
			return;
		}

		this.callbacks
			.reorderTab(sessionId, fromIndex, toIndex)
			.then((success) => {
				this.send(client, {
					type: 'reorder_tab_result',
					success,
					sessionId,
					fromIndex,
					toIndex,
				});
			})
			.catch((error) => {
				this.sendError(client, `Failed to reorder tab: ${error.message}`);
			});
	}

	/**
	 * Handle toggle_bookmark message - toggle bookmark state on a session
	 */
	private handleToggleBookmark(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string;
		logger.info(`[Web] Received toggle_bookmark message: session=${sessionId}`, LOG_CONTEXT);

		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}

		if (!this.callbacks.toggleBookmark) {
			this.sendError(client, 'Bookmark toggling not configured');
			return;
		}

		this.callbacks
			.toggleBookmark(sessionId)
			.then((success) => {
				this.send(client, { type: 'toggle_bookmark_result', success, sessionId });
			})
			.catch((error) => {
				this.sendError(client, `Failed to toggle bookmark: ${error.message}`);
			});
	}

	/**
	 * Layer 6.1: handle pty_subscribe — register client for raw-byte stream
	 * on a session, deliver backfill, ack with `pty_subscribed`.
	 *
	 * Protocol shape:
	 *   { type: 'pty_subscribe', sessionId, lastSeq? }
	 *
	 * The server-side `ptySubscribe` callback is responsible for emitting
	 * the backfill `pty_backfill` and (if needed) the preceding `pty_dropped`
	 * marker BEFORE its return — this handler only acks the subscribe.
	 */
	private handlePtySubscribe(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;
		const lastSeqRaw = message.lastSeq;
		const lastSeq = typeof lastSeqRaw === 'number' ? lastSeqRaw : undefined;
		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}
		if (!this.callbacks.ptySubscribe) {
			this.sendError(client, 'PTY subscription not configured', { sessionId });
			return;
		}
		const ok = this.callbacks.ptySubscribe(client.id, sessionId, lastSeq);
		this.send(client, { type: 'pty_subscribed', sessionId, success: ok, lastSeq });
	}

	/**
	 * Layer 6.1: handle pty_unsubscribe — drop client from the multiplexer's
	 * subscriber set for one session. Idempotent.
	 *
	 * Protocol shape:
	 *   { type: 'pty_unsubscribe', sessionId }
	 */
	private handlePtyUnsubscribe(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;
		if (!sessionId) {
			this.sendError(client, 'Missing sessionId');
			return;
		}
		if (this.callbacks.ptyUnsubscribe) {
			this.callbacks.ptyUnsubscribe(client.id, sessionId);
		}
		this.send(client, { type: 'pty_unsubscribed', sessionId });
	}

	/**
	 * Layer 6.1: handle pty_input — decode bytes and write to PTY stdin.
	 *
	 * Protocol shape:
	 *   { type: 'pty_input', sessionId, bytes, encoding?: 'base64' | 'utf8' }
	 *
	 * Default encoding is 'base64' (safe for control bytes like \x1b, \x03).
	 * 'utf8' is accepted for human-typed strings; per-keystroke input from
	 * xterm.js will use 'base64'.
	 */
	private handlePtyInput(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;
		const bytes = message.bytes as string | undefined;
		const encoding = (message.encoding as string | undefined) ?? 'base64';
		if (!sessionId || typeof bytes !== 'string') {
			this.sendError(client, 'Missing sessionId or bytes');
			return;
		}
		if (!this.callbacks.ptyInput) {
			this.sendError(client, 'PTY input not configured', { sessionId });
			return;
		}
		let decoded: string;
		try {
			decoded = encoding === 'utf8' ? bytes : Buffer.from(bytes, 'base64').toString('utf-8');
		} catch (err) {
			this.sendError(client, `Failed to decode pty_input bytes: ${String(err)}`, { sessionId });
			return;
		}
		const ok = this.callbacks.ptyInput(sessionId, decoded);
		if (!ok) {
			logger.debug(`[Web] pty_input write failed for session ${sessionId}`, LOG_CONTEXT);
		}
	}

	/**
	 * Layer 6.1: handle pty_resize — forward cols/rows to the PTY.
	 *
	 * Protocol shape:
	 *   { type: 'pty_resize', sessionId, cols, rows }
	 *
	 * Per scoping doc §2.6: a web-driven resize affects only the bytes the
	 * PTY emits; the desktop renderer ignores raw bytes and its parsed view
	 * is row-agnostic, so resize from web is safe even with desktop attached.
	 */
	private handlePtyResize(client: WebClient, message: WebClientMessage): void {
		const sessionId = message.sessionId as string | undefined;
		const cols = message.cols as number | undefined;
		const rows = message.rows as number | undefined;
		if (!sessionId || typeof cols !== 'number' || typeof rows !== 'number') {
			this.sendError(client, 'Missing sessionId, cols, or rows');
			return;
		}
		if (!this.callbacks.ptyResize) {
			this.sendError(client, 'PTY resize not configured', { sessionId });
			return;
		}
		const ok = this.callbacks.ptyResize(sessionId, cols, rows);
		this.send(client, { type: 'pty_resize_result', sessionId, success: ok, cols, rows });
	}

	/**
	 * Handle unknown message types - echo back for debugging
	 */
	private handleUnknown(client: WebClient, message: WebClientMessage): void {
		logger.debug(`Unknown message type: ${message.type}`, LOG_CONTEXT);
		this.send(client, { type: 'echo', originalType: message.type, data: message });
	}
}
