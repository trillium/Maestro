/**
 * Shared type definitions for the web server module.
 * All web server components should import types from this file to avoid duplication.
 */

import type { WebSocket } from 'ws';
import type { Theme } from '../../shared/theme-types';

// Re-export Theme for convenience
export type { Theme } from '../../shared/theme-types';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Usage stats type for session cost/token tracking.
 */
export interface SessionUsageStats {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	totalCostUsd?: number;
	contextWindow?: number;
}

/**
 * Last response type for mobile preview (truncated to save bandwidth).
 */
export interface LastResponsePreview {
	/** First 3 lines or ~500 chars of the last AI response */
	text: string;
	timestamp: number;
	source: 'stdout' | 'stderr' | 'system';
	/** Total length of the original response */
	fullLength: number;
}

/**
 * AI Tab type for multi-tab support within a Maestro session.
 */
export interface AITabData {
	id: string;
	agentSessionId: string | null;
	name: string | null;
	starred: boolean;
	inputValue: string;
	usageStats?: SessionUsageStats | null;
	createdAt: number;
	state: 'idle' | 'busy';
	thinkingStartTime?: number | null;
}

/**
 * Live session info for tracking live-enabled sessions.
 */
export interface LiveSessionInfo {
	sessionId: string;
	agentSessionId?: string;
	enabledAt: number;
}

/**
 * Custom AI command definition.
 */
export interface CustomAICommand {
	id: string;
	command: string;
	description: string;
	prompt: string;
}

/**
 * Rate limiting configuration for web server endpoints.
 */
export interface RateLimitConfig {
	/** Maximum requests per time window */
	max: number;
	/** Time window in milliseconds */
	timeWindow: number;
	/** Maximum requests for POST endpoints (typically lower) */
	maxPost: number;
	/** Enable/disable rate limiting */
	enabled: boolean;
}

// =============================================================================
// Session Types
// =============================================================================

/**
 * Session data returned by getSessions callback.
 */
export interface SessionData {
	id: string;
	name: string;
	toolType: string;
	state: string;
	inputMode: string;
	cwd: string;
	groupId: string | null;
	groupName: string | null;
	groupEmoji: string | null;
	usageStats?: SessionUsageStats | null;
	lastResponse?: LastResponsePreview | null;
	agentSessionId?: string | null;
	/** Timestamp when AI started thinking (for elapsed time display) */
	thinkingStartTime?: number | null;
	aiTabs?: AITabData[];
	activeTabId?: string;
	/** Whether session is bookmarked (shows in Bookmarks group) */
	bookmarked?: boolean;
}

/**
 * Session detail type for single session endpoint.
 */
export interface SessionDetail {
	id: string;
	name: string;
	toolType: string;
	state: string;
	inputMode: string;
	cwd: string;
	aiLogs?: Array<{ timestamp: number; content: string; type?: string }>;
	shellLogs?: Array<{ timestamp: number; content: string; type?: string }>;
	usageStats?: {
		inputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
	};
	agentSessionId?: string;
	isGitRepo?: boolean;
	activeTabId?: string;
}

/**
 * Session data for broadcast messages.
 */
export interface SessionBroadcastData {
	id: string;
	name: string;
	toolType: string;
	state: string;
	inputMode: string;
	cwd: string;
	groupId?: string | null;
	groupName?: string | null;
	groupEmoji?: string | null;
	/** Worktree subagent support */
	parentSessionId?: string | null;
	worktreeBranch?: string | null;
}

// =============================================================================
// AutoRun Types
// =============================================================================

/**
 * Auto Run state for broadcast messages.
 */
export interface AutoRunState {
	isRunning: boolean;
	totalTasks: number;
	completedTasks: number;
	currentTaskIndex: number;
	isStopping?: boolean;
	/** Total number of documents in the run (multi-document progress) */
	totalDocuments?: number;
	/** Current document being processed (0-based, multi-document progress) */
	currentDocumentIndex?: number;
	/** Total tasks across all documents (multi-document progress) */
	totalTasksAcrossAllDocs?: number;
	/** Completed tasks across all documents (multi-document progress) */
	completedTasksAcrossAllDocs?: number;
}

/**
 * CLI activity data for session state broadcasts.
 */
export interface CliActivity {
	playbookId: string;
	playbookName: string;
	startedAt: number;
}

// =============================================================================
// WebSocket Client Types
// =============================================================================

/**
 * Web client connection info.
 */
export interface WebClient {
	socket: WebSocket;
	id: string;
	connectedAt: number;
	subscribedSessionId?: string;
}

/**
 * Web client message interface.
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

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Callback type for fetching sessions data.
 */
export type GetSessionsCallback = () => SessionData[];

/**
 * Callback type for fetching single session details.
 * Optional tabId allows fetching logs for a specific tab (avoids race conditions).
 */
export type GetSessionDetailCallback = (sessionId: string, tabId?: string) => SessionDetail | null;

/**
 * Callback type for sending commands to a session.
 * Returns true if successful, false if session not found or write failed.
 */
export type WriteToSessionCallback = (sessionId: string, data: string) => boolean;

/**
 * Callback type for executing a command through the desktop's existing logic.
 * This forwards the command to the renderer which handles spawn, state, and broadcasts.
 * Returns true if command was accepted (session not busy).
 * inputMode is optional - if provided, the renderer will use it instead of querying session state.
 */
export type ExecuteCommandCallback = (
	sessionId: string,
	command: string,
	inputMode?: 'ai' | 'terminal'
) => Promise<boolean>;

/**
 * Callback type for interrupting a session through the desktop's existing logic.
 * This forwards to the renderer which handles state updates and broadcasts.
 */
export type InterruptSessionCallback = (sessionId: string) => Promise<boolean>;

/**
 * Callback type for switching session input mode through the desktop's existing logic.
 * This forwards to the renderer which handles state updates and broadcasts.
 */
export type SwitchModeCallback = (sessionId: string, mode: 'ai' | 'terminal') => Promise<boolean>;

/**
 * Callback type for selecting/switching to a session in the desktop app.
 * This forwards to the renderer which handles state updates and broadcasts.
 * Optional tabId to also switch to a specific tab within the session.
 */
export type SelectSessionCallback = (sessionId: string, tabId?: string) => Promise<boolean>;

/**
 * Session-lifecycle callbacks (audit #13 — webFull `NewInstanceModal` wiring).
 *
 * Mirror the shape of the renderer-side `useSessionCrud.createNewSession`
 * args so the `NewInstanceModal` `onCreate` prop can forward directly. All
 * fields beyond `agentId` / `workingDir` / `name` are optional — the modal
 * passes whatever it has collected. The server-side mutator persists them
 * verbatim so the lazy-spawn `executeCommand` path reads the same shape the
 * renderer's `ProcessManager.spawn` does.
 */
export interface CreateSessionRequest {
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

export type CreateSessionCallback = (
	request: CreateSessionRequest
) => Promise<{ sessionId: string } | null>;

/**
 * WS process-lifecycle family — `process_spawn` Client→Server frame payload.
 *
 * Umbrella Decision 2026-06-08 (`docs/ws-process-lifecycle-decision`,
 * commit `9ec71a510`). Mirrors the relevant subset of the Electron
 * `process:spawn` IPC payload at `src/main/ipc/handlers/process.ts:85-117`.
 *
 * Optional fields are forwarded verbatim when present, OMITTED when
 * undefined (no `undefined` leaks). `sessionSshRemoteConfig` is
 * load-bearing — see contract vector 1 in the Decision.
 *
 * NOTE: duplicated in `web-server/handlers/messageHandlers.ts` as
 * `ProcessSpawnMessageRequest` to keep that module free of cross-imports
 * (same convention as `CreateSessionMessageRequest`).
 */
export interface ProcessSpawnRequest {
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
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

/**
 * WS process-lifecycle family — server-side spawn callback.
 *
 * Returns `{pid, success, sshRemoteUsed?}` on a fulfilled spawn attempt,
 * or `null` when the spawn could not proceed (e.g. validation failure).
 * The callback MUST route through `wrapSpawnWithSsh()` BEFORE invoking
 * `ProcessManager.spawn` — see contract vector 1.
 */
export type ProcessSpawnCallback = (
	request: ProcessSpawnRequest
) => Promise<{ pid: number; success: boolean; sshRemoteUsed?: string | null } | null>;

/**
 * WS process-lifecycle family — server-side kill callback.
 * Mirrors `process:kill` IPC at `src/main/ipc/handlers/process.ts:599`.
 */
export type ProcessKillCallback = (sessionId: string) => Promise<boolean>;

/**
 * Tab operation callbacks for multi-tab support.
 */
export type SelectTabCallback = (sessionId: string, tabId: string) => Promise<boolean>;
export type NewTabCallback = (sessionId: string) => Promise<{ tabId: string } | null>;
export type CloseTabCallback = (sessionId: string, tabId: string) => Promise<boolean>;
export type RenameTabCallback = (
	sessionId: string,
	tabId: string,
	newName: string
) => Promise<boolean>;
export type StarTabCallback = (
	sessionId: string,
	tabId: string,
	starred: boolean
) => Promise<boolean>;
export type ReorderTabCallback = (
	sessionId: string,
	fromIndex: number,
	toIndex: number
) => Promise<boolean>;
export type ToggleBookmarkCallback = (sessionId: string) => Promise<boolean>;

/**
 * Callback type for fetching current theme.
 */
export type GetThemeCallback = () => Theme | null;

/**
 * Callback type for fetching the current global Bionify reading-mode setting.
 */
export type GetBionifyReadingModeCallback = () => boolean;

/**
 * Callback type for fetching custom AI commands.
 */
export type GetCustomCommandsCallback = () => CustomAICommand[];

/**
 * Callback type for fetching history entries.
 * Uses HistoryEntry from shared/types.ts as the canonical type.
 */
export type GetHistoryCallback = (
	projectPath?: string,
	sessionId?: string
) => import('../../shared/types').HistoryEntry[];

/**
 * Callback to get all connected web clients.
 */
export type GetWebClientsCallback = () => Map<string, WebClient>;
