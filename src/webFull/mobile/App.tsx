/**
 * Maestro Web Remote Control
 *
 * Lightweight interface for controlling sessions from mobile/tablet devices.
 * Focused on quick command input and session monitoring.
 */

import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { useThemeColors, useTheme } from '../components/ThemeProvider';
import {
	useWebSocket,
	type CustomCommand,
	type AutoRunState,
	type AITabData,
} from '../hooks/useWebSocket';
// Command history is no longer used in the mobile UI
import { useNotifications } from '../hooks/useNotifications';
import { useUnreadBadge } from '../hooks/useUnreadBadge';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import {
	useMobileSessionManagement,
	AI_LOGS_NO_TAB_BUCKET,
} from '../hooks/useMobileSessionManagement';
import { publishSettingsChanged } from '../hooks/useSettings';
import { useModalGate } from '../hooks/useModalGate';
import { useOfflineStatus, useMaestroMode, useDesktopTheme } from '../main';
import { buildApiUrl } from '../utils/config';
import { formatCost } from '../../shared/formatters';
// SYNC: Uses estimateContextUsage() from shared/contextUsage.ts
// See that file for the canonical formula and all locations that must stay in sync.
import { estimateContextUsage } from '../../renderer/utils/contextUsage';
import { triggerHaptic, HAPTIC_PATTERNS } from './constants';
import { webLogger } from '../utils/logger';
import { SessionPillBar } from './SessionPillBar';
import { DesktopSidebar } from './DesktopSidebar';
import { AllSessionsView } from './AllSessionsView';
import { MobileHistoryPanel } from './MobileHistoryPanel';
import { CommandInputBar, type InputMode } from './CommandInputBar';
import { DEFAULT_SLASH_COMMANDS, type SlashCommand } from './SlashCommandAutocomplete';
// CommandHistoryDrawer and RecentCommandChips removed for simpler mobile UI
import { ResponseViewer, type ResponseItem } from './ResponseViewer';
import { OfflineQueueBanner } from './OfflineQueueBanner';
import { MessageHistory } from './MessageHistory';
import { Terminal, usePtyMessageRouter } from '../components/Terminal';
import { AutoRunIndicator } from './AutoRunIndicator';
import { TabBar } from '../components/TabBar';
import { TabSearchModal } from './TabSearchModal';
import { TerminalOutput } from '../components';
import type {
	Session as RendererSession,
	AITab as RendererAITab,
	LogEntry as RendererLogEntry,
	FocusArea,
} from '../../renderer/types';

// ============================================================================
// Audit #10 pivot — orphan-to-mounted wiring of lifted overlay components
// ============================================================================
//
// The lifted components below were sitting in `src/webFull/components/` but
// had ZERO consumers in mobile/App.tsx (the entry point) before this commit.
// Each one was "lifted but unreachable" — the parity catalog covered the
// surface but no code path rendered it.
//
// This block wires:
//   - AppOverlays (dispatcher) + FirstRunCelebration + KeyboardMasteryCelebration
//     + StandingOvationOverlay (the three slots passed as render-prop ReactNodes)
//   - ContextWarningSash (data sourced from the same `contextUsage` calc that
//     MobileHeader already reads)
//   - ShortcutsHelpModal (Shift+? triggers — debug menu equivalent)
//   - AutoRunnerHelpModal, HistoryHelpModal (debug triggers via keyboard chord)
//   - QuitConfirmModal (debug trigger via keyboard chord)
//   - FileSearchModal (debug trigger via keyboard chord)
//
// Mount-wave 2 (2026-06-08, this commit) extends the same pattern with:
//   - NewInstanceModal (Cmd+Shift+N triggers; 9 strip-and-promoted props
//     stubbed with safe defaults — no real session creation yet)
//   - MarketplaceModal (Cmd+Shift+M triggers; wires `useMarketplace()` for
//     real playbook listing + SSE-driven import)
//   - SettingsModal (Cmd+, triggers; OS-canonical Settings shortcut, modal
//     already self-contained via `useSettings()`)
//   - AgentErrorModal (Cmd+Alt+E triggers; synthetic stub AgentError to
//     prove the surface is reachable until structured-error WS frames ship)
//
// Host-data wiring intentionally minimal: gate state lives via `useModalGate`,
// data values default to safe placeholders where the host doesn't yet
// surface them. The point is to close the trigger gap so the surface is
// REACHABLE; full host wiring lands in subsequent waves.
import {
	AppOverlays,
	FirstRunCelebration,
	KeyboardMasteryCelebration,
	StandingOvationOverlay,
	ContextWarningSash,
	ShortcutsHelpModal,
	AutoRunnerHelpModal,
	HistoryHelpModal,
	QuitConfirmModal,
	FileSearchModal,
	NewInstanceModal,
	MarketplaceModal,
	SettingsModal,
	AgentErrorModal,
	AutoRun,
	// ====================================================================
	// Audit #10 mount-wave 4 — 8 additional lifted modals/panels wired
	// behind Cmd+Alt+* debug keybindings. See the host-wiring block
	// further down in the file for the per-component prop derivation +
	// host-data TODOs. Each surface follows the same pattern established
	// in waves 1-3: `useModalGate()` for visibility, a `setShow<X>` /
	// keybinding-triggered open, prop stubs where host data isn't yet
	// surfaced through webFull, and observable `webLogger` calls for
	// every stubbed callback so triggers stay visible in obs.
	// ====================================================================
	WizardExitConfirmModal,
	ExistingAutoRunDocsModal,
	WizardResumeModal,
	LightboxModal,
	HistoryDetailModal,
	SaveMarkdownModal,
	ExecutionQueueBrowser,
	CustomThemeBuilder,
	type AppOverlaysStandingOvationData,
	type AppOverlaysFirstRunCelebrationData,
	type RecoveryAction,
} from '../components';
import type { AgentError, HistoryEntry } from '../../shared/types';
import type { SerializableWizardState } from '../../renderer/components/Wizard/WizardContext';
import type { ThemeColors, ThemeId } from '../../shared/theme-types';
import { THEMES, DEFAULT_CUSTOM_THEME_COLORS } from '../../shared/themes';
import { useMarketplace } from '../hooks/useMarketplace';
import { DEFAULT_SHORTCUTS, TAB_SHORTCUTS } from '../../renderer/constants/shortcuts';
import type { Session, LastResponsePreview } from '../hooks/useSessions';
// View state utilities are now accessed through useMobileViewState hook
// Keeping import for TypeScript types only if needed
import { useMobileKeyboardHandler } from '../hooks/useMobileKeyboardHandler';
import { useTabKeyboardShortcuts } from '../hooks/useTabKeyboardShortcuts';
import { useMobileViewState } from '../hooks/useMobileViewState';
import { useMobileAutoReconnect } from '../hooks/useMobileAutoReconnect';

interface SessionCommandDrafts {
	aiByTab: Record<string, string>;
	terminal: string;
}

type CommandDraftStore = Record<string, SessionCommandDrafts>;
const SESSION_LEVEL_AI_DRAFT_KEY = '__session__';

function getEmptyDrafts(): SessionCommandDrafts {
	return {
		aiByTab: {},
		terminal: '',
	};
}

/**
 * Get the active tab from a session
 */
function getActiveTabFromSession(session: Session | null | undefined): AITabData | null {
	if (!session?.aiTabs || !session.activeTabId) return null;
	return session.aiTabs.find((tab) => tab.id === session.activeTabId) || null;
}

/**
 * Header component for the mobile app
 * Compact single-line header showing: Maestro | Session Name | Claude ID | Status | Cost | Context
 */
interface MobileHeaderProps {
	activeSession?: Session | null;
}

function MobileHeader({ activeSession }: MobileHeaderProps) {
	const colors = useThemeColors();
	const { isSession, goToDashboard } = useMaestroMode();

	// Get active tab for per-tab data (agentSessionId, usageStats)
	const activeTab = getActiveTabFromSession(activeSession);

	// Session status and usage - prefer tab-level data
	const sessionState = activeTab?.state || activeSession?.state || 'idle';
	const isThinking = sessionState === 'busy';
	// Use tab's usageStats if available, otherwise fall back to session-level (deprecated)
	const tabUsageStats = activeTab?.usageStats;
	const cost = tabUsageStats?.totalCostUsd ?? activeSession?.usageStats?.totalCostUsd;
	const contextUsage = estimateContextUsage(
		tabUsageStats ?? activeSession?.usageStats ?? {},
		activeSession?.toolType
	);

	// Get status dot color
	const getStatusDotColor = () => {
		if (sessionState === 'busy') return colors.warning;
		if (sessionState === 'error') return colors.error;
		if (sessionState === 'connecting') return colors.warning;
		return colors.success; // idle
	};

	return (
		<header
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: '8px 12px',
				paddingTop: 'max(8px, env(safe-area-inset-top))',
				borderBottom: `1px solid ${colors.border}`,
				backgroundColor: colors.bgSidebar,
				minHeight: '44px',
				gap: '8px',
			}}
		>
			{/* Left: Maestro logo with wand icon */}
			<div
				onClick={isSession ? goToDashboard : undefined}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '6px',
					cursor: isSession ? 'pointer' : 'default',
					flexShrink: 0,
				}}
				title={isSession ? 'Go to dashboard' : undefined}
			>
				{/* Wand icon */}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke={colors.accent}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
					<path d="m14 7 3 3" />
					<path d="M5 6v4" />
					<path d="M19 14v4" />
					<path d="M10 2v2" />
					<path d="M7 8H3" />
					<path d="M21 16h-4" />
					<path d="M11 3H9" />
				</svg>
				<span
					style={{
						fontSize: '16px',
						fontWeight: 600,
						color: colors.textMain,
					}}
				>
					Maestro
				</span>
			</div>

			{/* Center: Session info (name + Claude session ID + status + usage) */}
			{activeSession && (
				<div
					style={{
						flex: 1,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '6px',
						minWidth: 0,
						overflow: 'hidden',
					}}
				>
					{/* Session status dot */}
					<span
						style={{
							width: '8px',
							height: '8px',
							borderRadius: '50%',
							backgroundColor: getStatusDotColor(),
							flexShrink: 0,
							animation: isThinking ? 'pulse 1.5s ease-in-out infinite' : 'none',
						}}
						title={`Session ${sessionState}`}
					/>

					{/* Session name */}
					<span
						style={{
							fontSize: '13px',
							fontWeight: 500,
							color: colors.textMain,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{activeSession.name}
					</span>

					{/* Claude Session ID pill - use active tab's agentSessionId */}
					{(activeTab?.agentSessionId || activeSession.agentSessionId) && (
						<span
							style={{
								fontSize: '10px',
								color: colors.textDim,
								fontFamily: 'monospace',
								backgroundColor: colors.bgMain,
								padding: '2px 4px',
								borderRadius: '3px',
								flexShrink: 0,
							}}
							title={`Claude Session: ${activeTab?.agentSessionId || activeSession.agentSessionId}`}
						>
							{(activeTab?.agentSessionId || activeSession.agentSessionId)?.slice(0, 8)}
						</span>
					)}

					{/* Cost */}
					{cost != null && cost > 0 && (
						<span
							style={{
								fontSize: '10px',
								color: colors.textDim,
								backgroundColor: `${colors.textDim}15`,
								padding: '2px 4px',
								borderRadius: '3px',
								flexShrink: 0,
							}}
							title={`Session cost: ${formatCost(cost)}`}
						>
							{formatCost(cost)}
						</span>
					)}

					{/* Context usage bar */}
					{contextUsage != null && (
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '3px',
								flexShrink: 0,
							}}
							title={`Context: ${contextUsage}%`}
						>
							<div
								style={{
									width: '30px',
									height: '4px',
									backgroundColor: `${colors.textDim}20`,
									borderRadius: '2px',
									overflow: 'hidden',
								}}
							>
								<div
									style={{
										width: `${contextUsage}%`,
										height: '100%',
										backgroundColor:
											contextUsage >= 90
												? colors.error
												: contextUsage >= 70
													? colors.warning
													: colors.success,
										borderRadius: '2px',
									}}
								/>
							</div>
							<span style={{ fontSize: '9px', color: colors.textDim }}>{contextUsage}%</span>
						</div>
					)}
				</div>
			)}

			{/* Pulse animation for thinking state */}
			<style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
		</header>
	);
}

/**
 * Main mobile app component with WebSocket connection management
 */
export default function MobileApp() {
	const colors = useThemeColors();
	const { theme } = useTheme();
	const isOffline = useOfflineStatus();
	const { bionifyReadingMode, setDesktopTheme, setDesktopBionifyReadingMode } = useDesktopTheme();

	// View state persistence and screen tracking (hook consolidates multiple effects)
	const {
		isSmallScreen,
		savedState,
		savedScrollState: _savedScrollState,
		persistViewState,
		persistHistoryState,
		persistSessionSelection,
	} = useMobileViewState();

	// UI state (not part of session management)
	const [showAllSessions, setShowAllSessions] = useState(savedState.showAllSessions);
	const [showHistoryPanel, setShowHistoryPanel] = useState(savedState.showHistoryPanel);
	const [showTabSearch, setShowTabSearch] = useState(savedState.showTabSearch);
	const [commandDrafts, setCommandDrafts] = useState<CommandDraftStore>({});

	// ====================================================================
	// Audit #10 pivot — gate state for lifted overlay components
	// ====================================================================
	//
	// Each gate is a `useModalGate()` (boolean open + show/hide callbacks).
	// AppOverlays' three data gates are local data state (nullable —
	// `null` ↔ "do not render this overlay" per the dispatcher contract).
	const shortcutsHelpGate = useModalGate();
	const autoRunnerHelpGate = useModalGate();
	const historyHelpGate = useModalGate();
	const quitConfirmGate = useModalGate();
	const fileSearchGate = useModalGate();

	// ====================================================================
	// Audit #10 mount-wave 2 — additional gate state for newly-mounted
	// high-impact modals (NewInstanceModal, MarketplaceModal, SettingsModal,
	// AgentErrorModal). Same `useModalGate()` primitive as wave 1; the
	// debug-keybinding wiring below routes each gate to a `show()` call.
	// ====================================================================
	const newInstanceGate = useModalGate();
	const marketplaceGate = useModalGate();
	const settingsGate = useModalGate();
	const agentErrorGate = useModalGate();

	// ====================================================================
	// Audit #10 mount-wave 4 — visibility gates for 8 newly-mounted lifted
	// modals/panels (WizardExitConfirmModal, ExistingAutoRunDocsModal,
	// WizardResumeModal, LightboxModal, HistoryDetailModal,
	// SaveMarkdownModal, ExecutionQueueBrowser, CustomThemeBuilder). Same
	// `useModalGate()` primitive as waves 1-3. Keybinding wiring routes
	// each gate to `show()` in the debug-trigger handler below; render
	// branches gate on `gate.open` near the other modal renders.
	// ====================================================================
	const wizardExitConfirmGate = useModalGate();
	const existingAutoRunDocsGate = useModalGate();
	const wizardResumeGate = useModalGate();
	const lightboxGate = useModalGate();
	const historyDetailGate = useModalGate();
	const saveMarkdownGate = useModalGate();
	const executionQueueBrowserGate = useModalGate();
	const customThemeBuilderGate = useModalGate();

	// ====================================================================
	// Audit #10 mount-wave 3 — AutoRun visibility gate
	// ====================================================================
	//
	// AutoRun is the lifted ~2285-LOC L2.5 leaf (`ISC-44.lift.autorun_main`,
	// closed on `aee55e1d3`). Its host (renderer's `RightPanel.tsx`) renders
	// it as a docked side-panel; webFull has no equivalent docking surface
	// yet, so the wave-3 mount uses a keybinding-triggered overlay (same
	// pattern as the wave-1 / wave-2 help modals). Real host wiring lives
	// in subsequent waves when webFull surfaces a side-panel chrome.
	const autoRunGate = useModalGate();

	// AutoRun local state — content + mode + selectedFile. The renderer
	// sources these from `useAutoRunContext` (still renderer-only), and
	// since the brief explicitly scopes this wave to "debug keybinding-
	// triggered" reachability, we hold this state locally with safe
	// initial values. Host-data TODO: thread `useAutoRunContext` (or its
	// webFull port when it lands) here in a follow-up wave.
	const [autoRunContent, setAutoRunContent] = useState<string>('');
	const [autoRunMode, setAutoRunMode] = useState<'edit' | 'preview'>('preview');
	const [autoRunSelectedFile, setAutoRunSelectedFile] = useState<string | null>(null);

	// AppOverlays trio — data sources. `null` means "do not render this overlay".
	// Host-data wiring TODO: surface these from the modal-store / settings-store
	// porting wave. Until then, the dispatcher mounts only when a trigger sets
	// the relevant state (debug keybindings below). The AppOverlays dispatcher
	// itself is purely a visibility gate; this preserves the renderer's
	// dispatcher contract verbatim.
	const [firstRunCelebrationData, setFirstRunCelebrationData] =
		useState<AppOverlaysFirstRunCelebrationData | null>(null);
	const [standingOvationData, setStandingOvationData] =
		useState<AppOverlaysStandingOvationData | null>(null);
	const [pendingKeyboardMasteryLevel, setPendingKeyboardMasteryLevel] = useState<number | null>(
		null
	);
	const [showResponseViewer, setShowResponseViewer] = useState(false);
	const [selectedResponse, setSelectedResponse] = useState<LastResponsePreview | null>(null);
	const [responseIndex, setResponseIndex] = useState(0);

	// Custom slash commands from desktop
	const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);

	// AutoRun state per session (batch processing on desktop)
	const [autoRunStates, setAutoRunStates] = useState<Record<string, AutoRunState | null>>({});

	// History panel state (persisted)
	const [historyFilter, setHistoryFilter] = useState<'all' | 'AUTO' | 'USER'>(
		savedState.historyFilter
	);
	const [historySearchQuery, setHistorySearchQuery] = useState(savedState.historySearchQuery);
	const [historySearchOpen, setHistorySearchOpen] = useState(savedState.historySearchOpen);

	// Notification permission hook - requests permission on first visit
	const { permission: notificationPermission, showNotification } = useNotifications({
		autoRequest: true,
		requestDelay: 3000, // Wait 3 seconds before prompting
		onGranted: () => {
			webLogger.debug('Notification permission granted', 'Mobile');
			triggerHaptic(HAPTIC_PATTERNS.success);
		},
		onDenied: () => {
			webLogger.debug('Notification permission denied', 'Mobile');
		},
	});

	// Unread badge hook - tracks unread responses and updates app badge
	const {
		addUnread: addUnreadResponse,
		markAllRead: markAllResponsesRead,
		unreadCount: _unreadCount,
	} = useUnreadBadge({
		autoClearOnVisible: true, // Clear badge when user opens the app
		onCountChange: (count) => {
			webLogger.debug(`Unread response count: ${count}`, 'Mobile');
		},
	});

	// Save view state when overlays change (using hook's persistence function)
	useEffect(() => {
		persistViewState({ showAllSessions, showHistoryPanel, showTabSearch });
	}, [showAllSessions, showHistoryPanel, showTabSearch, persistViewState]);

	// Save history panel state when it changes (using hook's persistence function)
	useEffect(() => {
		persistHistoryState({ historyFilter, historySearchQuery, historySearchOpen });
	}, [historyFilter, historySearchQuery, historySearchOpen, persistHistoryState]);

	/**
	 * Get the first line of a response for notification display
	 * Strips markdown/code markers and truncates to reasonable length
	 */
	const getFirstLineOfResponse = useCallback((text: string): string => {
		// Split by newlines and find first non-empty, non-markdown line
		const lines = text.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			// Skip empty lines and common markdown markers
			if (!trimmed) continue;
			if (trimmed.startsWith('```')) continue;
			if (trimmed === '---') continue;

			// Found a content line - truncate if too long
			const maxLength = 100;
			if (trimmed.length > maxLength) {
				return trimmed.substring(0, maxLength) + '...';
			}
			return trimmed;
		}

		return 'Response completed';
	}, []);

	// Ref to WebSocket send function (updated after useWebSocket is initialized)
	const wsSendRef = useRef<((message: Record<string, unknown>) => boolean) | null>(null);

	// Callback when session response completes - shows notification
	const handleResponseComplete = useCallback(
		(session: Session, response?: unknown) => {
			// Only show if app is backgrounded
			if (document.visibilityState !== 'hidden') {
				return;
			}

			const lastResponse = response as LastResponsePreview | undefined;

			// Generate a unique ID for this response using session ID and timestamp
			const responseId = `${session.id}-${lastResponse?.timestamp || Date.now()}`;

			// Add to unread badge count (works even without notification permission)
			addUnreadResponse(responseId);
			webLogger.debug(`Added unread response: ${responseId}`, 'Mobile');

			// Only show notification if permission is granted
			if (notificationPermission !== 'granted') {
				return;
			}

			const title = `${session.name} - Response Ready`;
			const firstLine = lastResponse?.text
				? getFirstLineOfResponse(lastResponse.text)
				: 'AI response completed';

			const notification = showNotification(title, {
				body: firstLine,
				tag: `maestro-response-${session.id}`, // Prevent duplicate notifications for same session
				silent: false,
				requireInteraction: false, // Auto-dismiss on mobile
			} as NotificationOptions);

			if (notification) {
				webLogger.debug(`Notification shown for session: ${session.name}`, 'Mobile');

				// Handle notification click - focus the app
				notification.onclick = () => {
					window.focus();
					notification.close();
					// Set this session as active and clear badge
					setActiveSessionId(session.id);
					markAllResponsesRead();
				};
			}
		},
		[
			notificationPermission,
			showNotification,
			getFirstLineOfResponse,
			addUnreadResponse,
			markAllResponsesRead,
		]
	);

	// Session management hook - handles session state, logs, and WebSocket handlers
	const {
		sessions,
		setSessions,
		activeSessionId,
		setActiveSessionId,
		activeTabId,
		activeSession,
		sessionLogs,
		isLoadingLogs,
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
	} = useMobileSessionManagement({
		savedActiveSessionId: savedState.activeSessionId,
		savedActiveTabId: savedState.activeTabId,
		isOffline,
		sendRef: wsSendRef,
		triggerHaptic,
		hapticTapPattern: HAPTIC_PATTERNS.tap,
		onResponseComplete: handleResponseComplete,
		onThemeUpdate: setDesktopTheme,
		onBionifyReadingModeUpdate: setDesktopBionifyReadingMode,
		onCustomCommands: setCustomCommands,
		onAutoRunStateChange: (sessionId, state) => {
			webLogger.info(
				`[App] AutoRun state change: session=${sessionId}, isRunning=${state?.isRunning}, tasks=${state?.completedTasks}/${state?.totalTasks}`,
				'Mobile'
			);
			setAutoRunStates((prev) => ({
				...prev,
				[sessionId]: state,
			}));
		},
	});

	// Save session selection when it changes (using hook's persistence function)
	useEffect(() => {
		persistSessionSelection({ activeSessionId, activeTabId });
	}, [activeSessionId, activeTabId, persistSessionSelection]);

	// Layer 6.2: bridge the App-level useWebSocket onPty* handlers to per-
	// session <Terminal> instances. The router is mounted by webFull/App.tsx;
	// here we just attach its dispatch methods alongside the existing
	// sessionsHandlers. The router holds listeners in refs, so this merge
	// is stable and doesn't re-render on PTY traffic.
	//
	// ISC-44.global.settings_broadcast — also spread sessionsHandlers and add
	// the settings_changed handler. Routes the WS frame to the module-level
	// event bus in useSettings.ts so every active useSettings() hook (across
	// all Settings tabs) receives the patch and merges into its local state.
	// Last-writer-wins per ISA Principle 2.
	const ptyRouter = usePtyMessageRouter();
	const mergedHandlers = useMemo(
		() => ({
			...sessionsHandlers,
			onPtyData: ptyRouter.dispatchData,
			onPtyBackfill: ptyRouter.dispatchBackfill,
			onPtyDropped: ptyRouter.dispatchDropped,
			onSettingsChanged: (
				changedKeys: string[],
				newValues: Record<string, unknown>,
				timestamp: number
			) => {
				webLogger.debug(`[App] Settings changed: keys=[${changedKeys.join(',')}]`, 'Mobile');
				publishSettingsChanged(changedKeys, newValues, timestamp);
			},
		}),
		[sessionsHandlers, ptyRouter]
	);

	const {
		state: connectionState,
		connect,
		send,
		error,
		reconnectAttempts,
	} = useWebSocket({
		autoReconnect: false, // Only retry manually via the retry button
		handlers: mergedHandlers,
	});

	// Update wsSendRef after WebSocket is initialized (for session management hook)
	useEffect(() => {
		wsSendRef.current = send;
	}, [send]);

	// Connect on mount - use empty dependency array to only connect once
	// The connect function is stable via useRef pattern in useWebSocket
	// On mobile browsers, ensure the document is fully loaded before connecting
	// to avoid race conditions with __MAESTRO_CONFIG__ injection
	useEffect(() => {
		let timeoutId: number | null = null;

		const scheduleAttempt = (delay: number) => {
			timeoutId = window.setTimeout(() => {
				attemptConnect();
			}, delay);
		};

		const attemptConnect = () => {
			// Verify config is available before connecting
			if (window.__MAESTRO_CONFIG__) {
				connect();
			} else {
				// Config not ready, retry after a short delay
				webLogger.warn('Config not ready, retrying connection in 100ms', 'Mobile');
				scheduleAttempt(100);
			}
		};

		const scheduleInitialConnect = () => {
			scheduleAttempt(50);
		};

		let onLoad: (() => void) | null = null;

		// On mobile Safari, the document may not be fully ready even when React mounts
		// Use a small delay to ensure everything is initialized
		if (document.readyState === 'complete') {
			scheduleInitialConnect();
		} else {
			// Wait for page to fully load
			onLoad = () => {
				scheduleInitialConnect();
			};
			window.addEventListener('load', onLoad);
		}

		return () => {
			if (timeoutId) {
				window.clearTimeout(timeoutId);
			}
			if (onLoad) {
				window.removeEventListener('load', onLoad);
			}
		};
	}, []);

	// Determine if we're actually connected
	const isActuallyConnected =
		!isOffline && (connectionState === 'connected' || connectionState === 'authenticated');

	// Offline queue hook - stores commands typed while offline and sends when reconnected
	const {
		queue: offlineQueue,
		queueLength: offlineQueueLength,
		status: offlineQueueStatus,
		queueCommand,
		removeCommand: removeQueuedCommand,
		clearQueue: clearOfflineQueue,
		processQueue: processOfflineQueue,
	} = useOfflineQueue({
		isOnline: !isOffline,
		isConnected: isActuallyConnected,
		sendCommand: (sessionId, command) => {
			return send({
				type: 'send_command',
				sessionId,
				command,
			});
		},
		onCommandSent: (cmd) => {
			webLogger.debug(`Queued command sent: ${cmd.command.substring(0, 50)}`, 'Mobile');
			triggerHaptic(HAPTIC_PATTERNS.success);
		},
		onCommandFailed: (cmd, error) => {
			webLogger.error(`Queued command failed: ${cmd.command.substring(0, 50)}`, 'Mobile', error);
		},
		onProcessingStart: () => {
			webLogger.debug('Processing offline queue...', 'Mobile');
		},
		onProcessingComplete: (successCount, failCount) => {
			webLogger.debug(
				`Offline queue processed. Success: ${successCount}, Failed: ${failCount}`,
				'Mobile'
			);
			if (successCount > 0) {
				triggerHaptic(HAPTIC_PATTERNS.success);
			}
		},
	});

	// Retry connection handler
	const handleRetry = useCallback(() => {
		connect();
	}, [connect]);

	const currentInputMode = ((activeSession?.inputMode as InputMode | undefined) ||
		'ai') as InputMode;
	const activeAiTabId = activeSession?.activeTabId || activeTabId || null;
	const activeAiTab = activeSession?.aiTabs?.find((tab) => tab.id === activeAiTabId);
	const activeAiDraftKey = activeAiTabId || SESSION_LEVEL_AI_DRAFT_KEY;

	const commandInput = useMemo(() => {
		if (!activeSessionId || !activeSession) return '';

		const draftsForSession = commandDrafts[activeSessionId] || getEmptyDrafts();

		if (currentInputMode === 'terminal') {
			return draftsForSession.terminal;
		}

		return draftsForSession.aiByTab[activeAiDraftKey] ?? activeAiTab?.inputValue ?? '';
	}, [
		activeAiDraftKey,
		activeAiTab,
		activeSession,
		activeSessionId,
		commandDrafts,
		currentInputMode,
	]);

	const updateCommandDraft = useCallback(
		(nextValue: string, mode: InputMode = currentInputMode) => {
			if (!activeSessionId) return;

			setCommandDrafts((prev) => {
				const currentDrafts = prev[activeSessionId] || getEmptyDrafts();

				if (mode === 'terminal') {
					if (currentDrafts.terminal === nextValue) {
						return prev;
					}

					return {
						...prev,
						[activeSessionId]: {
							...currentDrafts,
							terminal: nextValue,
						},
					};
				}

				if (currentDrafts.aiByTab[activeAiDraftKey] === nextValue) {
					return prev;
				}

				return {
					...prev,
					[activeSessionId]: {
						...currentDrafts,
						aiByTab: {
							...currentDrafts.aiByTab,
							[activeAiDraftKey]: nextValue,
						},
					},
				};
			});
		},
		[activeAiDraftKey, activeSessionId, currentInputMode]
	);

	const clearCommandDraft = useCallback(
		(sessionId: string, mode: InputMode = currentInputMode) => {
			setCommandDrafts((prev) => {
				const currentDrafts = prev[sessionId] || getEmptyDrafts();

				if (mode === 'terminal') {
					if (currentDrafts.terminal === '') {
						return prev;
					}

					return {
						...prev,
						[sessionId]: {
							...currentDrafts,
							terminal: '',
						},
					};
				}

				if (!(activeAiDraftKey in currentDrafts.aiByTab)) {
					return prev;
				}

				const nextAiByTab = { ...currentDrafts.aiByTab };
				delete nextAiByTab[activeAiDraftKey];

				return {
					...prev,
					[sessionId]: {
						...currentDrafts,
						aiByTab: nextAiByTab,
					},
				};
			});
		},
		[activeAiDraftKey, currentInputMode]
	);

	useEffect(() => {
		setCommandDrafts((prev) => {
			const validSessionIds = new Set(sessions.map((session) => session.id));
			let changed = false;
			const nextDrafts: CommandDraftStore = {};

			for (const [sessionId, drafts] of Object.entries(prev)) {
				if (!validSessionIds.has(sessionId)) {
					changed = true;
					continue;
				}

				const session = sessions.find((item) => item.id === sessionId);
				const validTabIds = new Set(session?.aiTabs?.map((tab) => tab.id) || []);
				validTabIds.add(SESSION_LEVEL_AI_DRAFT_KEY);
				const aiByTab = Object.fromEntries(
					Object.entries(drafts.aiByTab).filter(([tabId]) => validTabIds.has(tabId))
				);

				if (Object.keys(aiByTab).length !== Object.keys(drafts.aiByTab).length) {
					changed = true;
				}

				nextDrafts[sessionId] = {
					aiByTab,
					terminal: drafts.terminal,
				};
			}

			return changed ? nextDrafts : prev;
		});
	}, [sessions]);

	// Auto-reconnect with countdown timer (extracted to hook)
	const { reconnectCountdown } = useMobileAutoReconnect({
		connectionState,
		isOffline,
		connect,
	});

	// Handle opening All Sessions view
	const handleOpenAllSessions = useCallback(() => {
		setShowAllSessions(true);
		triggerHaptic(HAPTIC_PATTERNS.tap);
	}, []);

	// Handle closing All Sessions view
	const handleCloseAllSessions = useCallback(() => {
		setShowAllSessions(false);
	}, []);

	// Handle opening History panel (separate from command history drawer)
	const handleOpenHistoryPanel = useCallback(() => {
		setShowHistoryPanel(true);
		triggerHaptic(HAPTIC_PATTERNS.tap);
	}, []);

	// Handle closing History panel
	const handleCloseHistoryPanel = useCallback(() => {
		setShowHistoryPanel(false);
	}, []);

	// Handle opening Tab Search modal
	const handleOpenTabSearch = useCallback(() => {
		setShowTabSearch(true);
		triggerHaptic(HAPTIC_PATTERNS.tap);
	}, []);

	// Handle closing Tab Search modal
	const handleCloseTabSearch = useCallback(() => {
		setShowTabSearch(false);
	}, []);

	// Handle command submission
	const handleCommandSubmit = useCallback(
		(command: string) => {
			if (!activeSessionId) return;

			// Find the active session to get input mode
			const currentMode = currentInputMode;

			// Provide haptic feedback on send
			triggerHaptic(HAPTIC_PATTERNS.send);

			// Add user message to session logs immediately for display
			addUserLogEntry(command, currentMode);

			// If offline or not connected, queue the command for later
			if (isOffline || !isActuallyConnected) {
				const queued = queueCommand(activeSessionId, command, currentMode);
				if (queued) {
					webLogger.debug(`Command queued for later: ${command.substring(0, 50)}`, 'Mobile');
					// Provide different haptic feedback for queued commands
					triggerHaptic(HAPTIC_PATTERNS.tap);
				} else {
					webLogger.warn('Failed to queue command - queue may be full', 'Mobile');
				}
			} else {
				// Send the command to the active session immediately
				// Include inputMode so the server uses the web's intended mode (not stale server state)
				const sendResult = send({
					type: 'send_command',
					sessionId: activeSessionId,
					command,
					inputMode: currentMode,
				});
				webLogger.info(
					`[Web->Server] Command send result: ${sendResult}, command="${command.substring(
						0,
						50
					)}" mode=${currentMode} session=${activeSessionId}`,
					'Mobile'
				);
			}

			// Clear the input
			clearCommandDraft(activeSessionId, currentMode);
		},
		[
			activeSessionId,
			clearCommandDraft,
			currentInputMode,
			send,
			isOffline,
			isActuallyConnected,
			queueCommand,
			addUserLogEntry,
		]
	);

	// Handle command input change
	const handleCommandChange = useCallback(
		(value: string) => {
			updateCommandDraft(value);
		},
		[updateCommandDraft]
	);

	// Handle mode toggle between AI and Terminal
	const handleModeToggle = useCallback(
		(mode: InputMode) => {
			if (!activeSessionId) return;

			// Provide haptic feedback
			triggerHaptic(HAPTIC_PATTERNS.tap);

			// Send mode switch command via WebSocket
			send({ type: 'switch_mode', sessionId: activeSessionId, mode });

			// Optimistically update local session state
			setSessions((prev) =>
				prev.map((s) => (s.id === activeSessionId ? { ...s, inputMode: mode } : s))
			);

			webLogger.debug(`Mode switched to: ${mode} for session: ${activeSessionId}`, 'Mobile');
		},
		[activeSessionId, send]
	);

	// Handle interrupt request
	const handleInterrupt = useCallback(async (sessionId: string) => {
		// Provide haptic feedback
		triggerHaptic(HAPTIC_PATTERNS.tap);

		try {
			// Build the API URL with security token in path
			const apiUrl = buildApiUrl(`/session/${sessionId}/interrupt`);
			const response = await fetch(apiUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			const result = await response.json();

			if (response.ok && result.success) {
				webLogger.debug(`Session interrupted: ${sessionId}`, 'Mobile');
				triggerHaptic(HAPTIC_PATTERNS.success);
			} else {
				webLogger.error(`Failed to interrupt session: ${result.error}`, 'Mobile');
			}
		} catch (error) {
			webLogger.error('Error interrupting session', 'Mobile', error);
		}
	}, []);

	// Combined slash commands (default + custom from desktop)
	const allSlashCommands = useMemo((): SlashCommand[] => {
		// Convert custom commands to SlashCommand format
		const customSlashCommands: SlashCommand[] = customCommands.map((cmd) => ({
			command: cmd.command.startsWith('/') ? cmd.command : `/${cmd.command}`,
			description: cmd.description,
			aiOnly: true, // Custom commands are AI-only
		}));
		// Combine defaults with custom commands
		return [...DEFAULT_SLASH_COMMANDS, ...customSlashCommands];
	}, [customCommands]);

	// Collect all responses from sessions for navigation
	const allResponses = useMemo((): ResponseItem[] => {
		return (
			sessions
				.filter((s) => (s as any).lastResponse)
				.map((s) => ({
					response: (s as any).lastResponse as LastResponsePreview,
					sessionId: s.id,
					sessionName: s.name,
				}))
				// Sort by timestamp (most recent first)
				.sort((a, b) => b.response.timestamp - a.response.timestamp)
		);
	}, [sessions]);

	// Handle navigating between responses in the viewer
	const handleNavigateResponse = useCallback(
		(index: number) => {
			if (index >= 0 && index < allResponses.length) {
				setResponseIndex(index);
				setSelectedResponse(allResponses[index].response);
				webLogger.debug(`Navigating to response index: ${index}`, 'Mobile');
			}
		},
		[allResponses]
	);

	// Handle closing response viewer
	const handleCloseResponseViewer = useCallback(() => {
		setShowResponseViewer(false);
		// Keep selectedResponse so animation can complete
		setTimeout(() => setSelectedResponse(null), 300);
	}, []);

	// Keyboard shortcuts (Cmd+J mode toggle, Cmd+[/] tab navigation)
	useMobileKeyboardHandler({
		activeSessionId,
		activeSession,
		handleModeToggle,
		handleSelectTab,
	});

	// Layer 4.2 — renderer-aligned tab shortcuts (Cmd+Shift+[/], Cmd+1..9, Cmd+0).
	// Additive to useMobileKeyboardHandler above so the mobile-original Cmd+[/]
	// (no Shift) keeps working for muscle memory.
	useTabKeyboardShortcuts({
		activeSession,
		handleSelectTab,
	});

	// ====================================================================
	// Audit #10 pivot — debug-trigger keybindings for lifted help/info modals
	// ====================================================================
	//
	// These shortcuts close the orphan-to-mounted trigger gap for help modals
	// that the host doesn't yet have first-class entry points for. They're
	// inert while any `<input>` / `<textarea>` / contenteditable is focused
	// (same isInputFocused guard pattern as useTabKeyboardShortcuts), so
	// command input typing is unaffected. Each binding maps to its renderer
	// counterpart where one exists:
	//
	//   - Shift+?            → ShortcutsHelpModal (renderer wires this via
	//                          showShortcutsHelp shortcut at renderer/constants/
	//                          shortcuts.ts; ? is the canonical "show keyboard
	//                          shortcuts" affordance across most apps).
	//   - Cmd+Shift+/        → ShortcutsHelpModal (Mac-friendly alternate).
	//   - Cmd+Shift+H        → HistoryHelpModal (history-panel walkthrough).
	//   - Cmd+Shift+R        → AutoRunnerHelpModal (Auto Run feature walkthrough).
	//   - Cmd+Shift+Q        → QuitConfirmModal (debug-trigger for the
	//                          "agents busy, are you sure?" surface; host
	//                          surfaces this on real quit attempts in a
	//                          subsequent wave).
	//   - Cmd+P              → FileSearchModal (fuzzy file picker — VS Code
	//                          parity; the modal also self-registers Cmd+1..9
	//                          internally via its LayerStack registration).
	//   - Cmd+Alt+F          → trigger a synthetic FirstRunCelebration
	//                          (debug-trigger for the celebration surface;
	//                          real surface fires when an AutoRun completes).
	//   - Cmd+Alt+K          → trigger a synthetic KeyboardMasteryCelebration
	//                          at level 0 (Beginner).
	//   - Cmd+Alt+S          → trigger a synthetic StandingOvationOverlay
	//                          using a placeholder badge from conductorBadges.
	//                          NOTE: this trigger is gated behind the data
	//                          state being null to prevent double-mount.
	useEffect(() => {
		const isInputFocused = (): boolean => {
			const el = document.activeElement as HTMLElement | null;
			if (!el) return false;
			const tag = el.tagName.toLowerCase();
			if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
			if (el.isContentEditable) return true;
			return false;
		};

		const handler = (e: KeyboardEvent) => {
			if (isInputFocused()) return;

			// Shortcuts that don't require a modifier (just Shift)
			if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === '?') {
				e.preventDefault();
				shortcutsHelpGate.show();
				return;
			}

			// Cmd-modified shortcuts
			if (e.metaKey || e.ctrlKey) {
				// Cmd+Shift+/ → shortcuts help (Mac-friendly: / key with Shift IS ?)
				if (e.shiftKey && (e.key === '/' || e.key === '?')) {
					e.preventDefault();
					shortcutsHelpGate.show();
					return;
				}
				// Cmd+Shift+H → history help
				if (e.shiftKey && (e.key === 'H' || e.key === 'h')) {
					e.preventDefault();
					historyHelpGate.show();
					return;
				}
				// Cmd+Shift+R → autorunner help
				if (e.shiftKey && (e.key === 'R' || e.key === 'r')) {
					e.preventDefault();
					autoRunnerHelpGate.show();
					return;
				}
				// Cmd+Shift+Q → quit confirm
				if (e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
					e.preventDefault();
					quitConfirmGate.show();
					return;
				}
				// Cmd+P → file search
				if (!e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
					e.preventDefault();
					fileSearchGate.show();
					return;
				}
				// Mount-wave 2 debug keybindings ----------------------------------
				// Cmd+Shift+N → NewInstanceModal (renderer-canonical is Cmd+N for
				// `newInstance`, but Cmd+N collides with the browser's
				// "new window" — Cmd+Shift+N is the safe webFull-debug variant).
				if (e.shiftKey && (e.key === 'N' || e.key === 'n')) {
					e.preventDefault();
					newInstanceGate.show();
					return;
				}
				// Cmd+Shift+M → MarketplaceModal. No renderer-canonical shortcut
				// (renderer surfaces the marketplace via an explicit button), so
				// Cmd+Shift+M is a webFull-debug pick.
				if (e.shiftKey && (e.key === 'M' || e.key === 'm')) {
					e.preventDefault();
					marketplaceGate.show();
					return;
				}
				// Cmd+, → SettingsModal. OS-canonical "open Settings" shortcut
				// across macOS apps. The `,` key has no Shift requirement.
				if (!e.shiftKey && !e.altKey && e.key === ',') {
					e.preventDefault();
					settingsGate.show();
					return;
				}
				// Cmd+Alt+E → AgentErrorModal (debug only). Real surface fires
				// when an agent emits a structured AgentError; until that wiring
				// lands, the debug trigger mounts a synthetic stub so the
				// surface is reachable for visual / parity verification.
				if (e.altKey && (e.key === 'e' || e.key === 'E' || e.key === '´')) {
					e.preventDefault();
					agentErrorGate.show();
					return;
				}
				// Mount-wave 3 debug keybinding -----------------------------------
				// Cmd+Shift+A → AutoRun (debug). No renderer-canonical shortcut
				// for "show AutoRun" — the renderer docks AutoRun in the right
				// side-panel; webFull doesn't yet have side-panel chrome, so
				// Cmd+Shift+A is the webFull-debug variant that closes the
				// trigger gap for the ~2285-LOC lifted AutoRun surface. Real
				// integration (side-panel toggle / Settings-driven open) lands
				// in subsequent waves once webFull surfaces a docking chrome.
				if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
					e.preventDefault();
					autoRunGate.show();
					return;
				}
				// Cmd+Alt+F → first run celebration (debug)
				if (e.altKey && (e.key === 'f' || e.key === 'F' || e.key === 'ƒ')) {
					e.preventDefault();
					setFirstRunCelebrationData({
						elapsedTimeMs: 60_000,
						completedTasks: 3,
						totalTasks: 3,
					});
					return;
				}
				// Cmd+Alt+K → keyboard mastery celebration (debug)
				if (e.altKey && (e.key === 'k' || e.key === 'K' || e.key === '˚')) {
					e.preventDefault();
					setPendingKeyboardMasteryLevel(0);
					return;
				}
				// Mount-wave 4 debug keybindings ----------------------------------
				// Each keybinding closes the orphan-to-mounted trigger gap for a
				// lifted surface that had ZERO consumers in App.tsx before this
				// commit. Cmd+Alt+* used uniformly (the Cmd+Alt cluster is
				// already established as the wave's debug-trigger namespace by
				// the F/K bindings above). Letters chosen to mnemonic the
				// surface: W=Wizard exit, D=Auto-run Docs, R=Resume wizard,
				// L=Lightbox, I=hIstory detail (H is taken), S=Save markdown,
				// Q=execution Queue, T=custom Theme.
				if (e.altKey && (e.key === 'w' || e.key === 'W' || e.key === '∑')) {
					e.preventDefault();
					wizardExitConfirmGate.show();
					return;
				}
				if (e.altKey && (e.key === 'd' || e.key === 'D' || e.key === '∂')) {
					e.preventDefault();
					existingAutoRunDocsGate.show();
					return;
				}
				if (e.altKey && (e.key === 'r' || e.key === 'R' || e.key === '®')) {
					e.preventDefault();
					wizardResumeGate.show();
					return;
				}
				if (e.altKey && (e.key === 'l' || e.key === 'L' || e.key === '¬')) {
					e.preventDefault();
					lightboxGate.show();
					return;
				}
				if (e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ˆ')) {
					e.preventDefault();
					historyDetailGate.show();
					return;
				}
				if (e.altKey && (e.key === 's' || e.key === 'S' || e.key === 'ß')) {
					e.preventDefault();
					saveMarkdownGate.show();
					return;
				}
				if (e.altKey && (e.key === 'q' || e.key === 'Q' || e.key === 'œ')) {
					e.preventDefault();
					executionQueueBrowserGate.show();
					return;
				}
				if (e.altKey && (e.key === 't' || e.key === 'T' || e.key === '†')) {
					e.preventDefault();
					customThemeBuilderGate.show();
					return;
				}
			}
		};

		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [
		shortcutsHelpGate,
		autoRunnerHelpGate,
		historyHelpGate,
		quitConfirmGate,
		fileSearchGate,
		newInstanceGate,
		marketplaceGate,
		settingsGate,
		agentErrorGate,
		autoRunGate,
		// Mount-wave 4 deps — keep the handler in sync with the new gates so
		// React's stale-closure trap doesn't bite. `useModalGate()` returns a
		// stable object reference per the hook contract, so this list does
		// NOT churn on each render.
		wizardExitConfirmGate,
		existingAutoRunDocsGate,
		wizardResumeGate,
		lightboxGate,
		historyDetailGate,
		saveMarkdownGate,
		executionQueueBrowserGate,
		customThemeBuilderGate,
	]);

	// Derive ContextWarningSash threshold inputs from the active tab's usage
	// stats — same formula MobileHeader already uses. Render the sash only
	// when usage crosses the yellow threshold (60%) — the sash component
	// itself also gates internally on `enabled` + threshold predicates, but
	// computing here avoids an always-mounted invisible div.
	const activeTabForContext = getActiveTabFromSession(activeSession);
	const contextUsageForSash = estimateContextUsage(
		activeTabForContext?.usageStats ?? activeSession?.usageStats ?? {},
		activeSession?.toolType
	);
	const contextWarningEnabled = contextUsageForSash != null && contextUsageForSash >= 60;
	const handleSummarizeClick = useCallback(() => {
		// Host-data TODO: wire to a real /summarize WS frame in a subsequent
		// wave. Per the audit #10 wiring brief, the goal here is to close
		// the trigger gap so the component is REACHABLE, not to ship the
		// full summarize pipeline. Logging is the placeholder side effect.
		webLogger.info('[ContextWarningSash] Summarize requested (TODO: wire to WS)', 'Mobile');
	}, []);

	// ====================================================================
	// Audit #10 pivot — TerminalOutput mount wiring
	// ====================================================================
	//
	// TerminalOutput is the AI Terminal conversation surface — log scrollback,
	// per-entry chrome (copy, delete, save, local filter), markdown rendering,
	// ANSI → HTML for terminal mode, debounced search, queued-items list,
	// and an inline SaveMarkdownModal child.
	//
	// Pre-mount, webFull had ZERO consumer of `TerminalOutput` even though it
	// landed as the largest L2.5 leaf lift (2079 LOC). The mobile shell rendered
	// `MessageHistory` (much smaller parsed-log surface) instead. This wave
	// closes the trigger gap so the actual AI agent conversation surface
	// renders on desktop widths.
	//
	// Gating choice — render TerminalOutput ONLY on desktop widths
	// (`!isSmallScreen`). Mobile small screens keep the existing MessageHistory
	// path because: (a) zero regression risk on the working mobile chrome,
	// (b) TerminalOutput's per-entry chrome (copy/delete/save/filter buttons,
	// search affordance, queued-items list) is desktop-shaped, (c) the brief
	// explicitly authorized this gate: "isSmallScreen || isMobile ? (existing
	// mobile chrome) : (TerminalOutput on desktop)". Mobile parity is a
	// separate concern.
	//
	// Session shape adapter — webFull's `Session` is a thin SessionData wrapper
	// (~13 fields). TerminalOutput's `session: RendererSession` is the full
	// renderer shape (~50+ fields). The adapter below synthesizes a
	// renderer-shaped Session from the webFull session + session-level
	// `sessionLogs.aiLogs` / `sessionLogs.shellLogs`. Critical fields:
	//
	//   - `aiTabs[].logs` — TerminalOutput reads logs via
	//     `getActiveTab(session)?.logs` for AI mode. As of the per-tab log
	//     bucketing wave, webFull's `useMobileSessionManagement` exposes
	//     `sessionLogs.aiLogsByTab: Record<tabId, LogEntry[]>` — the
	//     `session_output` WS frame already carries `tabId` (see
	//     `src/main/process-listeners/data-listener.ts` ≈line 152) and the
	//     consumer hook buckets each streaming entry into the matching tab's
	//     array. The adapter below routes `aiLogsByTab[tab.id]` into each
	//     `aiTab.logs`, restoring per-tab conversation fidelity. The
	//     `AI_LOGS_NO_TAB_BUCKET` fallback (legacy frames missing `tabId`
	//     during a rolling deploy + `user_input` frames that don't carry
	//     `tabId`) is folded into the active tab's view so nothing falls on
	//     the floor during the back-compat window.
	//
	//   - `shellLogs` — pulled straight from `sessionLogs.shellLogs`. Same
	//     `LogEntry.source` widening: webFull's `'user' | 'stdout' | 'stderr'`
	//     is a strict subset of renderer's
	//     `'stdout' | 'stderr' | 'system' | 'user' | 'ai' | 'error' | 'thinking' | 'tool'`,
	//     so the cast is safe.
	//
	//   - Missing fields — `workLog: []`, `fileTree: []`, `changedFiles: []`,
	//     `fileExplorerExpanded: []`, etc. are filled with safe empty
	//     defaults. TerminalOutput doesn't read most of these; the ones it
	//     does (`fullPath`, `projectRoot`, `cwd`, `isGitRepo`) are derived
	//     from the webFull session's `cwd` field.
	//
	// Bionify wiring — `bionifyReadingMode` already on webFull (from
	// `useDesktopTheme`). Intensity + algorithm use the prop defaults
	// (`1` / `'- 0 1 1 2 0.4'`) — webFull doesn't yet have a typed surface
	// for these and they're cosmetic.
	//
	// Write callback — wired to `POST /api/autorun/write-doc` (the closest
	// analog the brief explicitly authorized). `/api/fs/write-file` does NOT
	// exist on this branch; `write-doc` is the W3-fs route that backs
	// `autorun:writeDoc` in the Electron path, and it accepts the same
	// `{path, content}` body shape that SaveMarkdownModal sends.
	const ptyRouterIsRouter = ptyRouter; // alias for clarity
	void ptyRouterIsRouter; // suppress "unused" — referenced for context only

	// Refs that TerminalOutput requires (forwarded but unused at this host).
	const terminalOutputInputRef = useRef<HTMLTextAreaElement>(null);
	const terminalOutputLogsEndRef = useRef<HTMLDivElement>(null);

	// TerminalOutput local UI state (search + markdown-edit mode). Pulled out
	// of the renderer's `useUIStore` / `useSettingsStore` — webFull doesn't
	// thread those yet, so we hold them locally.
	const [terminalOutputSearchOpen, setTerminalOutputSearchOpen] = useState(false);
	const [terminalOutputSearchQuery, setTerminalOutputSearchQuery] = useState('');
	const [terminalMarkdownEditMode, setTerminalMarkdownEditMode] = useState(false);

	// Write-doc bridge — POSTs to `/api/autorun/write-doc` (the closest analog
	// the brief authorized). Returns the SaveMarkdownModal contract shape
	// `{success: boolean; error?: string}`.
	const handleWriteMarkdownFile = useCallback(
		async (
			path: string,
			content: string,
			_sshRemoteId?: string
		): Promise<{ success: boolean; error?: string }> => {
			try {
				const apiUrl = buildApiUrl('/autorun/write-doc');
				const res = await fetch(apiUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ path, content }),
				});
				if (!res.ok) {
					const errText = await res.text().catch(() => '');
					return { success: false, error: `HTTP ${res.status}: ${errText || res.statusText}` };
				}
				return { success: true };
			} catch (err: any) {
				webLogger.error('[TerminalOutput] write-doc failed', 'Mobile', err);
				return { success: false, error: err?.message ?? 'Unknown error' };
			}
		},
		[]
	);

	// Build a renderer-shaped Session from the webFull session. Synthesizes
	// the fields TerminalOutput reads (`aiTabs[].logs`, `shellLogs`, `cwd`,
	// `inputMode`, `state`, etc.) and fills missing renderer fields with safe
	// empty defaults. Returns `null` when there's no active session — the
	// render branch gates on this.
	const rendererShapedSession = useMemo((): RendererSession | null => {
		if (!activeSession) return null;

		// Widen webFull LogEntry.source → renderer LogEntry.source. The webFull
		// `'user' | 'stdout' | 'stderr'` set is a strict subset of the renderer
		// `'stdout' | 'stderr' | 'system' | 'user' | 'ai' | 'error' | 'thinking' | 'tool'`
		// — the cast is safe at the type level. The host-data TODO is to
		// surface richer log sources (system / thinking / tool / error) via
		// new WS frames in a follow-up wave.
		const widenLogs = (logs: typeof sessionLogs.aiLogs): RendererLogEntry[] =>
			logs.map((l) => ({
				id: l.id,
				timestamp: l.timestamp,
				source: l.source as RendererLogEntry['source'],
				text: l.text,
			}));

		const aiLogs = widenLogs(sessionLogs.aiLogs);
		const shellLogs = widenLogs(sessionLogs.shellLogs);

		// Synthesize aiTabs from the webFull session. Per-tab log bucketing wave:
		// `sessionLogs.aiLogsByTab` is a `Record<tabId, LogEntry[]>` populated
		// by `useMobileSessionManagement.onSessionOutput` using the `tabId`
		// field on the `session_output` WS frame. Each tab's `logs` array now
		// pulls FROM its own bucket — multi-tab sessions render the correct
		// per-tab conversation rather than the union-on-active-tab compromise
		// the previous wave shipped.
		//
		// The active tab additionally folds in `AI_LOGS_NO_TAB_BUCKET` (logs
		// that arrived without a `tabId`: legacy server frames in-flight during
		// a rolling deploy, plus `user_input` frames which don't carry tabId).
		// This keeps the back-compat window non-destructive.
		const noTabFallback = widenLogs(sessionLogs.aiLogsByTab[AI_LOGS_NO_TAB_BUCKET] ?? []);

		const synthesizedAiTabs: RendererAITab[] = (activeSession.aiTabs ?? []).map((tab) => {
			const tabBucket = widenLogs(sessionLogs.aiLogsByTab[tab.id] ?? []);
			const isActive = tab.id === activeSession.activeTabId;
			return {
				id: tab.id,
				agentSessionId: tab.agentSessionId ?? null,
				name: tab.name ?? null,
				starred: (tab as any).starred ?? false,
				// Active tab also surfaces the no-tab fallback bucket so
				// untagged user-input + legacy frames remain visible somewhere.
				logs: isActive ? [...tabBucket, ...noTabFallback] : tabBucket,
				inputValue: (tab as any).inputValue ?? '',
				stagedImages: [],
				usageStats: tab.usageStats,
				createdAt: (tab as any).createdAt ?? Date.now(),
				state: ((tab as any).state ?? 'idle') as 'idle' | 'busy',
			};
		});

		// If the session has no aiTabs, synthesize a single tab so TerminalOutput
		// can render `activeTab.logs`. Pure single-tab legacy case: route the
		// flat `aiLogs` (which already includes the no-tab fallback) in.
		const effectiveAiTabs: RendererAITab[] =
			synthesizedAiTabs.length > 0
				? synthesizedAiTabs
				: [
						{
							id: 'default',
							agentSessionId: null,
							name: null,
							starred: false,
							logs: aiLogs,
							inputValue: '',
							stagedImages: [],
							createdAt: Date.now(),
							state: 'idle' as const,
						},
					];

		const effectiveActiveTabId = activeSession.activeTabId ?? effectiveAiTabs[0]?.id ?? 'default';

		return {
			id: activeSession.id,
			groupId: activeSession.groupId ?? undefined,
			name: activeSession.name,
			toolType: activeSession.toolType as any,
			state: activeSession.state as any,
			cwd: activeSession.cwd ?? '',
			fullPath: activeSession.cwd ?? '',
			projectRoot: activeSession.cwd ?? '',
			createdAt: Date.now(),
			aiLogs,
			shellLogs,
			workLog: [],
			contextUsage: 0,
			usageStats: activeSession.usageStats ?? undefined,
			inputMode: (activeSession.inputMode as 'ai' | 'terminal') ?? 'ai',
			aiPid: 0,
			terminalPid: 0,
			port: 0,
			isLive: false,
			changedFiles: [],
			isGitRepo: false,
			fileTree: [],
			fileExplorerExpanded: [],
			fileExplorerScrollPos: 0,
			aiTabs: effectiveAiTabs,
			activeTabId: effectiveActiveTabId,
			agentSessionId: activeSession.agentSessionId ?? undefined,
			thinkingStartTime: activeSession.thinkingStartTime ?? undefined,
		} as RendererSession;
	}, [activeSession, sessionLogs]);

	// ====================================================================
	// Audit #10 mount-wave 2 — host wiring for newly-mounted modals
	// ====================================================================
	//
	// NewInstanceModal needs a small fan-out of stubbed callbacks because
	// the renderer modal's IPC sites were strip-and-promoted to props per
	// the L2.5 lift policy. Until the host writers ship (per the W3-agents
	// posture — agents config CRUD is deferred), every promoted prop is
	// stubbed with an inert default that logs through `webLogger` so it's
	// visible in the observability path. None of the stubs throw — the
	// modal renders, the user can fill the form, the host just doesn't
	// persist anything. Host-data TODO comments mark each wiring site for
	// the next wave.
	//
	// MarketplaceModal wires the `useMarketplace()` browser-runtime hook
	// for the playbook listing / SSE / import path. The folder-picker
	// callback is stubbed (web has no native folder-picker; the affordance
	// hides per the lift policy's `hasFolderPicker` gate).
	//
	// SettingsModal mounts via the local gate — no host props needed; the
	// modal owns its own tab state and the tab bodies thread through the
	// existing `useSettings()` hook.
	//
	// AgentErrorModal mounts a synthetic stub `AgentError` + `RecoveryAction`
	// when the debug keybinding fires. Real surface lands when WS frames
	// for structured agent errors get wired through the parent agent-error
	// handler — for now this proves the modal renders, the recovery action
	// dispatches, and the LayerStack Escape handling works.

	// NewInstanceModal: host-data callbacks (all stubbed; none persist) -----
	const newInstanceAgentConfigs = useMemo<Record<string, Record<string, any>>>(() => ({}), []);
	const newInstanceAvailableModels = useMemo<Record<string, string[]>>(() => ({}), []);
	const handleNewInstanceConfigSave = useCallback(
		async (agentId: string, _config: Record<string, any>) => {
			// host-data TODO: wire to PATCH /api/agents/config once the W3-agents
			// write sub-surface ships. Until then the save is a no-op observable
			// via the webFull logger transport.
			webLogger.warn(
				`[NewInstanceModal] onAgentConfigSave stub fired for agent=${agentId} (no persistence yet)`,
				'Mobile'
			);
		},
		[]
	);
	const handleNewInstanceRefreshModels = useCallback(
		async (agentId: string, _forceRefresh: boolean) => {
			// host-data TODO: thread `agents.getModels` once the host model
			// discovery flow ships. Renderer parity allows this to be a no-op
			// without crashing — AgentConfigPanel degrades to text-input.
			webLogger.warn(
				`[NewInstanceModal] onRefreshModels stub fired for agent=${agentId} (no models source yet)`,
				'Mobile'
			);
		},
		[]
	);
	const handleNewInstanceRemotePathValidate = useCallback(
		async (
			_path: string,
			_sshRemoteId: string
		): Promise<{ valid: boolean; isDirectory: boolean; error?: string }> => {
			// host-data TODO: the W3-fs route deliberately 501s on
			// `?sshRemoteId=`; either Electron IPC or a future remote-aware
			// route needs to fulfill this. Returning `valid: false` keeps the
			// indicator inert without blocking creation (renderer comment:
			// "Remote path validation is informational only").
			return { valid: false, isDirectory: false };
		},
		[]
	);
	const handleNewInstanceFolderPick = useCallback(async (): Promise<string | null> => {
		// host-data TODO: web has no native folder-picker. When the host
		// wires a webFull file-picker overlay this becomes a real call;
		// returning null leaves the input unchanged.
		webLogger.warn('[NewInstanceModal] onFolderPick stub fired (no picker surface yet)', 'Mobile');
		return null;
	}, []);
	const handleNewInstanceCreate = useCallback(
		(
			agentId: string,
			workingDir: string,
			name: string,
			nudgeMessage?: string,
			customPath?: string,
			customArgs?: string,
			customEnvVars?: Record<string, string>,
			customModel?: string,
			customContextWindow?: number,
			customProviderPath?: string,
			sessionSshRemoteConfig?: {
				enabled: boolean;
				remoteId: string | null;
				workingDirOverride?: string;
			},
			groupId?: string
		) => {
			// Audit #13 / ISC-44.wiring.new_instance_modal_create_wired —
			// forward the modal's submission to the server-side `create_session`
			// WS frame. The server mints the session id, applies the mutator,
			// persists, and broadcasts `session_added` so this client (and any
			// peers) hydrate the new row via the existing
			// `handleSessionAdded` handler in useSessions.
			//
			// Fire-and-forget: the modal's onCreate contract is `void`, and
			// the client doesn't need to await — the broadcast lands as the
			// authoritative confirmation. If the WS isn't connected the send
			// returns false; we log and still hide the gate so the user isn't
			// trapped in a non-responsive modal.
			const sent = wsSendRef.current?.({
				type: 'create_session',
				agentId,
				workingDir,
				name,
				nudgeMessage,
				customPath,
				customArgs,
				customEnvVars,
				customModel,
				customContextWindow,
				customProviderPath,
				sessionSshRemoteConfig,
				groupId,
			});
			if (!sent) {
				webLogger.warn(
					`[NewInstanceModal] create_session frame NOT sent (WS not connected) — agent=${agentId} name=${name}`,
					'Mobile'
				);
			} else {
				webLogger.info(
					`[NewInstanceModal] create_session frame sent — agent=${agentId} name=${name} cwd=${workingDir}`,
					'Mobile'
				);
			}
			newInstanceGate.hide();
		},
		[newInstanceGate]
	);

	// MarketplaceModal: useMarketplace() browser-runtime hook + stubs --------
	const marketplaceHook = useMarketplace();
	const handleMarketplaceImportComplete = useCallback(
		(folderName: string) => {
			webLogger.info(`[MarketplaceModal] import complete (folder=${folderName})`, 'Mobile');
			marketplaceGate.hide();
		},
		[marketplaceGate]
	);
	const handleMarketplaceFolderPick = useCallback(async (): Promise<string | null> => {
		// host-data TODO: same picker gap as NewInstanceModal.
		webLogger.warn('[MarketplaceModal] onFolderPick stub fired (no picker surface yet)', 'Mobile');
		return null;
	}, []);
	// Reference the marketplace hook so the import side-effects (cache hydration,
	// SSE listeners) initialize. The modal itself owns the visual surface and
	// re-calls the hook internally; we mainly hold the reference to avoid the
	// "unused" lint and document the runtime port.
	void marketplaceHook;

	// AgentErrorModal: synthetic debug stub ----------------------------------
	const syntheticAgentError = useMemo<AgentError>(
		() => ({
			type: 'agent_crashed',
			message:
				'Debug stub agent error. Real surface fires on structured AgentError WS frames; this proves the modal renders.',
			recoverable: true,
			agentId: activeSession?.toolType ?? 'claude-code',
			sessionId: activeSession?.id,
			timestamp: Date.now(),
		}),
		[activeSession?.toolType, activeSession?.id]
	);
	const syntheticRecoveryActions = useMemo<RecoveryAction[]>(
		() => [
			{
				id: 'dismiss',
				label: 'Dismiss',
				primary: true,
				onClick: () => {
					webLogger.info('[AgentErrorModal] dismiss (debug stub)', 'Mobile');
					agentErrorGate.hide();
				},
			},
		],
		[agentErrorGate]
	);

	// ====================================================================
	// Audit #10 mount-wave 3 — AutoRun host wiring (debug reachability)
	// ====================================================================
	//
	// AutoRun is the ~2285-LOC L2.5 leaf (50 props) lifted from the renderer
	// in `ISC-44.lift.autorun_main` (closed on `aee55e1d3`). The component
	// already runs in pure browser runtime (zero `window.maestro` reads —
	// verified by grep) and the 13 IPC sites were rewritten to W3 REST
	// routes (`/api/fs/read-image`, `/api/autorun/write-doc`,
	// `/api/autorun/{list,save,delete}-image`).
	//
	// Strip-and-promote pattern from the NewInstanceModal mount: each
	// callback prop that the host doesn't have a real wiring source for is
	// stubbed with a `webLogger.warn(...)` so the trigger is observable in
	// the obs path. Data props default to safe values (empty document list,
	// `null` folderPath / selectedFile / batchRunState). The component's
	// "no folder selected" empty state renders inertly until host wires a
	// real `folderPath` source.
	//
	// Host-data TODOs marked at each stub. Real wiring needs (per the
	// lifted component's prop surface):
	//   - useAutoRunContext (renderer-only today) — provides documentList /
	//     documentTree / documentTaskCounts / batchRunState / sessionState
	//   - useAutoRunHandlers (renderer-only today) — provides onCreateDocument /
	//     onSelectDocument / onRefresh / onOpenBatchRunner / onStopBatchRun
	//   - useSettingsStore bionify selectors — already partially threaded
	//     via `useDesktopTheme()` for `bionifyReadingMode`; intensity +
	//     algorithm use the renderer-side defaults until webFull surfaces
	//     a typed setting (the lift docblock authorized this fallback).
	//   - Settings folder-path source — `folderPath` lives on the renderer
	//     in `useSettings().autoRunFolderPath`; webFull's `useSettings()`
	//     doesn't yet expose that field — wave 4 ports the route.
	//
	// Render gating — AutoRun is mounted ONLY when the gate is open
	// (debug-keybinding triggered). This keeps the surface inert during
	// normal operation and avoids any side-effects (cache hydration,
	// imageCache mutations) from happening before the user opts in.
	const handleAutoRunOpenSetup = useCallback(() => {
		// host-data TODO: opens the Settings modal scoped to the AutoRun
		// folder-picker step. Routes through `settingsGate.show()` is the
		// natural eventual binding; for now we keep a `webLogger.warn` so
		// the trigger is observable.
		webLogger.warn('[AutoRun] onOpenSetup stub fired (no Settings wiring yet)', 'Mobile');
	}, []);
	const handleAutoRunRefresh = useCallback(() => {
		webLogger.warn('[AutoRun] onRefresh stub fired (no document refresh wiring yet)', 'Mobile');
	}, []);
	const handleAutoRunSelectDocument = useCallback((filename: string) => {
		webLogger.warn(
			`[AutoRun] onSelectDocument stub fired (filename=${filename}) — no document load wiring`,
			'Mobile'
		);
		setAutoRunSelectedFile(filename);
	}, []);
	const handleAutoRunCreateDocument = useCallback(async (filename: string): Promise<boolean> => {
		// host-data TODO: wire to `/api/autorun/write-doc` once webFull
		// surfaces an `autoRunFolderPath`. Today returns `false` (creation
		// failed) so the modal doesn't think we silently created a file.
		webLogger.warn(
			`[AutoRun] onCreateDocument stub fired (filename=${filename}) — no folder yet`,
			'Mobile'
		);
		return false;
	}, []);
	const handleAutoRunOpenBatchRunner = useCallback(() => {
		webLogger.warn('[AutoRun] onOpenBatchRunner stub fired (no batch runner wiring yet)', 'Mobile');
	}, []);
	const handleAutoRunStopBatchRun = useCallback((sessionId?: string) => {
		webLogger.warn(
			`[AutoRun] onStopBatchRun stub fired (session=${sessionId ?? 'undefined'}) — no batch wiring`,
			'Mobile'
		);
	}, []);
	const handleAutoRunModeChange = useCallback((mode: 'edit' | 'preview') => {
		setAutoRunMode(mode);
	}, []);
	const handleAutoRunContentChange = useCallback((content: string) => {
		setAutoRunContent(content);
	}, []);

	// ====================================================================
	// Audit #10 mount-wave 4 — host wiring for 8 newly-mounted modals
	// ====================================================================
	//
	// Each modal below follows the same strip-and-promote-to-prop pattern
	// established in waves 1-3:
	//   - Callbacks the host doesn't have a real wiring source for are
	//     stubbed with `webLogger.warn(...)` so the trigger is visible in
	//     the obs path. None throw — the modals render, the user can
	//     interact, the host just doesn't persist anything.
	//   - Data props default to safe synthetic values (empty arrays, stub
	//     entries) so the modal renders its "happy path" chrome at least
	//     once. Host-data TODO comments mark each wiring site for the
	//     next wave.
	//   - SaveMarkdownModal's `onWriteFile` is the ONE real wiring —
	//     reuses the existing `handleWriteMarkdownFile` callback already
	//     wired for TerminalOutput's save-markdown affordance (POST to
	//     `/api/autorun/write-doc`).
	//
	// Render gating — each modal is mounted ONLY when its gate is open
	// (debug-keybinding triggered). This keeps the surfaces inert during
	// normal operation and avoids side-effects (fetch calls in
	// WizardResumeModal, layer-stack registrations) until the user opts
	// in via the keybinding.

	// WizardExitConfirmModal — current step + 3 callbacks. All callbacks
	// log + close the gate. Real surface fires from the parent wizard
	// container; until that lands, this proves the modal is reachable.
	const handleWizardExitConfirm = useCallback(() => {
		webLogger.info('[WizardExitConfirmModal] confirm exit (debug stub)', 'Mobile');
		wizardExitConfirmGate.hide();
	}, [wizardExitConfirmGate]);
	const handleWizardExitQuitWithoutSaving = useCallback(() => {
		webLogger.info('[WizardExitConfirmModal] quit without saving (debug stub)', 'Mobile');
		wizardExitConfirmGate.hide();
	}, [wizardExitConfirmGate]);

	// ExistingAutoRunDocsModal — path + count + 3 callbacks. Synthetic
	// directoryPath uses the active session's cwd when present so the
	// modal renders against a plausible value; documentCount is a stub.
	const existingDocsDirectoryPath = activeSession?.cwd ?? '/Users/example/project';
	const handleExistingDocsStartFresh = useCallback(() => {
		webLogger.info(
			'[ExistingAutoRunDocsModal] start fresh (debug stub) — no delete wiring yet',
			'Mobile'
		);
		existingAutoRunDocsGate.hide();
	}, [existingAutoRunDocsGate]);
	const handleExistingDocsContinuePlanning = useCallback(() => {
		webLogger.info(
			'[ExistingAutoRunDocsModal] continue planning (debug stub) — no resume wiring yet',
			'Mobile'
		);
		existingAutoRunDocsGate.hide();
	}, [existingAutoRunDocsGate]);

	// WizardResumeModal — synthesize a `SerializableWizardState` so the
	// modal can render its happy-path chrome. Host-data TODO: thread the
	// real persisted state from `loadResumeState()` when WizardContext
	// gets wired through webFull's host. The component will fetch
	// `/api/git/is-repo` and `/api/agents/detected` on mount (see the
	// validateResumeState effect at WizardResumeModal.tsx:140) — those
	// routes already exist in webFull's server, so the validation flow
	// works end-to-end against the synthetic state.
	const syntheticWizardResumeState = useMemo<SerializableWizardState>(
		() => ({
			currentStep: 'conversation',
			selectedAgent: (activeSession?.toolType as any) ?? 'claude-code',
			agentName: 'Claude Code',
			directoryPath: activeSession?.cwd ?? '',
			isGitRepo: false,
			conversationHistory: [],
			confidenceLevel: 0.5,
			isReadyToProceed: false,
			generatedDocuments: [],
			editedPhase1Content: null,
			wantsTour: false,
		}),
		[activeSession?.toolType, activeSession?.cwd]
	);
	const handleWizardResume = useCallback(
		(options?: { directoryInvalid?: boolean; agentInvalid?: boolean }) => {
			webLogger.info(
				`[WizardResumeModal] resume (debug stub) — directoryInvalid=${options?.directoryInvalid ?? false} agentInvalid=${options?.agentInvalid ?? false}`,
				'Mobile'
			);
			wizardResumeGate.hide();
		},
		[wizardResumeGate]
	);
	const handleWizardResumeStartFresh = useCallback(() => {
		webLogger.info('[WizardResumeModal] start fresh (debug stub)', 'Mobile');
		wizardResumeGate.hide();
	}, [wizardResumeGate]);

	// LightboxModal — single stub image (1x1 transparent PNG data URI) so
	// the modal renders chrome without needing a real image source.
	// stagedImages is single-element so the prev/next nav stays inert.
	const lightboxStubImage = useMemo(
		() =>
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		[]
	);
	const handleLightboxNavigate = useCallback((image: string) => {
		webLogger.info(`[LightboxModal] navigate (debug stub) — image bytes=${image.length}`, 'Mobile');
	}, []);

	// HistoryDetailModal — synthesize a minimal `HistoryEntry` so the
	// modal renders. Host-data TODO: thread a real entry from the
	// MobileHistoryPanel selection when that surface gets a click-through
	// affordance.
	const syntheticHistoryEntry = useMemo<HistoryEntry>(
		() => ({
			id: 'debug-stub-entry',
			type: 'USER',
			timestamp: Date.now() - 60_000,
			summary: 'Debug stub history entry. Real surface fires from MobileHistoryPanel.',
			fullResponse: 'This is a stub `HistoryEntry` shown via the Cmd+Alt+I debug trigger.',
			sessionName: activeSession?.name,
			projectPath: activeSession?.cwd ?? '',
			sessionId: activeSession?.id,
			success: true,
			elapsedTimeMs: 30_000,
		}),
		[activeSession?.name, activeSession?.cwd, activeSession?.id]
	);

	// SaveMarkdownModal — `onWriteFile` reuses the existing
	// `handleWriteMarkdownFile` callback (POST `/api/autorun/write-doc`)
	// already wired for TerminalOutput's save-markdown affordance. The
	// content is a small stub markdown blob; real surface fires from
	// TerminalOutput's per-entry save button.
	const saveMarkdownStubContent = useMemo(
		() =>
			[
				'# Debug Stub Markdown',
				'',
				'This modal was opened via the Cmd+Alt+S debug keybinding.',
				'',
				`Active session: ${activeSession?.name ?? 'none'}`,
				`Timestamp: ${new Date().toISOString()}`,
			].join('\n'),
		[activeSession?.name]
	);

	// ExecutionQueueBrowser — empty sessions array renders the modal's
	// empty-state chrome. Host-data TODO: thread real queued items from
	// the session-level `executionQueue` field when webFull's
	// SessionData surfaces it over the wire.
	const handleExecutionQueueRemoveItem = useCallback((sessionId: string, itemId: string) => {
		webLogger.warn(
			`[ExecutionQueueBrowser] removeItem (debug stub) — session=${sessionId} item=${itemId}`,
			'Mobile'
		);
	}, []);
	const handleExecutionQueueSwitchSession = useCallback(
		(sessionId: string) => {
			webLogger.info(
				`[ExecutionQueueBrowser] switchSession (debug) — routing to handleSelectSession(${sessionId})`,
				'Mobile'
			);
			handleSelectSession(sessionId);
			executionQueueBrowserGate.hide();
		},
		[handleSelectSession, executionQueueBrowserGate]
	);

	// CustomThemeBuilder — needs local state for the color editor since
	// webFull doesn't yet thread a custom-theme settings store. Defaults
	// match the shared `DEFAULT_CUSTOM_THEME_COLORS` + `'dracula'` base.
	const [customThemeColors, setCustomThemeColors] = useState<ThemeColors>(() => ({
		...DEFAULT_CUSTOM_THEME_COLORS,
	}));
	const [customThemeBaseId, setCustomThemeBaseId] = useState<ThemeId>('dracula');
	const [customThemeSelected, setCustomThemeSelected] = useState(false);
	const handleCustomThemeSelect = useCallback(() => {
		setCustomThemeSelected(true);
		webLogger.info('[CustomThemeBuilder] selected (debug stub)', 'Mobile');
	}, []);
	const handleCustomThemeImportError = useCallback((message: string) => {
		webLogger.warn(`[CustomThemeBuilder] import error: ${message}`, 'Mobile');
	}, []);
	const handleCustomThemeImportSuccess = useCallback((message: string) => {
		webLogger.info(`[CustomThemeBuilder] import success: ${message}`, 'Mobile');
	}, []);
	// THEMES reference held so the import isn't dead while the builder is
	// closed (the builder reads it at render time via the imported const).
	// Suppress the unused-import warning when the builder isn't open.
	void THEMES;

	// Determine content based on connection state
	const renderContent = () => {
		// Show offline state when device has no network connectivity
		if (isOffline) {
			return (
				<div
					style={{
						marginBottom: '24px',
						padding: '16px',
						borderRadius: '12px',
						backgroundColor: colors.bgSidebar,
						border: `1px solid ${colors.border}`,
						maxWidth: '300px',
					}}
				>
					<h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
						You're Offline
					</h2>
					<p style={{ fontSize: '14px', color: colors.textDim, marginBottom: '12px' }}>
						No internet connection. Maestro requires a network connection to communicate with your
						desktop app.
					</p>
					<p style={{ fontSize: '12px', color: colors.textDim }}>
						The app will automatically reconnect when you're back online.
					</p>
				</div>
			);
		}

		if (connectionState === 'disconnected') {
			return (
				<div
					style={{
						marginBottom: '24px',
						padding: '16px',
						borderRadius: '12px',
						backgroundColor: colors.bgSidebar,
						border: `1px solid ${colors.border}`,
						maxWidth: '300px',
					}}
				>
					<h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
						Connection Lost
					</h2>
					<p style={{ fontSize: '14px', color: colors.textDim, marginBottom: '12px' }}>
						{error || 'Unable to connect to Maestro desktop app.'}
					</p>
					<p style={{ fontSize: '12px', color: colors.textDim, marginBottom: '12px' }}>
						Reconnecting in {reconnectCountdown}s...
						{reconnectAttempts > 0 && ` (attempt ${reconnectAttempts})`}
					</p>
					<button
						onClick={handleRetry}
						style={{
							padding: '8px 16px',
							borderRadius: '6px',
							backgroundColor: colors.accent,
							color: '#fff',
							fontSize: '14px',
							fontWeight: 500,
							border: 'none',
							cursor: 'pointer',
						}}
					>
						Retry Now
					</button>
				</div>
			);
		}

		if (connectionState === 'connecting' || connectionState === 'authenticating') {
			return (
				<div
					style={{
						marginBottom: '24px',
						padding: '16px',
						borderRadius: '12px',
						backgroundColor: colors.bgSidebar,
						border: `1px solid ${colors.border}`,
						maxWidth: '300px',
					}}
				>
					<h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
						Connecting to Maestro...
					</h2>
					<p style={{ fontSize: '14px', color: colors.textDim }}>
						Please wait while we establish a connection to your desktop app.
					</p>
				</div>
			);
		}

		// Connected or authenticated state - show conversation or prompt to select session
		if (!activeSession) {
			return (
				<div
					style={{
						marginBottom: '24px',
						padding: '16px',
						textAlign: 'center',
					}}
				>
					<p style={{ fontSize: '14px', color: colors.textDim }}>
						Select a session above to get started
					</p>
				</div>
			);
		}

		// Layer 6.2: terminal-mode sessions render through xterm.js instead
		// of the parsed MessageHistory. Per scoping doc §6.1, the protocol
		// trigger is `toolType === 'terminal'` (the PTY-backed session kind),
		// NOT `inputMode === 'terminal'` (which AI sessions can also enter at
		// runtime — those still go through the parsed-shell path). The L6.1
		// server only emits raw bytes for PTY-backed sessions.
		//
		// No user-facing toggle yet — L6.2 ships unconditional render for
		// the right session kind. Fallback to MessageHistory is a future
		// preference if real-world links prove too flaky.
		if (activeSession.toolType === 'terminal') {
			return (
				<div
					style={{
						width: '100%',
						maxWidth: '100%',
						display: 'flex',
						flexDirection: 'column',
						flex: 1,
						minHeight: 0,
						overflow: 'hidden',
					}}
				>
					<Terminal sessionId={activeSession.id} send={send} />
				</div>
			);
		}

		// Get logs based on current input mode
		const currentLogs =
			activeSession.inputMode === 'ai' ? sessionLogs.aiLogs : sessionLogs.shellLogs;

		// Audit #10 pivot — desktop widths render TerminalOutput (the full
		// AI Terminal conversation surface), mobile small screens keep the
		// existing MessageHistory chrome. Gate per the brief's explicit
		// "isSmallScreen || isMobile ? mobile chrome : TerminalOutput on
		// desktop" guidance. The renderer-shaped session adapter
		// (`rendererShapedSession`) handles the shape impedance — see the
		// extended doc-block above the adapter.
		if (!isSmallScreen && rendererShapedSession) {
			return (
				<div
					style={{
						width: '100%',
						maxWidth: '100%',
						display: 'flex',
						flexDirection: 'column',
						flex: 1,
						minHeight: 0,
						overflow: 'hidden',
					}}
				>
					<TerminalOutput
						key={`${activeSession.id}-${activeSession.activeTabId ?? 'default'}`}
						session={rendererShapedSession}
						theme={theme}
						// Monospace stack — webFull doesn't yet thread a typed
						// fontFamily setting; default matches common terminal
						// surfaces. Host-data TODO: surface via useSettings()
						// once a typed font-family setting lands on webFull.
						fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
						activeFocus={'main' as FocusArea}
						outputSearchOpen={terminalOutputSearchOpen}
						outputSearchQuery={terminalOutputSearchQuery}
						setOutputSearchOpen={setTerminalOutputSearchOpen}
						setOutputSearchQuery={setTerminalOutputSearchQuery}
						setActiveFocus={() => {
							/* host-data TODO: thread a real focus-area store; webFull
							   doesn't yet have one. Inert stub keeps the contract. */
						}}
						setLightboxImage={() => {
							/* host-data TODO: wire to a lightbox modal. The renderer
							   uses a setter from useUIStore; webFull doesn't yet
							   surface a lightbox. Inert stub. */
						}}
						inputRef={terminalOutputInputRef}
						logsEndRef={terminalOutputLogsEndRef}
						maxOutputLines={10000}
						markdownEditMode={terminalMarkdownEditMode}
						setMarkdownEditMode={setTerminalMarkdownEditMode}
						bionifyReadingMode={bionifyReadingMode}
						onWriteMarkdownFile={handleWriteMarkdownFile}
						// onBrowseMarkdownFolder intentionally omitted — webFull
						// doesn't yet surface a folder picker, so the folder-browse
						// button stays hidden (matches the renderer's
						// !isRemoteSession gating).
						// onInterrupt — wired to the existing session-interrupt
						// REST endpoint. The same handler the CommandInputBar uses.
						onInterrupt={activeSessionId ? () => handleInterrupt(activeSessionId) : undefined}
						cwd={activeSession.cwd}
						projectRoot={activeSession.cwd}
					/>
				</div>
			);
		}

		// Show message history (mobile small screens, or when adapter returned null)
		return (
			<div
				style={{
					width: '100%',
					maxWidth: '100%',
					display: 'flex',
					flexDirection: 'column',
					gap: '8px',
					alignItems: 'stretch',
					flex: 1,
					minHeight: 0, // Required for nested flex scroll to work
					overflow: 'hidden', // Contain MessageHistory's scroll
				}}
			>
				{isLoadingLogs ? (
					<div
						style={{
							padding: '16px',
							textAlign: 'center',
							color: colors.textDim,
							fontSize: '13px',
						}}
					>
						Loading conversation...
					</div>
				) : currentLogs.length === 0 ? (
					<div
						style={{
							padding: '16px',
							textAlign: 'center',
							color: colors.textDim,
							fontSize: '14px',
						}}
					>
						{activeSession.inputMode === 'ai'
							? 'Ask your AI assistant anything'
							: 'Run shell commands'}
					</div>
				) : (
					<MessageHistory
						logs={currentLogs}
						inputMode={activeSession.inputMode as 'ai' | 'terminal'}
						autoScroll={true}
						maxHeight="none"
						enableBionifyReadingMode={bionifyReadingMode}
					/>
				)}
			</div>
		);
	};

	// CSS variable for dynamic viewport height with fallback
	// The fixed CommandInputBar requires padding at the bottom of the container
	const containerStyle: React.CSSProperties = {
		display: 'flex',
		flexDirection: 'column',
		height: '100dvh',
		maxHeight: '100dvh',
		overflow: 'hidden',
		backgroundColor: colors.bgMain,
		color: colors.textMain,
	};

	// Determine if session pill bar should be shown
	const showSessionPillBar =
		!isOffline &&
		(connectionState === 'connected' || connectionState === 'authenticated') &&
		sessions.length > 0;

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: isSmallScreen ? 'column' : 'row',
				height: '100dvh',
				maxHeight: '100dvh',
				overflow: 'hidden',
				backgroundColor: colors.bgMain,
				color: colors.textMain,
			}}
		>
			{/* Layer 4.1 — Left Bar (renders only on desktop widths) */}
			<DesktopSidebar
				sessions={sessions}
				activeSessionId={activeSessionId}
				onSelectSession={handleSelectSession}
				isSmallScreen={isSmallScreen}
			/>
			<div style={{ ...containerStyle, flex: 1, height: '100%' }}>
				{/* Header with session info */}
				<MobileHeader activeSession={activeSession} />

				{/* Session pill bar - Row 1: Groups/Sessions with search button */}
				{showSessionPillBar && (
					<SessionPillBar
						sessions={sessions}
						activeSessionId={activeSessionId}
						onSelectSession={handleSelectSession}
						onOpenAllSessions={handleOpenAllSessions}
						onOpenHistory={handleOpenHistoryPanel}
						onToggleBookmark={handleToggleBookmark}
					/>
				)}

				{/* Tab bar - Row 2: Tabs for active session with search button */}
				{activeSession?.inputMode === 'ai' &&
					activeSession?.aiTabs &&
					activeSession.aiTabs.length > 1 &&
					activeSession.activeTabId && (
						<TabBar
							tabs={activeSession.aiTabs}
							activeTabId={activeSession.activeTabId}
							onSelectTab={handleSelectTab}
							onNewTab={handleNewTab}
							onCloseTab={handleCloseTab}
							onOpenTabSearch={handleOpenTabSearch}
							onRenameTab={handleRenameTab}
							onStarTab={handleStarTab}
							onReorderTab={handleReorderTab}
						/>
					)}

				{/* AutoRun indicator - shown when batch processing is active on desktop */}
				{activeSessionId && autoRunStates[activeSessionId] && (
					<AutoRunIndicator
						state={autoRunStates[activeSessionId]}
						sessionName={activeSession?.name}
					/>
				)}

				{/* Offline queue banner - shown when there are queued commands */}
				{offlineQueueLength > 0 && (
					<OfflineQueueBanner
						queue={offlineQueue}
						status={offlineQueueStatus}
						onClearQueue={clearOfflineQueue}
						onProcessQueue={processOfflineQueue}
						onRemoveCommand={removeQueuedCommand}
						isOffline={isOffline}
						isConnected={isActuallyConnected}
					/>
				)}

				{/* All Sessions view - full-screen modal with larger session cards */}
				{showAllSessions && (
					<AllSessionsView
						sessions={sessions}
						activeSessionId={activeSessionId}
						onSelectSession={handleSelectSession}
						onClose={handleCloseAllSessions}
					/>
				)}

				{/* History panel - full-screen modal with history entries */}
				{showHistoryPanel && (
					<MobileHistoryPanel
						onClose={handleCloseHistoryPanel}
						projectPath={activeSession?.cwd}
						sessionId={activeSessionId || undefined}
						initialFilter={historyFilter}
						initialSearchQuery={historySearchQuery}
						initialSearchOpen={historySearchOpen}
						onFilterChange={setHistoryFilter}
						onSearchChange={(query, isOpen) => {
							setHistorySearchQuery(query);
							setHistorySearchOpen(isOpen);
						}}
					/>
				)}

				{/* Tab search modal - full-screen modal for searching tabs */}
				{showTabSearch && activeSession?.aiTabs && activeSession.activeTabId && (
					<TabSearchModal
						tabs={activeSession.aiTabs}
						activeTabId={activeSession.activeTabId}
						onSelectTab={handleSelectTab}
						onClose={handleCloseTabSearch}
					/>
				)}

				{/* Main content area */}
				<main
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'flex-start',
						padding: '12px',
						paddingBottom: 'calc(80px + env(safe-area-inset-bottom))', // Account for fixed input bar
						textAlign: 'center',
						overflow: 'hidden', // Changed from 'auto' - let MessageHistory handle scrolling
						minHeight: 0, // Required for flex child to scroll properly
					}}
				>
					{/* Content wrapper */}
					<div
						style={{
							flex: 1,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							justifyContent:
								connectionState === 'connected' || connectionState === 'authenticated'
									? 'flex-start'
									: 'center',
							width: '100%',
							minHeight: 0,
							overflow: 'hidden', // Contain child scroll
						}}
					>
						{renderContent()}
						{/* Show help text only when disconnected/connecting */}
						{connectionState !== 'connected' && connectionState !== 'authenticated' && (
							<p style={{ fontSize: '12px', color: colors.textDim }}>
								Make sure Maestro desktop app is running
							</p>
						)}
					</div>
				</main>

				{/* Sticky bottom command input bar */}
				<CommandInputBar
					isOffline={isOffline}
					isConnected={connectionState === 'connected' || connectionState === 'authenticated'}
					value={commandInput}
					onChange={handleCommandChange}
					onSubmit={handleCommandSubmit}
					placeholder={
						!activeSessionId
							? 'Select a session first...'
							: activeSession?.inputMode === 'ai'
								? isSmallScreen
									? 'Ask AI...'
									: `Ask ${
											activeSession?.toolType === 'claude-code'
												? 'Claude'
												: activeSession?.toolType || 'AI'
										} about ${activeSession?.name || 'this session'}...`
								: 'Run shell command...'
					}
					disabled={!activeSessionId}
					inputMode={(activeSession?.inputMode as InputMode) || 'ai'}
					onModeToggle={handleModeToggle}
					isSessionBusy={activeSession?.state === 'busy'}
					onInterrupt={activeSessionId ? () => handleInterrupt(activeSessionId) : undefined}
					hasActiveSession={!!activeSessionId}
					cwd={activeSession?.cwd}
					slashCommands={allSlashCommands}
					showRecentCommands={false}
				/>

				{/* Full-screen response viewer modal */}
				<ResponseViewer
					isOpen={showResponseViewer}
					response={selectedResponse}
					allResponses={allResponses.length > 1 ? allResponses : undefined}
					currentIndex={responseIndex}
					onNavigate={handleNavigateResponse}
					onClose={handleCloseResponseViewer}
					sessionName={activeSession?.name}
					enableBionifyReadingMode={bionifyReadingMode}
				/>

				{/* ============================================================ */}
				{/* Audit #10 pivot — orphan-to-mounted wiring                    */}
				{/* ============================================================ */}

				{/* ContextWarningSash — context-window warning banner. Pinned       */}
				{/* near the top of the workspace so the sash can wedge in above    */}
				{/* MessageHistory without disrupting the input bar at the bottom.  */}
				{/* Component internally gates rendering when `enabled=false` OR    */}
				{/* `contextUsage < yellowThreshold` — so always-mounting is safe. */}
				<ContextWarningSash
					theme={theme}
					contextUsage={contextUsageForSash ?? 0}
					yellowThreshold={60}
					redThreshold={80}
					enabled={contextWarningEnabled}
					onSummarizeClick={handleSummarizeClick}
					tabId={activeSession?.activeTabId}
				/>

				{/* AppOverlays dispatcher trio — render-prop slots wire the three  */}
				{/* concrete overlays into the dispatcher per its contract. Each   */}
				{/* slot is mounted only when its matching data prop is non-null    */}
				{/* (the dispatcher's gating predicate). Slot ReactNodes are        */}
				{/* pre-bound to the local close handlers so the dispatcher stays  */}
				{/* a pure visibility gate.                                         */}
				<AppOverlays
					theme={theme}
					standingOvationData={standingOvationData}
					firstRunCelebrationData={firstRunCelebrationData}
					pendingKeyboardMasteryLevel={pendingKeyboardMasteryLevel}
					firstRunCelebrationSlot={
						firstRunCelebrationData && (
							<FirstRunCelebration
								theme={theme}
								elapsedTimeMs={firstRunCelebrationData.elapsedTimeMs}
								completedTasks={firstRunCelebrationData.completedTasks}
								totalTasks={firstRunCelebrationData.totalTasks}
								onClose={() => setFirstRunCelebrationData(null)}
							/>
						)
					}
					keyboardMasterySlot={
						pendingKeyboardMasteryLevel !== null && (
							<KeyboardMasteryCelebration
								theme={theme}
								level={pendingKeyboardMasteryLevel}
								onClose={() => setPendingKeyboardMasteryLevel(null)}
							/>
						)
					}
					standingOvationSlot={
						standingOvationData && (
							<StandingOvationOverlay
								theme={theme}
								themeMode={theme.mode}
								badge={standingOvationData.badge}
								isNewRecord={standingOvationData.isNewRecord}
								recordTimeMs={standingOvationData.recordTimeMs}
								cumulativeTimeMs={0}
								onClose={() => setStandingOvationData(null)}
							/>
						)
					}
				/>

				{/* ShortcutsHelpModal — Shift+? triggers; surface previously had */}
				{/* zero consumers despite the lift landing. Renderer wires this   */}
				{/* via the showShortcutsHelp shortcut at renderer/constants/      */}
				{/* shortcuts.ts; webFull doesn't yet thread the full shortcuts    */}
				{/* settings store, so DEFAULT_SHORTCUTS + TAB_SHORTCUTS are       */}
				{/* passed as the static parity-shape fallback. Future host wave  */}
				{/* swaps in the user-customized records from useSettings().       */}
				{shortcutsHelpGate.open && (
					<ShortcutsHelpModal
						theme={theme}
						shortcuts={DEFAULT_SHORTCUTS}
						tabShortcuts={TAB_SHORTCUTS}
						onClose={shortcutsHelpGate.hide}
					/>
				)}

				{/* AutoRunnerHelpModal — Cmd+Shift+R triggers. */}
				{autoRunnerHelpGate.open && (
					<AutoRunnerHelpModal theme={theme} onClose={autoRunnerHelpGate.hide} />
				)}

				{/* HistoryHelpModal — Cmd+Shift+H triggers. */}
				{historyHelpGate.open && <HistoryHelpModal theme={theme} onClose={historyHelpGate.hide} />}

				{/* QuitConfirmModal — Cmd+Shift+Q triggers (debug). Real surface    */}
				{/* fires on a quit attempt with busy agents; host wires that later. */}
				{quitConfirmGate.open && (
					<QuitConfirmModal
						theme={theme}
						busyAgentCount={0}
						busyAgentNames={[]}
						onConfirmQuit={() => {
							quitConfirmGate.hide();
							webLogger.info('[QuitConfirmModal] confirmed (debug stub)', 'Mobile');
						}}
						onCancel={quitConfirmGate.hide}
					/>
				)}

				{/* FileSearchModal — Cmd+P triggers. The file tree comes from the */}
				{/* host's project state; until that's wired, an empty tree mounts   */}
				{/* the surface and proves the keybinding/registration works.        */}
				{fileSearchGate.open && (
					<FileSearchModal
						theme={theme}
						fileTree={[]}
						expandedFolders={[]}
						onFileSelect={(item) => {
							webLogger.info(
								`[FileSearchModal] selected file: ${item.fullPath} (debug stub)`,
								'Mobile'
							);
							fileSearchGate.hide();
						}}
						onClose={fileSearchGate.hide}
					/>
				)}

				{/* ============================================================ */}
				{/* Audit #10 mount-wave 2 — NewInstanceModal, MarketplaceModal,  */}
				{/* SettingsModal, AgentErrorModal                                */}
				{/* ============================================================ */}

				{/* NewInstanceModal — Cmd+Shift+N triggers (debug).               */}
				{/* `onCreate` IS WIRED to the `create_session` WS frame (audit    */}
				{/* #13 / ISC-44.wiring.new_instance_modal_create_wired). The      */}
				{/* server applies the mutator, persists, and broadcasts          */}
				{/* `session_added`; the client hydrates via the existing          */}
				{/* `handleSessionAdded` handler in useSessions. Other 8 props    */}
				{/* remain stubbed (agentConfigs / availableModels empty, no-op    */}
				{/* onAgentConfigSave / onRefreshModels, valid:false               */}
				{/* onRemotePathValidate, null onFolderPick). `existingSessions`   */}
				{/* is `[]` because the webFull Session shape differs from the    */}
				{/* renderer Session shape — empty array is the trivial            */}
				{/* "no conflicts" case for validateNewSession. Host-data TODO:    */}
				{/* thread real sessions for duplicate-name detection.             */}
				{newInstanceGate.open && (
					<NewInstanceModal
						isOpen={newInstanceGate.open}
						onClose={newInstanceGate.hide}
						onCreate={handleNewInstanceCreate}
						theme={theme}
						existingSessions={[]}
						agentConfigs={newInstanceAgentConfigs}
						availableModels={newInstanceAvailableModels}
						onRefreshModels={handleNewInstanceRefreshModels}
						onAgentConfigSave={handleNewInstanceConfigSave}
						onFolderPick={handleNewInstanceFolderPick}
						onRemotePathValidate={handleNewInstanceRemotePathValidate}
					/>
				)}

				{/* MarketplaceModal — Cmd+Shift+M triggers (debug). Wires the     */}
				{/* `useMarketplace()` browser-runtime port for the playbook       */}
				{/* listing + SSE-driven cache. `autoRunFolderPath` is empty       */}
				{/* (host doesn't yet thread an AutoRun folder path on webFull);   */}
				{/* `sessionId` falls back to the active session id when present.  */}
				{/* `sshRemoteId` intentionally omitted — the headless server      */}
				{/* import path 500s on SSH remotes (W3-marketplace posture).      */}
				{/* `onFolderPick` is stubbed (web has no native folder picker —   */}
				{/* the browse button hides per the lift policy's gating).         */}
				{marketplaceGate.open && (
					<MarketplaceModal
						theme={theme}
						isOpen={marketplaceGate.open}
						onClose={marketplaceGate.hide}
						autoRunFolderPath=""
						sessionId={activeSessionId ?? ''}
						onImportComplete={handleMarketplaceImportComplete}
						onFolderPick={handleMarketplaceFolderPick}
					/>
				)}

				{/* SettingsModal — Cmd+, triggers (OS-canonical Settings        */}
				{/* shortcut). The modal already wraps the three lifted tab        */}
				{/* bodies (GeneralTab, DisplayTab, ShortcutsTab) and threads      */}
				{/* their state through `useSettings()` internally. No host-data   */}
				{/* TODO — this surface is complete on the webFull side.           */}
				{settingsGate.open && (
					<SettingsModal isOpen={settingsGate.open} onClose={settingsGate.hide} theme={theme} />
				)}

				{/* AgentErrorModal — Cmd+Alt+E triggers (debug). Real surface     */}
				{/* fires when the agent emits a structured AgentError WS frame.   */}
				{/* Until that handler ships, the debug trigger mounts a synthetic */}
				{/* `agent_crashed` error + a single "Dismiss" recovery action so  */}
				{/* the modal's chrome (error-color icon, JSON-details affordance, */}
				{/* primary action focus) is reachable for visual / parity check.  */}
				{agentErrorGate.open && (
					<AgentErrorModal
						theme={theme}
						error={syntheticAgentError}
						agentName={activeSession?.toolType}
						sessionName={activeSession?.name}
						recoveryActions={syntheticRecoveryActions}
						onDismiss={agentErrorGate.hide}
					/>
				)}

				{/* ============================================================ */}
				{/* Audit #10 mount-wave 3 — AutoRun                              */}
				{/* ============================================================ */}

				{/* AutoRun — Cmd+Shift+A triggers (debug). The renderer docks    */}
				{/* this surface in `RightPanel.tsx`; webFull doesn't yet have a  */}
				{/* side-panel chrome, so this wave mounts it as a full-screen    */}
				{/* overlay with a close affordance. All host-data callbacks      */}
				{/* are stubbed per the L2.5 strip-and-promote pattern (see       */}
				{/* the host-wiring block above this JSX tree for TODOs). The     */}
				{/* component itself runs in pure browser runtime — verified by  */}
				{/* `grep window.maestro src/webFull/components/AutoRun.tsx` →    */}
				{/* zero hits. `folderPath={null}` triggers the component's      */}
				{/* "no folder selected" empty state (the chrome renders inert   */}
				{/* and no fetch side-effects fire until host wires a real       */}
				{/* folder source).                                              */}
				{autoRunGate.open && (
					<div
						style={{
							position: 'fixed',
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							backgroundColor: colors.bgMain,
							zIndex: 1000,
							display: 'flex',
							flexDirection: 'column',
							overflow: 'hidden',
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: '8px 12px',
								borderBottom: `1px solid ${colors.border}`,
								backgroundColor: colors.bgSidebar,
							}}
						>
							<span style={{ fontSize: '13px', fontWeight: 500, color: colors.textMain }}>
								AutoRun (debug)
							</span>
							<button
								onClick={autoRunGate.hide}
								style={{
									padding: '4px 10px',
									borderRadius: '4px',
									backgroundColor: 'transparent',
									color: colors.textMain,
									border: `1px solid ${colors.border}`,
									cursor: 'pointer',
									fontSize: '12px',
								}}
							>
								Close
							</button>
						</div>
						<div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
							<AutoRun
								theme={theme}
								sessionId={activeSessionId ?? ''}
								folderPath={null}
								selectedFile={autoRunSelectedFile}
								documentList={[]}
								content={autoRunContent}
								onContentChange={handleAutoRunContentChange}
								mode={autoRunMode}
								onModeChange={handleAutoRunModeChange}
								onOpenSetup={handleAutoRunOpenSetup}
								onRefresh={handleAutoRunRefresh}
								onSelectDocument={handleAutoRunSelectDocument}
								onCreateDocument={handleAutoRunCreateDocument}
								onOpenBatchRunner={handleAutoRunOpenBatchRunner}
								onStopBatchRun={handleAutoRunStopBatchRun}
								bionifyReadingMode={bionifyReadingMode}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
