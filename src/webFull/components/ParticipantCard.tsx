/**
 * ParticipantCard.tsx — webFull lift
 *
 * Layer 2.5 leaf-parade lift. Verbatim port of
 * `src/renderer/components/ParticipantCard.tsx` (371 LOC, 0 IPC, 0
 * Electron-only API) into the webFull tree. Renders a single group-chat
 * participant row: status dot, name, optional SSH pill, session-ID pill,
 * message-count + last-activity stats, agent-type tag, a context-usage
 * gauge, and an optional cost pill alongside Reset / Remove / Peek action
 * buttons. Owns five pieces of local UI state (`copied`, `isResetting`,
 * `isRemoving`, `confirmRemove`, `peekOpen`) and exactly one DOM ref
 * (`peekRef`) used for auto-scroll-to-bottom of the live-output peek
 * panel. All side effects (reset, remove, clipboard copy) are threaded
 * out via props or routed through the cross-fork browser-API helper
 * `safeClipboardWrite`.
 *
 * **Import-path adapts** (matching the L2.5 cross-fork precedent set by
 * `GroupChatMessages`, `MarkdownRenderer`, `ShortcutsHelpModal`,
 * `CollapsibleJsonViewer`):
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'`.
 *   - `GroupChatParticipant` from `'../types'` → `'../../shared/group-chat-types'`.
 *   - `SessionState` from `'../types'` → `'../../renderer/types'`
 *     (accepted transitive renderer-type surface; matches the
 *     `GroupChatHeader` / `GroupChatPanel` / `ShortcutsHelpModal` pattern).
 *   - `getStatusColor` from `'../utils/theme'` → `'../../renderer/utils/theme'`
 *     (pure renderer helper; cross-fork import accepted, same shape as
 *     the `safeClipboardWrite` / `stripMarkdown` / `getSyntaxStyle`
 *     cross-fork imports used by other L2.5 lifts).
 *   - `formatCost` from `'../utils/formatters'` → `'../../shared/formatters'`
 *     (the renderer formatter is itself a re-export shim over shared;
 *     this import bypasses the shim and goes direct to source, matching
 *     the L2.5 `mobile/SessionStatusBanner` pattern).
 *   - `safeClipboardWrite` from `'../utils/clipboard'` →
 *     `'../../renderer/utils/clipboard'` (browser-API only —
 *     `navigator.clipboard.writeText` — same import shape used by
 *     `GroupChatMessages.tsx`, `CollapsibleJsonViewer.tsx`,
 *     `AgentErrorModal.tsx`).
 *
 * **What's IN this lift:** the component body is verbatim. Every prop
 * the renderer source accepts is preserved (`theme`, `participant`,
 * `state`, `color`, `groupChatId`, `onContextReset`, `onRemove`,
 * `liveOutput`). All five local-state behaviors render identically:
 *   - status dot pulses for busy/connecting, solid for idle/error;
 *   - SSH-remote pill rendered only when `participant.sshRemoteName`
 *     is set;
 *   - session-ID pill shows `pending` placeholder when
 *     `participant.agentSessionId` is unset, otherwise a clickable
 *     copy-to-clipboard pill showing the first 8 chars in uppercase
 *     with a Copy/Check icon swap on success;
 *   - context gauge fills 0-100% with accent below 80% and warning at
 *     or above 80%;
 *   - reset/remove buttons gate behind both the corresponding callback
 *     prop AND `groupChatId` being truthy; remove has a two-step confirm
 *     flow (Confirm / Cancel buttons), then a transient `Removing...`
 *     pulse during the async callback;
 *   - peek panel auto-scrolls to the bottom on every `liveOutput` mutation
 *     while open, clamps display to the trailing 4096 characters of the
 *     live output, and falls back to `(no live output yet)` when no
 *     output has arrived.
 *
 * **What's OUT:** nothing — the renderer source has no Electron-only
 * branches to strip. `safeClipboardWrite` is browser-native; the only
 * external module-level dependencies are React, `lucide-react`, the
 * shared types, the renderer types (`SessionState`), and the three pure
 * helpers above. No `window.maestro`, no Electron `shell`, no IPC, no
 * direct DOM globals beyond standard browser surface.
 *
 * Source oracle: `src/renderer/components/ParticipantCard.tsx`.
 * Catalog: `src/webFull/components/ParticipantCard.parity.test.ts`.
 * Closes: ISC-44.layer-2.5.participant_card.
 */

import {
	MessageSquare,
	Copy,
	Check,
	DollarSign,
	RotateCcw,
	Server,
	UserMinus,
	Eye,
	EyeOff,
} from 'lucide-react';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { GroupChatParticipant } from '../../shared/group-chat-types';
import type { SessionState } from '../../renderer/types';
import { getStatusColor } from '../../renderer/utils/theme';
import { formatCost } from '../../shared/formatters';
import { safeClipboardWrite } from '../../renderer/utils/clipboard';

interface ParticipantCardProps {
	theme: Theme;
	participant: GroupChatParticipant;
	state: SessionState;
	color?: string;
	groupChatId?: string;
	onContextReset?: (participantName: string) => void;
	onRemove?: (participantName: string) => void;
	liveOutput?: string;
}

/**
 * Format time as relative or absolute.
 */
function formatTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	if (diff < 60000) return 'just now';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ParticipantCard({
	theme,
	participant,
	state,
	color,
	groupChatId,
	onContextReset,
	onRemove,
	liveOutput,
}: ParticipantCardProps): JSX.Element {
	const [copied, setCopied] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [isRemoving, setIsRemoving] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [peekOpen, setPeekOpen] = useState(false);
	const peekRef = useRef<HTMLPreElement>(null);

	// Auto-scroll peek output to bottom
	useEffect(() => {
		if (peekOpen && peekRef.current) {
			peekRef.current.scrollTop = peekRef.current.scrollHeight;
		}
	}, [peekOpen, liveOutput]);

	// Use agent's session ID (clean GUID) when available, otherwise show pending
	const agentSessionId = participant.agentSessionId;
	const isPending = !agentSessionId;

	const copySessionId = useCallback(async (sessionId: string) => {
		await safeClipboardWrite(sessionId);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, []);

	// Determine if state should animate (busy or connecting)
	const shouldPulse = state === 'busy' || state === 'connecting';

	const getStatusLabel = (): string => {
		switch (state) {
			case 'busy':
				return 'Working';
			case 'error':
				return 'Error';
			case 'connecting':
				return 'Connecting';
			default:
				return 'Idle';
		}
	};

	// Context usage percentage (default to 0 if not set)
	const contextUsage = participant.contextUsage ?? 0;

	// Always show reset button (useful for disconnected sessions, not just high context)
	const showResetButton = onContextReset && groupChatId && !isResetting;

	const handleReset = useCallback(
		async (resetContext: (participantName: string) => void | Promise<void>) => {
			setIsResetting(true);
			try {
				await resetContext(participant.name);
			} finally {
				setIsResetting(false);
			}
		},
		[participant.name]
	);

	const handleRemove = useCallback(
		async (removeParticipant: (participantName: string) => void | Promise<void>) => {
			setIsRemoving(true);
			try {
				await removeParticipant(participant.name);
			} finally {
				setIsRemoving(false);
				setConfirmRemove(false);
			}
		},
		[participant.name]
	);

	const showRemoveButton = onRemove && groupChatId && !isRemoving;

	return (
		<div
			className="rounded-lg border p-3"
			style={{
				backgroundColor: theme.colors.bgMain,
				borderColor: theme.colors.border,
				borderLeftWidth: '3px',
				borderLeftColor: color || theme.colors.accent,
			}}
		>
			{/* Row 1: status dot + name (full width) */}
			<div className="flex items-center gap-2">
				<div
					className={`w-2 h-2 rounded-full shrink-0 ${shouldPulse ? 'animate-pulse' : ''}`}
					style={{ backgroundColor: getStatusColor(state, theme) }}
					title={getStatusLabel()}
				/>
				<span className="font-medium" style={{ color: color || theme.colors.textMain }}>
					{participant.name}
				</span>
			</div>

			{/* Row 2: Pills row - SSH pill + session ID pill */}
			<div className="flex items-center gap-2 mt-1.5 flex-wrap">
				{/* SSH Remote pill - shown when running on SSH remote */}
				{participant.sshRemoteName && (
					<span
						className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full shrink-0 border border-purple-500/30 text-purple-500 bg-purple-500/10"
						title={`SSH Remote: ${participant.sshRemoteName}`}
					>
						<Server className="w-2.5 h-2.5 shrink-0" />
						<span className="uppercase">{participant.sshRemoteName}</span>
					</span>
				)}
				{/* Session ID pill */}
				{isPending ? (
					<span
						className="text-[10px] px-2 py-0.5 rounded-full shrink-0 italic"
						style={{
							backgroundColor: `${theme.colors.textDim}20`,
							color: theme.colors.textDim,
							border: `1px solid ${theme.colors.textDim}40`,
						}}
					>
						pending
					</span>
				) : (
					<button
						onClick={() => copySessionId(agentSessionId)}
						className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity cursor-pointer shrink-0"
						style={{
							backgroundColor: `${theme.colors.accent}20`,
							color: theme.colors.accent,
							border: `1px solid ${theme.colors.accent}40`,
						}}
						title={`Session: ${agentSessionId}\nClick to copy`}
					>
						<span className="font-mono">{agentSessionId.slice(0, 8).toUpperCase()}</span>
						{copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
					</button>
				)}
			</div>

			{/* Stats row: message count + last time (left), agent type (right) */}
			<div
				className="text-xs mt-1 flex items-center justify-between"
				style={{ color: theme.colors.textDim }}
			>
				<div className="flex items-center gap-2">
					{participant.messageCount !== undefined && participant.messageCount > 0 && (
						<span className="flex items-center gap-1" title="Messages sent">
							<MessageSquare className="w-3 h-3" />
							{participant.messageCount}
						</span>
					)}
					{participant.lastActivity && (
						<span title="Last activity">{formatTime(participant.lastActivity)}</span>
					)}
				</div>
				<span>{participant.agentId}</span>
			</div>

			{/* Context gauge + optional cost */}
			<div className="mt-2 flex items-center gap-2">
				<div className="flex-1">
					<div className="flex items-center justify-between mb-1">
						<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
							Context
						</span>
						<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
							{contextUsage}%
						</span>
					</div>
					<div
						className="h-1 rounded-full overflow-hidden"
						style={{ backgroundColor: theme.colors.border }}
					>
						<div
							className="h-full rounded-full transition-all"
							style={{
								width: `${contextUsage}%`,
								backgroundColor: contextUsage > 80 ? theme.colors.warning : theme.colors.accent,
							}}
						/>
					</div>
				</div>
				{/* Cost pill (optional) */}
				{participant.totalCost !== undefined && participant.totalCost > 0 && (
					<span
						className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0"
						style={{
							backgroundColor: `${theme.colors.success}20`,
							color: theme.colors.success,
						}}
						title="Total cost"
					>
						<DollarSign className="w-3 h-3" />
						{formatCost(participant.totalCost).slice(1)}
					</span>
				)}
				{/* Reset button */}
				{showResetButton && (
					<button
						onClick={() => handleReset(onContextReset)}
						className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
						style={{
							backgroundColor: `${theme.colors.warning}20`,
							color: theme.colors.warning,
							border: `1px solid ${theme.colors.warning}40`,
						}}
						title="Reset context: Summarize current session and start fresh"
					>
						<RotateCcw className="w-3 h-3" />
						Reset
					</button>
				)}
				{/* Reset in progress indicator */}
				{isResetting && (
					<span
						className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0 animate-pulse"
						style={{
							backgroundColor: `${theme.colors.warning}20`,
							color: theme.colors.warning,
						}}
					>
						<RotateCcw className="w-3 h-3 animate-spin" />
						Resetting...
					</span>
				)}
				{/* Remove button */}
				{showRemoveButton && !confirmRemove && (
					<button
						onClick={() => setConfirmRemove(true)}
						className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
						style={{
							backgroundColor: `${theme.colors.error}20`,
							color: theme.colors.error,
							border: `1px solid ${theme.colors.error}40`,
						}}
						title="Remove participant from group chat"
					>
						<UserMinus className="w-3 h-3" />
						Remove
					</button>
				)}
				{/* Remove confirmation */}
				{confirmRemove && !isRemoving && onRemove && groupChatId && (
					<span className="flex items-center gap-1 text-[10px] shrink-0">
						<button
							onClick={() => handleRemove(onRemove)}
							className="px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
							style={{
								backgroundColor: `${theme.colors.error}30`,
								color: theme.colors.error,
								border: `1px solid ${theme.colors.error}60`,
							}}
						>
							Confirm
						</button>
						<button
							onClick={() => setConfirmRemove(false)}
							className="px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
							style={{
								backgroundColor: `${theme.colors.textDim}20`,
								color: theme.colors.textDim,
							}}
						>
							Cancel
						</button>
					</span>
				)}
				{/* Remove in progress indicator */}
				{isRemoving && (
					<span
						className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0 animate-pulse"
						style={{
							backgroundColor: `${theme.colors.error}20`,
							color: theme.colors.error,
						}}
					>
						<UserMinus className="w-3 h-3" />
						Removing...
					</span>
				)}
				{/* Peek button - always visible */}
				<button
					onClick={() => setPeekOpen((v) => !v)}
					className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
					style={{
						backgroundColor: peekOpen ? `${theme.colors.accent}25` : `${theme.colors.accent}10`,
						color: peekOpen ? theme.colors.accent : theme.colors.textDim,
						border: `1px solid ${peekOpen ? theme.colors.accent + '60' : theme.colors.border}`,
					}}
					title="Peek at live output"
				>
					{peekOpen ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
					Peek
				</button>
			</div>

			{/* Live output peek panel */}
			{peekOpen && (
				<pre
					ref={peekRef}
					className="mt-2 text-[10px] leading-tight rounded p-2 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-mono"
					style={{
						maxHeight: '200px',
						backgroundColor: `${theme.colors.bgMain}80`,
						color: theme.colors.textDim,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					{liveOutput
						? liveOutput.length > 4096
							? liveOutput.slice(-4096)
							: liveOutput
						: '(no live output yet)'}
				</pre>
			)}
		</div>
	);
}
