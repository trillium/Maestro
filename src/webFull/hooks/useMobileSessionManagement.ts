/**
 * useMobileSessionManagement - Mobile session state management hook
 *
 * Manages session state for the mobile web interface:
 * - Session and tab selection state
 * - Session logs fetching and state
 * - Session selection handlers (select session, tab, new tab, close tab)
 * - Auto-selection of first session
 * - Sync activeTabId when sessions update
 *
 * Extracted from mobile App.tsx for code organization.
 *
 * @example
 * ```tsx
 * const {
 *   sessions,
 *   activeSessionId,
 *   activeSession,
 *   sessionLogs,
 *   isLoadingLogs,
 *   handleSelectSession,
 *   handleSelectTab,
 *   handleNewTab,
 *   handleCloseTab,
 *   sessionsHandlers,
 * } = useMobileSessionManagement({
 *   savedActiveSessionId: loadedState.activeSessionId,
 *   savedActiveTabId: loadedState.activeTabId,
 *   isOffline,
 *   send,
 *   triggerHaptic,
 * });
 * ```
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Session } from './useSessions';
import type { WebSocketState, AITabData, AutoRunState, CustomCommand } from './useWebSocket';
import { buildApiUrl, getMaestroConfig, updateUrlForSessionTab } from '../utils/config';
import { webLogger } from '../utils/logger';
import type { Theme } from '../../shared/theme-types';

/**
 * Log entry for session message history
 */
export interface LogEntry {
	id: string;
	timestamp: number;
	text: string;
	source: 'user' | 'stdout' | 'stderr';
}

/**
 * Sentinel bucket key for AI log entries that arrive WITHOUT a `tabId`.
 *
 * Origins for tab-less entries:
 *   - In-flight `session_output` frames from a pre-bucketing server build
 *     (back-compat for rolling deploys where the server hasn't been updated
 *     yet — see `src/main/process-listeners/data-listener.ts`, which already
 *     emits `tabId` but historically did not).
 *   - User-input frames (`type: 'user_input'`) that carry only `sessionId` +
 *     `inputMode` — the desktop doesn't track which tab a user-typed command
 *     belongs to in that frame.
 *   - Locally added user log entries via `addUserLogEntry()` invoked outside
 *     a tab-aware code path (e.g. before any tab is selected).
 *
 * Entries in this bucket are surfaced as part of the active tab's logs (via
 * the derived `aiLogs` view) so they remain visible during the back-compat
 * window. New code SHOULD always tag with the current `activeTabId`.
 */
export const AI_LOGS_NO_TAB_BUCKET = '__notab__';

/**
 * Session logs state structure.
 *
 * `aiLogs` is the LEGACY flat view kept for back-compat with consumers that
 * read AI logs at the session level (e.g. `inputMode === 'ai' ? aiLogs : shellLogs`
 * in `App.tsx`). It is derived from `aiLogsByTab` at update time and reflects
 * the union of (a) the currently-active tab's bucket and (b) the no-tab
 * fallback bucket (`AI_LOGS_NO_TAB_BUCKET`).
 *
 * `aiLogsByTab` is the per-tab source of truth. The TerminalOutput adapter in
 * `App.tsx` reads from this map to populate each `aiTab.logs[]` independently
 * so multi-tab sessions show the correct conversation per tab.
 *
 * `shellLogs` stays session-level — shell output is not multiplexed across
 * tabs (every session has at most one shell channel).
 */
export interface SessionLogsState {
	aiLogs: LogEntry[];
	aiLogsByTab: Record<string, LogEntry[]>;
	shellLogs: LogEntry[];
}

/**
 * Haptic pattern type (single number or array of numbers for vibration patterns)
 */
export type HapticPattern = number | readonly number[];

/**
 * Dependencies for useMobileSessionManagement
 */
export interface UseMobileSessionManagementDeps {
	/** Saved active session ID from view state */
	savedActiveSessionId: string | null;
	/** Saved active tab ID from view state */
	savedActiveTabId: string | null;
	/** Whether the device is offline */
	isOffline: boolean;
	/** Ref to WebSocket send function (updated after useWebSocket is initialized) */
	sendRef: React.RefObject<((message: Record<string, unknown>) => boolean) | null>;
	/** Haptic feedback trigger function */
	triggerHaptic: (pattern?: HapticPattern) => void;
	/** Haptic pattern for tap */
	hapticTapPattern: HapticPattern;
	/** Callback when session response completes (for notifications) */
	onResponseComplete?: (session: Session, response?: unknown) => void;
	/** Callback when theme updates from server */
	onThemeUpdate?: (theme: Theme) => void;
	/** Callback when the global Bionify reading-mode setting updates from the server */
	onBionifyReadingModeUpdate?: (enabled: boolean) => void;
	/** Callback when custom commands are received */
	onCustomCommands?: (commands: CustomCommand[]) => void;
	/** Callback when AutoRun state changes */
	onAutoRunStateChange?: (sessionId: string, state: AutoRunState | null) => void;
}

/**
 * WebSocket handlers for session state updates
 * These should be passed to useWebSocket's handlers option
 */
export interface MobileSessionHandlers {
	onConnectionChange: (newState: WebSocketState) => void;
	onError: (err: string) => void;
	onSessionsUpdate: (newSessions: Session[]) => void;
	onSessionStateChange: (
		sessionId: string,
		state: string,
		additionalData?: Partial<Session>
	) => void;
	onSessionAdded: (session: Session) => void;
	onSessionRemoved: (sessionId: string) => void;
	onActiveSessionChanged: (sessionId: string) => void;
	onSessionOutput: (
		sessionId: string,
		data: string,
		source: 'ai' | 'terminal',
		tabId?: string
	) => void;
	onSessionExit: (sessionId: string, exitCode: number) => void;
	onUserInput: (sessionId: string, command: string, inputMode: 'ai' | 'terminal') => void;
	onThemeUpdate: (theme: Theme) => void;
	onBionifyReadingModeUpdate: (enabled: boolean) => void;
	onCustomCommands: (commands: CustomCommand[]) => void;
	onAutoRunStateChange: (sessionId: string, state: AutoRunState | null) => void;
	onTabsChanged: (sessionId: string, aiTabs: AITabData[], newActiveTabId: string) => void;
}

/**
 * Return type for useMobileSessionManagement
 */
export interface UseMobileSessionManagementReturn {
	/** All sessions */
	sessions: Session[];
	/** Set sessions state directly */
	setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
	/** Currently active session ID */
	activeSessionId: string | null;
	/** Set active session ID directly */
	setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
	/** Currently active tab ID */
	activeTabId: string | null;
	/** Set active tab ID directly */
	setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
	/** Currently active session object */
	activeSession: Session | undefined;
	/** Session logs for the active session */
	sessionLogs: SessionLogsState;
	/** Whether logs are currently loading */
	isLoadingLogs: boolean;
	/** Ref tracking active session ID for callbacks */
	activeSessionIdRef: React.RefObject<string | null>;
	/** Handler to select a session (also notifies desktop) */
	handleSelectSession: (sessionId: string) => void;
	/** Handler to select a tab within the active session */
	handleSelectTab: (tabId: string) => void;
	/** Handler to create a new tab in the active session */
	handleNewTab: () => void;
	/** Handler to close a tab in the active session */
	handleCloseTab: (tabId: string) => void;
	/** Handler to rename a tab in the active session */
	handleRenameTab: (tabId: string, newName: string) => void;
	/** Handler to star/unstar a tab in the active session */
	handleStarTab: (tabId: string, starred: boolean) => void;
	/** Handler to reorder a tab in the active session */
	handleReorderTab: (fromIndex: number, toIndex: number) => void;
	/** Handler to toggle bookmark on a session */
	handleToggleBookmark: (sessionId: string) => void;
	/** Add a user input log entry to session logs */
	addUserLogEntry: (text: string, inputMode: 'ai' | 'terminal') => void;
	/** WebSocket handlers for session state updates */
	sessionsHandlers: MobileSessionHandlers;
}

/**
 * Hook for managing session state in the mobile web interface
 *
 * Handles:
 * - Session list state management
 * - Active session/tab selection
 * - Session logs fetching
 * - WebSocket event handlers for session updates
 * - URL synchronization for shareable links
 *
 * @param deps - Dependencies including saved state, network status, and callbacks
 * @returns Session state and handlers
 */
export function useMobileSessionManagement(
	deps: UseMobileSessionManagementDeps
): UseMobileSessionManagementReturn {
	const {
		savedActiveSessionId,
		savedActiveTabId,
		isOffline,
		sendRef,
		triggerHaptic,
		hapticTapPattern,
		onResponseComplete,
		onThemeUpdate,
		onBionifyReadingModeUpdate,
		onCustomCommands,
		onAutoRunStateChange,
	} = deps;

	// Get URL-based session/tab from config (takes precedence over localStorage)
	const config = getMaestroConfig();
	const urlSessionId = config.sessionId;
	const urlTabId = config.tabId;

	// Session state - URL takes precedence over saved state
	const [sessions, setSessions] = useState<Session[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(
		urlSessionId || savedActiveSessionId
	);
	const [activeTabId, setActiveTabId] = useState<string | null>(urlTabId || savedActiveTabId);

	// Session logs state
	const [sessionLogs, setSessionLogs] = useState<SessionLogsState>({
		aiLogs: [],
		aiLogsByTab: {},
		shellLogs: [],
	});
	const [isLoadingLogs, setIsLoadingLogs] = useState(false);

	// Track previous session states for detecting busy -> idle transitions
	const previousSessionStatesRef = useRef<Map<string, string>>(new Map());

	// Ref to track activeSessionId for use in callbacks (avoids stale closure issues)
	// Initialize with same value as state to avoid race condition where WebSocket
	// messages arrive before useEffect syncs the ref
	const activeSessionIdRef = useRef<string | null>(urlSessionId || savedActiveSessionId);
	// Ref to track activeTabId for use in callbacks (avoids stale closure issues)
	const activeTabIdRef = useRef<string | null>(urlTabId || savedActiveTabId);

	// Keep activeSessionIdRef in sync with state
	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	// Keep activeTabIdRef in sync with state
	useEffect(() => {
		activeTabIdRef.current = activeTabId;
	}, [activeTabId]);

	// Update URL to reflect current session and tab (for shareable links)
	// Only update if we're in session mode (not dashboard)
	useEffect(() => {
		if (activeSessionId) {
			updateUrlForSessionTab(activeSessionId, activeTabId);
		}
	}, [activeSessionId, activeTabId]);

	// Get active session object
	const activeSession = useMemo(() => {
		return sessions.find((s) => s.id === activeSessionId);
	}, [sessions, activeSessionId]);

	// Fetch session logs when active session or active tab changes
	useEffect(() => {
		if (!activeSessionId || isOffline) {
			setSessionLogs({ aiLogs: [], aiLogsByTab: {}, shellLogs: [] });
			return;
		}

		const fetchSessionLogs = async () => {
			setIsLoadingLogs(true);
			try {
				// Pass tabId explicitly to avoid race conditions with activeTabId sync
				const tabParam = activeTabId ? `?tabId=${activeTabId}` : '';
				const apiUrl = buildApiUrl(`/session/${activeSessionId}${tabParam}`);
				const response = await fetch(apiUrl);
				if (response.ok) {
					const data = await response.json();
					const session = data.session;
					const fetchedAiLogs: LogEntry[] = session?.aiLogs || [];
					// The REST `/api/session/:id?tabId=<tab>` route filters logs to
					// the requested tab server-side (see
					// `server.setGetSessionDetailCallback` in src/server/index.ts:567
					// and the analogous web-server-factory branch). Bucket the
					// returned logs into THIS tab's slot so per-tab multiplexing
					// stays consistent even on tab switches.
					//
					// Merge into the existing bucket map rather than overwriting:
					// preserves other tabs' streaming state. We replace only the
					// fetched tab's bucket (or `AI_LOGS_NO_TAB_BUCKET` if the
					// session has no tab tracking yet — single-tab legacy case).
					const bucketKey =
						(session?.activeTabId as string | undefined) ?? activeTabId ?? AI_LOGS_NO_TAB_BUCKET;
					setSessionLogs((prev) => {
						const nextByTab = { ...prev.aiLogsByTab, [bucketKey]: fetchedAiLogs };
						// Derived flat view: the fetched tab's logs followed by
						// any pending no-tab fallback entries (only when the
						// fetched tab IS the active tab — which it is here, since
						// this fetch is triggered by the active tab changing).
						const nextFlat =
							bucketKey === AI_LOGS_NO_TAB_BUCKET
								? fetchedAiLogs
								: [...fetchedAiLogs, ...(nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])];
						return {
							aiLogs: nextFlat,
							aiLogsByTab: nextByTab,
							shellLogs: session?.shellLogs || [],
						};
					});
					webLogger.debug('Fetched session logs:', 'Mobile', {
						aiLogs: fetchedAiLogs.length,
						shellLogs: session?.shellLogs?.length || 0,
						requestedTabId: activeTabId,
						returnedTabId: session?.activeTabId,
						bucketKey,
					});
				}
			} catch (err) {
				webLogger.error('Failed to fetch session logs', 'Mobile', err);
			} finally {
				setIsLoadingLogs(false);
			}
		};

		fetchSessionLogs();
	}, [activeSessionId, activeTabId, isOffline]);

	// Handle session selection - also notifies desktop to switch
	const handleSelectSession = useCallback(
		(sessionId: string) => {
			// Find the session to get its activeTabId
			const session = sessions.find((s) => s.id === sessionId);
			// Update refs synchronously BEFORE state updates to avoid race conditions
			// with WebSocket messages arriving during the render cycle
			activeSessionIdRef.current = sessionId;
			activeTabIdRef.current = session?.activeTabId || null;
			setActiveSessionId(sessionId);
			setActiveTabId(session?.activeTabId || null);
			triggerHaptic(hapticTapPattern);
			// Notify desktop to switch to this session (include activeTabId if available)
			sendRef.current?.({
				type: 'select_session',
				sessionId,
				tabId: session?.activeTabId || undefined,
			});
		},
		[sessions, sendRef, triggerHaptic, hapticTapPattern]
	);

	// Handle selecting a tab within a session
	const handleSelectTab = useCallback(
		(tabId: string) => {
			if (!activeSessionId) return;
			triggerHaptic(hapticTapPattern);
			// Notify desktop to switch to this tab
			sendRef.current?.({ type: 'select_tab', sessionId: activeSessionId, tabId });
			// Update ref synchronously to avoid race conditions with WebSocket messages
			activeTabIdRef.current = tabId;
			// Update local activeTabId state directly (triggers log fetch)
			setActiveTabId(tabId);
			// Also update sessions state for UI consistency
			setSessions((prev) =>
				prev.map((s) => (s.id === activeSessionId ? { ...s, activeTabId: tabId } : s))
			);
		},
		[activeSessionId, sendRef, triggerHaptic, hapticTapPattern]
	);

	// Handle creating a new tab
	const handleNewTab = useCallback(() => {
		if (!activeSessionId) return;
		triggerHaptic(hapticTapPattern);
		// Notify desktop to create a new tab
		sendRef.current?.({ type: 'new_tab', sessionId: activeSessionId });
	}, [activeSessionId, sendRef, triggerHaptic, hapticTapPattern]);

	// Handle closing a tab
	const handleCloseTab = useCallback(
		(tabId: string) => {
			if (!activeSessionId) return;
			triggerHaptic(hapticTapPattern);
			// Notify desktop to close this tab
			sendRef.current?.({ type: 'close_tab', sessionId: activeSessionId, tabId });
		},
		[activeSessionId, sendRef, triggerHaptic, hapticTapPattern]
	);

	// Handle renaming a tab
	const handleRenameTab = useCallback(
		(tabId: string, newName: string) => {
			if (!activeSessionId) return;
			sendRef.current?.({ type: 'rename_tab', sessionId: activeSessionId, tabId, newName });
		},
		[activeSessionId, sendRef]
	);

	// Handle starring/unstarring a tab
	const handleStarTab = useCallback(
		(tabId: string, starred: boolean) => {
			if (!activeSessionId) return;
			sendRef.current?.({ type: 'star_tab', sessionId: activeSessionId, tabId, starred });
			// Optimistically update local state
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== activeSessionId) return s;
					return {
						...s,
						aiTabs: s.aiTabs?.map((t: any) => (t.id === tabId ? { ...t, starred } : t)),
					};
				})
			);
		},
		[activeSessionId, sendRef, setSessions]
	);

	// Handle reordering a tab
	const handleReorderTab = useCallback(
		(fromIndex: number, toIndex: number) => {
			if (!activeSessionId) return;
			sendRef.current?.({ type: 'reorder_tab', sessionId: activeSessionId, fromIndex, toIndex });
			// Optimistically update local state
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== activeSessionId || !s.aiTabs) return s;
					const tabs = [...s.aiTabs];
					const [movedTab] = tabs.splice(fromIndex, 1);
					tabs.splice(toIndex, 0, movedTab);
					return { ...s, aiTabs: tabs };
				})
			);
		},
		[activeSessionId, sendRef, setSessions]
	);

	// Handle toggling bookmark on a session
	const handleToggleBookmark = useCallback(
		(sessionId: string) => {
			sendRef.current?.({ type: 'toggle_bookmark', sessionId });
			// Optimistically update local state
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== sessionId) return s;
					return { ...s, bookmarked: !s.bookmarked };
				})
			);
		},
		[sendRef, setSessions]
	);

	// Add a user input log entry to session logs.
	// For AI mode: appends to the active tab's bucket in `aiLogsByTab` AND
	// keeps the flat `aiLogs` view in sync (back-compat). When `activeTabId`
	// is null (no tab selected yet — single-tab legacy session pre-tab-creation),
	// the entry is appended to the `AI_LOGS_NO_TAB_BUCKET` fallback so it
	// remains visible on whichever tab becomes active first.
	const addUserLogEntry = useCallback((text: string, inputMode: 'ai' | 'terminal') => {
		const userLogEntry: LogEntry = {
			id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			timestamp: Date.now(),
			text,
			source: 'user',
		};
		setSessionLogs((prev) => {
			if (inputMode === 'terminal') {
				return { ...prev, shellLogs: [...prev.shellLogs, userLogEntry] };
			}
			const bucketKey = activeTabIdRef.current ?? AI_LOGS_NO_TAB_BUCKET;
			const existingBucket = prev.aiLogsByTab[bucketKey] ?? [];
			const updatedBucket = [...existingBucket, userLogEntry];
			const nextByTab = { ...prev.aiLogsByTab, [bucketKey]: updatedBucket };
			// Flat view = active tab's bucket ∪ no-tab fallback (for back-compat
			// consumers reading `sessionLogs.aiLogs` directly).
			const activeKey = activeTabIdRef.current ?? AI_LOGS_NO_TAB_BUCKET;
			const nextFlat =
				activeKey === AI_LOGS_NO_TAB_BUCKET
					? (nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])
					: [...(nextByTab[activeKey] ?? []), ...(nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])];
			return { ...prev, aiLogs: nextFlat, aiLogsByTab: nextByTab };
		});
	}, []);

	// WebSocket handlers for session updates
	const sessionsHandlers = useMemo(
		(): MobileSessionHandlers => ({
			onConnectionChange: (newState: WebSocketState) => {
				webLogger.debug(`Connection state: ${newState}`, 'Mobile');
			},
			onError: (err: string) => {
				webLogger.error(`WebSocket error: ${err}`, 'Mobile');
			},
			onSessionsUpdate: (newSessions: Session[]) => {
				webLogger.debug(`Sessions updated: ${newSessions.length}`, 'Mobile');

				// Update previous states map for all sessions
				newSessions.forEach((s) => {
					previousSessionStatesRef.current.set(s.id, s.state);
				});

				setSessions(newSessions);
				// Auto-select first session if none selected, and sync activeTabId
				// Update refs synchronously to avoid race conditions with WebSocket messages
				const currentActiveId = activeSessionIdRef.current;
				if (!currentActiveId && newSessions.length > 0) {
					const firstSession = newSessions[0];
					activeSessionIdRef.current = firstSession.id;
					activeTabIdRef.current = firstSession.activeTabId || null;
					setActiveSessionId(firstSession.id);
					setActiveTabId(firstSession.activeTabId || null);
				} else if (currentActiveId) {
					// Sync activeTabId for current session
					const currentSession = newSessions.find((s) => s.id === currentActiveId);
					if (currentSession) {
						activeTabIdRef.current = currentSession.activeTabId || null;
						setActiveTabId(currentSession.activeTabId || null);
					}
				}
			},
			onSessionStateChange: (
				sessionId: string,
				state: string,
				additionalData?: Partial<Session>
			) => {
				// Check if this is a busy -> idle transition (AI response completed)
				const previousState = previousSessionStatesRef.current.get(sessionId);
				const isResponseComplete = previousState === 'busy' && state === 'idle';

				// Update the previous state
				previousSessionStatesRef.current.set(sessionId, state);

				setSessions((prev) => {
					const updatedSessions = prev.map((s) =>
						s.id === sessionId ? { ...s, state, ...additionalData } : s
					);

					// Show notification if response completed and app is backgrounded
					if (isResponseComplete && onResponseComplete) {
						const session = updatedSessions.find((s) => s.id === sessionId);
						if (session) {
							// Get the response from additionalData or the updated session

							const response =
								(additionalData as any)?.lastResponse || (session as any).lastResponse;
							onResponseComplete(session, response);
						}
					}

					return updatedSessions;
				});
			},
			onSessionAdded: (session: Session) => {
				// Track state for new session
				previousSessionStatesRef.current.set(session.id, session.state);

				setSessions((prev) => {
					if (prev.some((s) => s.id === session.id)) return prev;
					return [...prev, session];
				});
			},
			onSessionRemoved: (sessionId: string) => {
				// Clean up state tracking
				previousSessionStatesRef.current.delete(sessionId);

				setSessions((prev) => prev.filter((s) => s.id !== sessionId));
				// Update refs synchronously if the removed session was active
				if (activeSessionIdRef.current === sessionId) {
					activeSessionIdRef.current = null;
					activeTabIdRef.current = null;
					setActiveSessionId(null);
					setActiveTabId(null);
				}
			},
			onActiveSessionChanged: (sessionId: string) => {
				// Desktop app switched to a different session - sync with web
				webLogger.debug(`Desktop active session changed: ${sessionId}`, 'Mobile');
				// Update refs synchronously BEFORE state updates to avoid race conditions
				activeSessionIdRef.current = sessionId;
				activeTabIdRef.current = null;
				setActiveSessionId(sessionId);
				setActiveTabId(null);
			},
			onSessionOutput: (
				sessionId: string,
				data: string,
				source: 'ai' | 'terminal',
				tabId?: string
			) => {
				// Real-time output from AI or terminal — bucket into per-tab AI
				// logs (or session-level shell logs).
				const currentActiveId = activeSessionIdRef.current;
				const currentActiveTabId = activeTabIdRef.current;
				webLogger.debug(`Session output: ${sessionId} (${source}) ${data.length} chars`, 'Mobile');
				webLogger.debug('Session output detail', 'Mobile', {
					sessionId,
					activeSessionId: currentActiveId,
					tabId: tabId || 'none',
					activeTabId: currentActiveTabId || 'none',
					source,
					dataLen: data?.length || 0,
				});

				// Only update if this is the active session.
				// (Future enhancement: bucket cross-session output too, so
				// background sessions accumulate scrollback. For now matches the
				// pre-bucketing behavior: only mutate the active session's state.)
				if (currentActiveId !== sessionId) {
					webLogger.debug('Skipping output - not active session', 'Mobile', {
						sessionId,
						activeSessionId: currentActiveId,
					});
					return;
				}

				setSessionLogs((prev) => {
					if (source === 'terminal') {
						const existingLogs = prev.shellLogs;
						const lastLog = existingLogs[existingLogs.length - 1];
						const isStreamingAppend =
							lastLog && lastLog.source === 'stdout' && Date.now() - lastLog.timestamp < 5000;
						if (isStreamingAppend) {
							const updatedLogs = [...existingLogs];
							updatedLogs[updatedLogs.length - 1] = {
								...lastLog,
								text: lastLog.text + data,
							};
							return { ...prev, shellLogs: updatedLogs };
						}
						const newEntry: LogEntry = {
							id: `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
							timestamp: Date.now(),
							source: 'stdout',
							text: data,
						};
						return { ...prev, shellLogs: [...existingLogs, newEntry] };
					}

					// AI source — bucket by tabId. Frames without a `tabId`
					// (back-compat for older server builds in-flight during a
					// rolling deploy) land in the no-tab fallback bucket and are
					// surfaced via the active tab's derived view.
					const bucketKey = tabId ?? AI_LOGS_NO_TAB_BUCKET;
					const existingBucket = prev.aiLogsByTab[bucketKey] ?? [];
					const lastLog = existingBucket[existingBucket.length - 1];
					const isStreamingAppend =
						lastLog && lastLog.source === 'stdout' && Date.now() - lastLog.timestamp < 5000;

					let updatedBucket: LogEntry[];
					if (isStreamingAppend) {
						updatedBucket = [...existingBucket];
						updatedBucket[updatedBucket.length - 1] = {
							...lastLog,
							text: lastLog.text + data,
						};
						webLogger.debug('Appended to existing log entry', 'Mobile', {
							sessionId,
							source,
							bucketKey,
							newLength: updatedBucket[updatedBucket.length - 1].text.length,
						});
					} else {
						const newEntry: LogEntry = {
							id: `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
							timestamp: Date.now(),
							source: 'stdout',
							text: data,
						};
						updatedBucket = [...existingBucket, newEntry];
						webLogger.debug('Created new log entry', 'Mobile', {
							sessionId,
							source,
							bucketKey,
							dataLength: data.length,
						});
					}

					const nextByTab = { ...prev.aiLogsByTab, [bucketKey]: updatedBucket };
					// Recompute the flat `aiLogs` view: active tab's bucket
					// concatenated with the no-tab fallback so older consumers
					// reading `sessionLogs.aiLogs` still see streaming entries
					// from in-flight legacy frames during the back-compat window.
					const activeKey = currentActiveTabId ?? AI_LOGS_NO_TAB_BUCKET;
					const nextFlat =
						activeKey === AI_LOGS_NO_TAB_BUCKET
							? (nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])
							: [...(nextByTab[activeKey] ?? []), ...(nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])];
					return { ...prev, aiLogs: nextFlat, aiLogsByTab: nextByTab };
				});
			},
			onSessionExit: (sessionId: string, exitCode: number) => {
				webLogger.debug(`Session exit: ${sessionId} code=${exitCode}`, 'Mobile');
				// Update session state to idle when process exits
				setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, state: 'idle' } : s)));
			},
			onUserInput: (sessionId: string, command: string, inputMode: 'ai' | 'terminal') => {
				// User input from desktop app - add to session logs so web interface stays in sync
				const currentActiveId = activeSessionIdRef.current;
				webLogger.debug(
					`User input from desktop: ${sessionId} (${inputMode}) ${command.substring(0, 50)}`,
					'Mobile',
					{
						sessionId,
						activeSessionId: currentActiveId,
						inputMode,
						commandLength: command.length,
						isActiveSession: currentActiveId === sessionId,
					}
				);

				// Only add if this is the active session
				if (currentActiveId !== sessionId) {
					webLogger.debug('Skipping user input - not active session', 'Mobile', {
						sessionId,
						activeSessionId: currentActiveId,
					});
					return;
				}

				const userLogEntry: LogEntry = {
					id: `user-desktop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					timestamp: Date.now(),
					text: command,
					source: 'user',
				};
				setSessionLogs((prev) => {
					if (inputMode === 'terminal') {
						return { ...prev, shellLogs: [...prev.shellLogs, userLogEntry] };
					}
					// AI mode — `user_input` frames don't carry a `tabId`, so the
					// best signal is the current `activeTabIdRef`. Falls back to
					// the no-tab bucket if no tab is active yet.
					const bucketKey = activeTabIdRef.current ?? AI_LOGS_NO_TAB_BUCKET;
					const existingBucket = prev.aiLogsByTab[bucketKey] ?? [];
					const updatedBucket = [...existingBucket, userLogEntry];
					const nextByTab = { ...prev.aiLogsByTab, [bucketKey]: updatedBucket };
					const activeKey = activeTabIdRef.current ?? AI_LOGS_NO_TAB_BUCKET;
					const nextFlat =
						activeKey === AI_LOGS_NO_TAB_BUCKET
							? (nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])
							: [...(nextByTab[activeKey] ?? []), ...(nextByTab[AI_LOGS_NO_TAB_BUCKET] ?? [])];
					return { ...prev, aiLogs: nextFlat, aiLogsByTab: nextByTab };
				});
			},
			onThemeUpdate: (theme: Theme) => {
				// Sync theme from desktop app by updating the React context
				webLogger.debug(`Theme update received: ${theme.name} (${theme.mode})`, 'Mobile');
				onThemeUpdate?.(theme);
			},
			onBionifyReadingModeUpdate: (enabled: boolean) => {
				webLogger.debug(`Bionify reading mode update received: ${enabled}`, 'Mobile');
				onBionifyReadingModeUpdate?.(enabled);
			},
			onCustomCommands: (commands: CustomCommand[]) => {
				// Custom slash commands from desktop app
				webLogger.debug(`Custom commands received: ${commands.length}`, 'Mobile');
				onCustomCommands?.(commands);
			},
			onAutoRunStateChange: (sessionId: string, state: AutoRunState | null) => {
				// AutoRun (batch processing) state from desktop app
				webLogger.debug(
					`AutoRun state change: ${sessionId} - ${state ? `running (${state.completedTasks}/${state.totalTasks})` : 'stopped'}`,
					'Mobile'
				);
				onAutoRunStateChange?.(sessionId, state);
			},
			onTabsChanged: (sessionId: string, aiTabs: AITabData[], newActiveTabId: string) => {
				// Tab state changed on desktop - update session
				webLogger.debug(
					`Tabs changed: ${sessionId} - ${aiTabs.length} tabs, active: ${newActiveTabId}`,
					'Mobile'
				);
				setSessions((prev) =>
					prev.map((s) => (s.id === sessionId ? { ...s, aiTabs, activeTabId: newActiveTabId } : s))
				);
				// Also update activeTabId ref and state if this is the current session
				const currentSessionId = activeSessionIdRef.current;
				if (currentSessionId === sessionId) {
					activeTabIdRef.current = newActiveTabId;
					setActiveTabId(newActiveTabId);
				}
			},
		}),
		[
			onResponseComplete,
			onThemeUpdate,
			onBionifyReadingModeUpdate,
			onCustomCommands,
			onAutoRunStateChange,
		]
	);

	return {
		// State
		sessions,
		setSessions,
		activeSessionId,
		setActiveSessionId,
		activeTabId,
		setActiveTabId,
		activeSession,
		sessionLogs,
		isLoadingLogs,
		activeSessionIdRef,
		// Handlers
		handleSelectSession,
		handleSelectTab,
		handleNewTab,
		handleCloseTab,
		handleRenameTab,
		handleStarTab,
		handleReorderTab,
		handleToggleBookmark,
		addUserLogEntry,
		sessionsHandlers,
	};
}

export default useMobileSessionManagement;
