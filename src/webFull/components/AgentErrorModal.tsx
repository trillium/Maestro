/**
 * AgentErrorModal
 *
 * Lifted from `src/renderer/components/AgentErrorModal.tsx` as part of the
 * Layer 2.5 leaf-parade wave (audit #6: 264 LOC, 0 IPC, 0 Electron-only APIs).
 * Implementation is verbatim except for the standard L2.5 import-path
 * adjustments:
 *
 * - `Theme` previously resolved through the renderer's
 *   `src/renderer/types/index.ts` aggregator (which re-exports the shape
 *   that lives in `src/shared/theme-types`). webFull has no `types/`
 *   aggregator — `Theme` is pulled directly from `src/shared/theme-types`
 *   (matches the L2.1 / L2.3 / L2.4 / L2.5 sibling precedent).
 * - `AgentError` + `AgentErrorType` are pulled directly from
 *   `src/shared/types` — those shapes already live in `src/shared/` and the
 *   renderer aggregator only re-exports them. No need to route through the
 *   renderer aggregator at all.
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08
 *   audit risk A — non-divergent constants stay re-exported from renderer
 *   to prevent silent drift). Uses `MODAL_PRIORITIES.AGENT_ERROR` (1010).
 * - `Modal` is the L2.1-lifted webFull primitive at
 *   `src/webFull/components/ui/Modal.tsx`.
 * - `CollapsibleJsonViewer` is pulled directly from
 *   `src/renderer/components/CollapsibleJsonViewer.tsx` by relative path.
 *   Pre-flight grep confirms it touches 0 IPC namespaces and 0 Electron
 *   APIs: its only non-pure import is `safeClipboardWrite` from
 *   `src/renderer/utils/clipboard.ts`, which routes through
 *   `navigator.clipboard.writeText` only (the `window.maestro.shell`
 *   surface is exclusively inside `safeClipboardWriteImage`, a sibling
 *   function this component does not call). Pulling directly from the
 *   renderer matches the L2.5 precedent of importing pure leaves by
 *   relative path rather than duplicating into `src/webFull/` (audit risk
 *   A: silent-drift avoidance).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop
 * convention, consistent with the L2.1 / L2.3 / L2.4 / L2.5 sibling lifts.
 * Callers in webFull call `const { theme } = useTheme()` at the
 * feature-component level and thread it down.
 *
 * Composition shape: error-display modal — composes the L2.1 `Modal`
 * primitive directly (no `ModalFooter`; the action surface is a column of
 * recovery-action buttons plus a separate Dismiss row, neither of which
 * fits the two-button confirm/cancel idiom). Threads `theme` as a prop,
 * consumes `MODAL_PRIORITIES.AGENT_ERROR` (1010), uses `initialFocusRef`
 * to land focus on the primary recovery action.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

/**
 * AgentErrorModal - Displays agent errors with recovery options
 *
 * This modal appears when an agent encounters an error such as:
 * - Authentication failure
 * - Token/context exhaustion
 * - Rate limiting
 * - Network errors
 * - Agent crashes
 *
 * The modal provides:
 * - Clear error description with type indicator
 * - Collapsible JSON details viewer for structured error data
 * - Recovery action buttons (re-authenticate, start new session, retry, etc.)
 * - Dismiss option for non-critical errors
 * - Auto-focus on primary recovery action
 */

import React, { useRef, useMemo, useState } from 'react';
import {
	AlertCircle,
	RefreshCw,
	KeyRound,
	MessageSquarePlus,
	Wifi,
	XCircle,
	Clock,
	ShieldAlert,
	ChevronDown,
	ChevronRight,
	Code2,
} from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { AgentError, AgentErrorType } from '../../shared/types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';
import { CollapsibleJsonViewer } from './CollapsibleJsonViewer';

/**
 * Props for recovery action buttons
 */
export interface RecoveryAction {
	id: string;
	label: string;
	description?: string;
	primary?: boolean;
	icon?: React.ReactNode;
	onClick: () => void;
}

interface AgentErrorModalProps {
	theme: Theme;
	error: AgentError;
	agentName?: string;
	sessionName?: string;
	recoveryActions: RecoveryAction[];
	onDismiss: () => void;
	/** Whether the error can be dismissed (vs. requiring action) */
	dismissible?: boolean;
}

/**
 * Get the icon for an error type
 */
function getErrorIcon(type: AgentErrorType): React.ReactNode {
	switch (type) {
		case 'auth_expired':
			return <KeyRound className="w-6 h-6" />;
		case 'token_exhaustion':
			return <MessageSquarePlus className="w-6 h-6" />;
		case 'rate_limited':
			return <Clock className="w-6 h-6" />;
		case 'network_error':
			return <Wifi className="w-6 h-6" />;
		case 'agent_crashed':
			return <XCircle className="w-6 h-6" />;
		case 'permission_denied':
			return <ShieldAlert className="w-6 h-6" />;
		default:
			return <AlertCircle className="w-6 h-6" />;
	}
}

/**
 * Get a human-readable title for an error type
 */
function getErrorTitle(type: AgentErrorType): string {
	switch (type) {
		case 'auth_expired':
			return 'Authentication Required';
		case 'token_exhaustion':
			return 'Context Limit Reached';
		case 'rate_limited':
			return 'Rate Limit Exceeded';
		case 'network_error':
			return 'Connection Error';
		case 'agent_crashed':
			return 'Agent Error';
		case 'permission_denied':
			return 'Permission Denied';
		default:
			return 'Error';
	}
}

/**
 * Get the error color based on recoverability
 */
function getErrorColor(error: AgentError, theme: Theme): string {
	if (!error.recoverable) {
		return theme.colors.error;
	}
	// Use warning color for recoverable errors
	return theme.colors.warning;
}

export function AgentErrorModal({
	theme,
	error,
	agentName,
	sessionName,
	recoveryActions,
	onDismiss,
	dismissible = true,
}: AgentErrorModalProps) {
	const primaryButtonRef = useRef<HTMLButtonElement>(null);
	const [showJsonDetails, setShowJsonDetails] = useState(false);

	// Find the primary recovery action for initial focus
	const primaryAction = useMemo(
		() => recoveryActions.find((a) => a.primary) || recoveryActions[0],
		[recoveryActions]
	);

	// Check if we have JSON details to show
	const hasJsonDetails = error.parsedJson !== undefined;

	const errorColor = getErrorColor(error, theme);
	const errorIcon = getErrorIcon(error.type);
	const errorTitle = getErrorTitle(error.type);

	return (
		<Modal
			theme={theme}
			title={errorTitle}
			priority={MODAL_PRIORITIES.AGENT_ERROR}
			onClose={onDismiss}
			width={hasJsonDetails && showJsonDetails ? 600 : 480}
			zIndex={10001}
			showCloseButton={dismissible}
			headerIcon={<span style={{ color: errorColor }}>{errorIcon}</span>}
			initialFocusRef={primaryButtonRef}
		>
			{/* Error Details */}
			<div className="space-y-4">
				{/* Agent and session context */}
				{(agentName || sessionName) && (
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						{agentName && <span>{agentName}</span>}
						{agentName && sessionName && <span> • </span>}
						{sessionName && <span>{sessionName}</span>}
					</div>
				)}

				{/* Error message */}
				<p className="text-sm leading-relaxed" style={{ color: theme.colors.textMain }}>
					{error.message}
				</p>

				{/* Timestamp */}
				<div className="text-xs" style={{ color: theme.colors.textDim }}>
					{new Date(error.timestamp).toLocaleTimeString()}
				</div>

				{/* Collapsible JSON Details */}
				{hasJsonDetails && (
					<div className="border rounded" style={{ borderColor: theme.colors.border }}>
						<button
							type="button"
							onClick={() => setShowJsonDetails(!showJsonDetails)}
							className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors rounded"
							style={{ color: theme.colors.textDim }}
						>
							{showJsonDetails ? (
								<ChevronDown className="w-3 h-3" />
							) : (
								<ChevronRight className="w-3 h-3" />
							)}
							<Code2 className="w-3 h-3" />
							<span>Error Details (JSON)</span>
						</button>
						{showJsonDetails && (
							<div className="px-2 pb-2">
								<CollapsibleJsonViewer
									data={error.parsedJson}
									theme={theme}
									initialExpandLevel={2}
									maxStringLength={80}
								/>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Recovery Actions - only show if there are actions */}
			{recoveryActions.length > 0 && (
				<div className="mt-6 space-y-2">
					{recoveryActions.map((action) => (
						<button
							key={action.id}
							ref={action === primaryAction ? primaryButtonRef : undefined}
							type="button"
							onClick={action.onClick}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded border transition-colors text-left ${
								action.primary ? 'hover:brightness-110' : 'hover:bg-white/5'
							}`}
							style={{
								backgroundColor: action.primary ? theme.colors.accent : 'transparent',
								borderColor: action.primary ? theme.colors.accent : theme.colors.border,
								color: action.primary ? theme.colors.accentForeground : theme.colors.textMain,
							}}
						>
							{action.icon || <RefreshCw className="w-4 h-4 shrink-0" />}
							<div className="flex-1 min-w-0">
								<div className="text-sm font-medium">{action.label}</div>
								{action.description && (
									<div
										className="text-xs mt-0.5 truncate"
										style={{
											color: action.primary
												? `${theme.colors.accentForeground}99`
												: theme.colors.textDim,
										}}
									>
										{action.description}
									</div>
								)}
							</div>
						</button>
					))}
				</div>
			)}

			{/* Dismiss option */}
			{dismissible && (
				<div
					className={recoveryActions.length > 0 ? 'mt-4 pt-4 border-t' : 'mt-6'}
					style={{ borderColor: recoveryActions.length > 0 ? theme.colors.border : undefined }}
				>
					<button
						type="button"
						onClick={onDismiss}
						className="w-full text-center text-sm py-2 rounded hover:bg-white/5 transition-colors"
						style={{ color: theme.colors.textDim }}
					>
						Dismiss
					</button>
				</div>
			)}
		</Modal>
	);
}

export default AgentErrorModal;
