/**
 * HistoryDetailModal
 *
 * Lifted from `src/renderer/components/HistoryDetailModal.tsx` as part of the
 * Layer 2.5 leaf-parade wave (693 LOC, 0 module-load IPC, 0 module-load
 * Electron-only API per pre-flight grep `grep -n "window\.maestro\|window\.electron\|ipcRenderer\|window\.api" src/renderer/components/HistoryDetailModal.tsx` → empty). The component is purely
 * presentational — every side effect (`onClose`, `onResumeSession`,
 * `onDelete`, `onUpdate`, `onNavigate`, `onFileClick`) flows through
 * caller-owned prop callbacks. Implementation is verbatim except for the
 * standard L2.5 import-path adjustments and the one strip-and-promote
 * adapt for `useSettingsStore`:
 *
 * **Import-path adapts (eight, all matching established L2.5 precedent):**
 *
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard
 *     L2.5 swap — webFull has no `types/` aggregator).
 *   - `HistoryEntry` from `'../types'` → `'../../renderer/types'` (cross-fork
 *     transitive type-only import; the renderer aggregator's
 *     `HistoryEntry` extends `BaseHistoryEntry` from `src/shared/types`
 *     with the UI-specific `achievementAction` field — keeping the import
 *     pinned to the renderer aggregator preserves source fidelity. Sibling
 *     precedent: `GroupChatPanel`, `ParticipantCard`, `SessionItem`).
 *   - `FileNode` from `'../types/fileTree'` → `'../../renderer/types/fileTree'`
 *     (cross-fork transitive type-only import; pure type, six string-typed
 *     fields, no IPC — sibling precedent: `MarkdownRenderer` lift).
 *   - `useLayerStack` from `'../contexts/LayerStackContext'` → resolved via
 *     webFull's L2.1 re-export at the same relative path
 *     `'../contexts/LayerStackContext'`.
 *   - `MODAL_PRIORITIES` from `'../constants/modalPriorities'` → webFull's
 *     re-export at the same relative path `'../constants/modalPriorities'`
 *     (per Architect 2026-06-08 audit risk A — non-divergent constants
 *     stay re-exported to prevent silent drift). Uses
 *     `MODAL_PRIORITIES.CONFIRM` (1000 — matches renderer comment "Use
 *     same priority as confirm modal").
 *   - `formatElapsedTime` from `'../utils/formatters'` → `'../../shared/formatters'`
 *     (the renderer file is a thin re-export of `src/shared/formatters`;
 *     pulling directly from shared avoids a renderer-aggregator
 *     dependency).
 *   - `stripAnsiCodes` from `'../../shared/stringUtils'` — unchanged
 *     (already a shared module).
 *   - `MarkdownRenderer` from `'./MarkdownRenderer'` — resolves via the
 *     L2.5 lifted webFull primitive at `'./MarkdownRenderer'` (lifted on
 *     branch `leaf-markdown-renderer`).
 *   - `generateTerminalProseStyles` from `'../utils/markdownConfig'` →
 *     `'../utils/terminalProseStyles'` (the SURGICAL EXTRACT of just the
 *     pure CSS generator, established as the webFull-side route by the
 *     `leaf-groupchat-messages` lift; the renderer's `markdownConfig.ts`
 *     also carries `window.maestro.shell.openExternal` calls inside
 *     `<a onClick>` JSX callbacks of `createMarkdownComponents` — runtime
 *     IPC NOT module-load IPC, but routing through the surgical extract
 *     keeps that surface area out of webFull entirely).
 *   - `calculateContextDisplay` from `'../utils/contextUsage'` →
 *     `'../../renderer/utils/contextUsage'` (cross-fork transitive
 *     import; pure utility with no IPC — only consumes ToolType and
 *     numeric usage stats, returns a `{tokens, percentage}` shape).
 *   - `getContextColor` from `'../utils/theme'` → `'../../renderer/utils/theme'`
 *     (cross-fork transitive import; pure utility that maps a percentage
 *     to a theme colour — sibling precedent: `ParticipantCard`,
 *     `SessionItem` already route through `'../../renderer/utils/theme'`).
 *   - `DoubleCheck` from `'./History'` → `'./History/historyConstants'`
 *     (the renderer source imports via the `./History/index.ts` barrel
 *     which re-exports five files; the webFull side only has the
 *     `historyConstants.tsx` re-export shim, so we import directly. The
 *     other barrel members are not needed by this component).
 *   - `safeClipboardWrite` from `'../utils/clipboard'` → `'../utils/clipboard'`
 *     (resolves via the L2.5 lifted webFull primitive that exposes the
 *     pure `navigator.clipboard.writeText` surface — the Electron-only
 *     `safeClipboardWriteImage` companion is NOT carried over).
 *
 * **Settings-store adapt (strip-and-promote-to-prop):**
 *
 *   The renderer source line 31 reads
 *   `const bionifyReadingMode = useSettingsStore((s) => s.bionifyReadingMode)`.
 *   The webFull side has no settings-store layer yet, so the hook call is
 *   stripped and `bionifyReadingMode` is promoted onto the prop surface as
 *   `bionifyReadingMode?: boolean`, defaulting to `false` — matching the
 *   renderer store's default (`SettingsState` initializes
 *   `bionifyReadingMode: false`). This matches the precedent set by
 *   `AppOverlays` (three hook strips), `GroupChatInput` (one `spellCheck`
 *   strip), and others on the leaf-parade wave. Host wiring is downstream;
 *   until a webFull settings adapter lands, callers that want non-default
 *   bionify behavior pass the prop explicitly.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift.
 *
 * Composition shape: history-entry detail modal with a custom backdrop +
 * card chrome (NOT composed over the L2.1 `Modal` primitive — the
 * renderer source registers DIRECTLY with the layer stack via
 * `useLayerStack` because the modal carries its own bespoke header (agent
 * name + session name + type pill + session ID octet + Resume button +
 * timestamp + Validated toggle), a stats panel (context usage bar + token
 * breakdown + elapsed time + cost), a scrollable markdown body with
 * prose styles, and a multi-region footer (Delete + Prev/Next nav +
 * Close). The component additionally renders an INTERNAL Delete
 * confirmation modal on top of itself when the user clicks Delete —
 * this is the bespoke chrome the parent-modal primitive doesn't model).
 * Uses `MODAL_PRIORITIES.CONFIRM` to match the layer-stack priority of
 * the renderer source.
 *
 * Keyboard surface: ArrowLeft / ArrowRight navigate prev/next entries
 * (gated by `canNavigate = filteredEntries && currentIndex !== undefined
 * && onNavigate`); Escape closes via the layer-stack `onEscape` handler.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
	X,
	Bot,
	User,
	Copy,
	Check,
	CheckCircle,
	XCircle,
	Trash2,
	Clock,
	Cpu,
	Zap,
	Play,
	ChevronLeft,
	ChevronRight,
	AlertTriangle,
} from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { HistoryEntry } from '../../renderer/types';
import type { FileNode } from '../../shared/types/fileTree';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { formatElapsedTime } from '../../shared/formatters';
import { stripAnsiCodes } from '../../shared/stringUtils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { generateTerminalProseStyles } from '../utils/terminalProseStyles';
import { calculateContextDisplay } from '../../renderer/utils/contextUsage';
import { getContextColor } from '../../renderer/utils/theme';
import { DoubleCheck } from './History/historyConstants';
import { safeClipboardWrite } from '../utils/clipboard';

interface HistoryDetailModalProps {
	theme: Theme;
	entry: HistoryEntry;
	onClose: () => void;
	onJumpToAgentSession?: (agentSessionId: string) => void;
	onResumeSession?: (agentSessionId: string) => void;
	onDelete?: (entryId: string) => void;
	onUpdate?: (entryId: string, updates: { validated?: boolean }) => Promise<boolean>;
	// Navigation props for prev/next
	filteredEntries?: HistoryEntry[];
	currentIndex?: number;
	onNavigate?: (entry: HistoryEntry, index: number) => void;
	// File linking props for markdown rendering
	fileTree?: FileNode[];
	cwd?: string;
	projectRoot?: string;
	onFileClick?: (path: string) => void;
	// Bionify reading mode flag — strip-and-promote-to-prop adapt for
	// the renderer's `useSettingsStore((s) => s.bionifyReadingMode)` at
	// source line 31. Defaults to `false` matching the renderer store's
	// initial state. Precedent: `GroupChatInput` (spellCheck),
	// `AppOverlays` (three store hooks).
	bionifyReadingMode?: boolean;
}

export function HistoryDetailModal({
	theme,
	entry,
	onClose,
	onJumpToAgentSession: _onJumpToAgentSession,
	onResumeSession,
	onDelete,
	onUpdate,
	filteredEntries,
	currentIndex,
	onNavigate,
	fileTree,
	cwd,
	projectRoot,
	onFileClick,
	bionifyReadingMode = false,
}: HistoryDetailModalProps) {
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const [copiedSessionId, setCopiedSessionId] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const deleteButtonRef = useRef<HTMLButtonElement>(null);

	// Generate prose styles for consistent markdown rendering (same as TerminalOutput)
	const proseStyles = useMemo(
		() => generateTerminalProseStyles(theme, '.history-detail-content'),
		[theme]
	);

	// Navigation state
	const canNavigate = filteredEntries && currentIndex !== undefined && onNavigate;
	const hasPrev = canNavigate && currentIndex > 0;
	const hasNext = canNavigate && currentIndex < filteredEntries.length - 1;

	// Navigation handlers
	const goToPrev = useCallback(() => {
		if (hasPrev && filteredEntries && onNavigate) {
			const newIndex = currentIndex! - 1;
			onNavigate(filteredEntries[newIndex], newIndex);
		}
	}, [hasPrev, filteredEntries, currentIndex, onNavigate]);

	const goToNext = useCallback(() => {
		if (hasNext && filteredEntries && onNavigate) {
			const newIndex = currentIndex! + 1;
			onNavigate(filteredEntries[newIndex], newIndex);
		}
	}, [hasNext, filteredEntries, currentIndex, onNavigate]);

	// Register layer on mount
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.CONFIRM, // Use same priority as confirm modal
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			onEscape: () => {
				onCloseRef.current();
			},
		});
		layerIdRef.current = id;

		return () => {
			unregisterLayer(id);
		};
	}, [registerLayer, unregisterLayer]);

	// Keep escape handler up to date
	useEffect(() => {
		updateLayerHandler(layerIdRef.current!, () => {
			onCloseRef.current();
		});
	}, [onClose, updateLayerHandler]);

	// Focus delete button when confirmation modal appears
	useEffect(() => {
		if (showDeleteConfirm && deleteButtonRef.current) {
			deleteButtonRef.current.focus();
		}
	}, [showDeleteConfirm]);

	// Keyboard navigation for prev/next with arrow keys
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't handle if delete confirmation is showing
			if (showDeleteConfirm) return;

			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				goToPrev();
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				goToNext();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [goToPrev, goToNext, showDeleteConfirm]);

	// Format timestamp
	const formatTime = (timestamp: number) => {
		const date = new Date(timestamp);
		return date.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	};

	// Get pill color based on type
	const getPillColor = () => {
		if (entry.type === 'AUTO') {
			return {
				bg: theme.colors.warning + '20',
				text: theme.colors.warning,
				border: theme.colors.warning + '40',
			};
		}
		return {
			bg: theme.colors.accent + '20',
			text: theme.colors.accent,
			border: theme.colors.accent + '40',
		};
	};

	const colors = getPillColor();
	const Icon = entry.type === 'AUTO' ? Bot : User;

	// Access agentName from unified history entries (Director's Notes)
	const agentName = (entry as HistoryEntry & { agentName?: string }).agentName;

	// For AUTO entries:
	//   - summary = short 1-2 sentence synopsis (shown in list view and toast)
	//   - fullResponse = complete synopsis with details (shown in detail view)
	// For USER entries:
	//   - summary = the synopsis text
	//   - fullResponse = may contain more context
	const rawResponse = entry.fullResponse || entry.summary || '';
	const cleanResponse = stripAnsiCodes(rawResponse);

	return (
		<div className="fixed inset-0 flex items-center justify-center z-[9999]">
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black/60" onClick={onClose} />

			{/* Modal */}
			<div
				className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border shadow-2xl flex flex-col"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
			>
				{/* Header */}
				<div
					className="relative px-6 py-4 border-b shrink-0"
					style={{ borderColor: theme.colors.border }}
				>
					{/* Close button - absolute top right */}
					<button
						onClick={onClose}
						className="absolute top-4 right-4 p-1 rounded hover:bg-white/10 transition-colors"
					>
						<X className="w-5 h-5" style={{ color: theme.colors.textDim }} />
					</button>

					<div className="flex flex-col gap-3 pr-8">
						{/* Agent Name - shown as prominent header when available (from Director's Notes) */}
						{agentName && (
							<h2
								className="text-lg font-bold truncate"
								style={{ color: theme.colors.textMain }}
								title={agentName}
							>
								{agentName}
							</h2>
						)}

						{/* Session Name - shown as header if no agent name, or as subheading if agent name is present */}
						{entry.sessionName && (
							<h2
								className={`truncate ${agentName ? 'text-sm font-medium' : 'text-lg font-bold'}`}
								style={{ color: agentName ? theme.colors.textDim : theme.colors.textMain }}
								title={entry.sessionName}
							>
								{entry.sessionName}
							</h2>
						)}

						<div className="flex items-center gap-3 flex-wrap">
							{/* Success/Failure Indicator for AUTO entries */}
							{entry.type === 'AUTO' && entry.success !== undefined && (
								<span
									className="flex items-center justify-center w-6 h-6 rounded-full"
									style={{
										backgroundColor: entry.success
											? entry.validated
												? theme.colors.success
												: theme.colors.success + '20'
											: theme.colors.error + '20',
										border: `1px solid ${
											entry.success
												? entry.validated
													? theme.colors.success
													: theme.colors.success + '40'
												: theme.colors.error + '40'
										}`,
									}}
									title={
										entry.success
											? entry.validated
												? 'Task completed successfully and human-validated'
												: 'Task completed successfully'
											: 'Task failed'
									}
								>
									{entry.success ? (
										entry.validated ? (
											<DoubleCheck className="w-4 h-4" style={{ color: '#ffffff' }} />
										) : (
											<CheckCircle className="w-4 h-4" style={{ color: theme.colors.success }} />
										)
									) : (
										<XCircle className="w-4 h-4" style={{ color: theme.colors.error }} />
									)}
								</span>
							)}

							{/* Type Pill */}
							<span
								className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
								style={{
									backgroundColor: colors.bg,
									color: colors.text,
									border: `1px solid ${colors.border}`,
								}}
							>
								<Icon className="w-2.5 h-2.5" />
								{entry.type}
							</span>

							{/* Agent Name Pill - shown inline when agentName exists but isn't already in the header */}
							{agentName && !entry.sessionName && (
								<span
									className="px-2 py-0.5 rounded-full text-[10px] font-bold truncate max-w-[200px]"
									style={{
										backgroundColor: theme.colors.bgActivity,
										color: theme.colors.textMain,
										border: `1px solid ${theme.colors.border}`,
									}}
									title={agentName}
								>
									{agentName}
								</span>
							)}

							{/* Session ID Octet - copyable */}
							{entry.agentSessionId && (
								<div className="flex items-center gap-2">
									{/* Copy button */}
									<button
										onClick={async () => {
											await safeClipboardWrite(entry.agentSessionId!);
											setCopiedSessionId(true);
											setTimeout(() => setCopiedSessionId(false), 2000);
										}}
										className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase transition-colors hover:opacity-80"
										style={{
											backgroundColor: theme.colors.accent + '20',
											color: theme.colors.accent,
											border: `1px solid ${theme.colors.accent}40`,
										}}
										title={`Copy session ID: ${entry.agentSessionId}`}
									>
										{entry.agentSessionId.split('-')[0].toUpperCase()}
										{copiedSessionId ? (
											<Check className="w-2.5 h-2.5" />
										) : (
											<Copy className="w-2.5 h-2.5" />
										)}
									</button>
									{/* Resume button - styled with same padding as other pills */}
									{onResumeSession && (
										<button
											onClick={() => {
												onResumeSession(entry.agentSessionId!);
												onClose();
											}}
											className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase transition-colors hover:opacity-80"
											style={{
												backgroundColor: theme.colors.success + '20',
												color: theme.colors.success,
												border: `1px solid ${theme.colors.success}40`,
											}}
											title={`Resume session ${entry.agentSessionId}`}
										>
											<Play className="w-2.5 h-2.5" />
											Resume
										</button>
									)}
								</div>
							)}

							{/* Timestamp */}
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{formatTime(entry.timestamp)}
							</span>

							{/* Validated toggle for AUTO entries */}
							{entry.type === 'AUTO' && entry.success && onUpdate && (
								<button
									onClick={() => onUpdate(entry.id, { validated: !entry.validated })}
									className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase transition-colors hover:opacity-80"
									style={{
										backgroundColor: entry.validated
											? theme.colors.success + '20'
											: theme.colors.bgActivity,
										color: entry.validated ? theme.colors.success : theme.colors.textDim,
										border: `1px solid ${entry.validated ? theme.colors.success + '40' : theme.colors.border}`,
									}}
									title={entry.validated ? 'Mark as not validated' : 'Mark as human-validated'}
								>
									{entry.validated ? (
										<DoubleCheck className="w-3 h-3" />
									) : (
										<Check className="w-3 h-3" />
									)}
									Validated
								</button>
							)}
						</div>
					</div>
				</div>

				{/* Stats Panel - shown when we have usage stats */}
				{(entry.usageStats || entry.elapsedTimeMs) && (
					<div
						className="px-6 py-4 border-b shrink-0"
						style={{
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.bgMain + '40',
						}}
					>
						<div className="flex items-center gap-6 flex-wrap">
							{/* Context Window Widget - calculated from usageStats */}
							{entry.usageStats && entry.usageStats.contextWindow > 0 && (
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-1.5">
										<Cpu className="w-4 h-4" style={{ color: theme.colors.textDim }} />
										<span
											className="text-[10px] font-bold uppercase"
											style={{ color: theme.colors.textDim }}
										>
											Context
										</span>
									</div>
									{(() => {
										const { tokens: contextTokens, percentage: contextUsage } =
											calculateContextDisplay(
												{
													inputTokens: entry.usageStats!.inputTokens,
													outputTokens: entry.usageStats!.outputTokens,
													cacheCreationInputTokens: entry.usageStats!.cacheCreationInputTokens ?? 0,
													cacheReadInputTokens: entry.usageStats!.cacheReadInputTokens ?? 0,
												},
												entry.usageStats!.contextWindow,
												undefined,
												entry.contextUsage
											);
										return (
											<div className="flex flex-col gap-1">
												<div className="flex items-center gap-2">
													<div
														className="w-24 h-2 rounded-full overflow-hidden"
														style={{ backgroundColor: theme.colors.border }}
													>
														<div
															className="h-full transition-all duration-500 ease-out"
															style={{
																width: `${contextUsage}%`,
																backgroundColor: getContextColor(contextUsage, theme),
															}}
														/>
													</div>
													<span
														className="text-xs font-mono font-bold"
														style={{ color: getContextColor(contextUsage, theme) }}
													>
														{contextUsage}%
													</span>
												</div>
												<span
													className="text-[10px] font-mono"
													style={{ color: theme.colors.textDim }}
												>
													{(contextTokens / 1000).toFixed(1)}k /{' '}
													{(entry.usageStats!.contextWindow / 1000).toFixed(0)}k tokens
												</span>
											</div>
										);
									})()}
								</div>
							)}

							{/* Token Breakdown - hidden on small screens for responsive design */}
							{entry.usageStats && (
								<div className="hidden sm:flex items-center gap-3">
									<div className="flex items-center gap-1.5">
										<Zap className="w-4 h-4" style={{ color: theme.colors.textDim }} />
										<span
											className="text-[10px] font-bold uppercase"
											style={{ color: theme.colors.textDim }}
										>
											Tokens
										</span>
									</div>
									<div className="flex items-center gap-3 text-xs font-mono">
										<span style={{ color: theme.colors.accent }}>
											<span style={{ color: theme.colors.textDim }}>In:</span>{' '}
											{(entry.usageStats.inputTokens ?? 0).toLocaleString('en-US')}
										</span>
										<span style={{ color: theme.colors.success }}>
											<span style={{ color: theme.colors.textDim }}>Out:</span>{' '}
											{(entry.usageStats.outputTokens ?? 0).toLocaleString('en-US')}
										</span>
									</div>
								</div>
							)}

							{/* Elapsed Time */}
							{entry.elapsedTimeMs !== undefined && (
								<div className="flex items-center gap-2">
									<Clock className="w-4 h-4" style={{ color: theme.colors.textDim }} />
									<span
										className="text-xs font-mono font-bold"
										style={{ color: theme.colors.textMain }}
									>
										{formatElapsedTime(entry.elapsedTimeMs)}
									</span>
								</div>
							)}

							{/* Cost */}
							{entry.usageStats && entry.usageStats.totalCostUsd > 0 && (
								<span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full border border-green-500/30 text-green-500 bg-green-500/10">
									${entry.usageStats.totalCostUsd.toFixed(2)}
								</span>
							)}
						</div>
					</div>
				)}

				{/* Content - with prose styles for consistent markdown rendering */}
				<div
					className="history-detail-content flex-1 overflow-y-auto px-6 py-5 scrollbar-thin"
					style={{ color: theme.colors.textMain }}
				>
					<style>{proseStyles}</style>
					<MarkdownRenderer
						content={cleanResponse}
						theme={theme}
						onCopy={(text) => safeClipboardWrite(text)}
						fileTree={fileTree}
						cwd={cwd}
						projectRoot={projectRoot}
						onFileClick={onFileClick}
						enableBionifyReadingMode={bionifyReadingMode}
					/>
				</div>

				{/* Footer */}
				<div
					className="flex items-center justify-between px-6 py-4 border-t shrink-0"
					style={{ borderColor: theme.colors.border }}
				>
					{/* Delete button - only shown when onDelete handler is provided */}
					{onDelete ? (
						<button
							onClick={() => setShowDeleteConfirm(true)}
							className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors hover:opacity-90"
							style={{
								backgroundColor: theme.colors.error + '20',
								color: theme.colors.error,
								border: `1px solid ${theme.colors.error}40`,
							}}
							title="Delete this history entry"
						>
							<Trash2 className="w-4 h-4" />
							Delete
						</button>
					) : (
						<div />
					)}

					{/* Prev/Next navigation buttons - centered */}
					{canNavigate && (
						<div className="flex items-center gap-3">
							<button
								onClick={goToPrev}
								disabled={!hasPrev}
								className="flex items-center gap-1 px-3 py-2 rounded text-sm font-medium transition-colors"
								style={{
									backgroundColor: hasPrev ? theme.colors.bgActivity : 'transparent',
									color: hasPrev ? theme.colors.textMain : theme.colors.textDim,
									border: `1px solid ${hasPrev ? theme.colors.border : theme.colors.border + '40'}`,
									opacity: hasPrev ? 1 : 0.4,
									cursor: hasPrev ? 'pointer' : 'default',
								}}
								title={hasPrev ? 'Previous entry (←)' : 'No previous entry'}
							>
								<ChevronLeft className="w-4 h-4" />
								Prev
							</button>
							<button
								onClick={goToNext}
								disabled={!hasNext}
								className="flex items-center gap-1 px-3 py-2 rounded text-sm font-medium transition-colors"
								style={{
									backgroundColor: hasNext ? theme.colors.bgActivity : 'transparent',
									color: hasNext ? theme.colors.textMain : theme.colors.textDim,
									border: `1px solid ${hasNext ? theme.colors.border : theme.colors.border + '40'}`,
									opacity: hasNext ? 1 : 0.4,
									cursor: hasNext ? 'pointer' : 'default',
								}}
								title={hasNext ? 'Next entry (→)' : 'No next entry'}
							>
								Next
								<ChevronRight className="w-4 h-4" />
							</button>
						</div>
					)}

					<button
						onClick={onClose}
						className="px-4 py-2 rounded text-sm font-medium transition-colors hover:opacity-90"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						Close
					</button>
				</div>
			</div>

			{/* Delete Confirmation Modal */}
			{showDeleteConfirm && (
				<div
					className="fixed inset-0 flex items-center justify-center z-[10001]"
					onClick={() => setShowDeleteConfirm(false)}
				>
					<div className="absolute inset-0 bg-black/60" />
					<div
						className="relative w-[400px] border rounded-lg shadow-2xl overflow-hidden"
						style={{
							backgroundColor: theme.colors.bgSidebar,
							borderColor: theme.colors.border,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<div
							className="p-4 border-b flex items-center justify-between"
							style={{ borderColor: theme.colors.border }}
						>
							<div className="flex items-center gap-2">
								<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />
								<h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
									Delete History Entry
								</h2>
							</div>
							<button
								onClick={() => setShowDeleteConfirm(false)}
								style={{ color: theme.colors.textDim }}
							>
								<X className="w-4 h-4" />
							</button>
						</div>
						<div className="p-6">
							<div className="flex gap-4">
								<div
									className="flex-shrink-0 p-2 rounded-full h-fit"
									style={{ backgroundColor: `${theme.colors.error}20` }}
								>
									<AlertTriangle className="w-5 h-5" style={{ color: theme.colors.error }} />
								</div>
								<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
									Are you sure you want to delete this {entry.type === 'AUTO' ? 'auto' : 'user'}{' '}
									history entry? This action cannot be undone.
								</p>
							</div>
							<div className="mt-6 flex justify-end gap-2">
								<button
									onClick={() => setShowDeleteConfirm(false)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.stopPropagation();
											setShowDeleteConfirm(false);
										}
									}}
									className="px-4 py-2 rounded border hover:bg-white/5 transition-colors"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								>
									Cancel
								</button>
								<button
									ref={deleteButtonRef}
									onClick={() => {
										if (onDelete) {
											onDelete(entry.id);
										}
										setShowDeleteConfirm(false);
										onClose();
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.stopPropagation();
											if (onDelete) {
												onDelete(entry.id);
											}
											setShowDeleteConfirm(false);
											onClose();
										}
									}}
									className="px-4 py-2 rounded text-white outline-none focus:ring-2 focus:ring-offset-2"
									style={{ backgroundColor: theme.colors.error }}
									tabIndex={0}
								>
									Delete
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
