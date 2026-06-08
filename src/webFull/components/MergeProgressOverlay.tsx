/**
 * MergeProgressOverlay
 *
 * Lifted verbatim from `src/renderer/components/MergeProgressOverlay.tsx`
 * (339 LOC, 0 IPC, 0 Electron-only API per pre-flight grep) as part of the
 * Layer 2.5 leaf-parade wave. Non-blocking inline progress indicator that
 * replaces the input area for a single AI tab while a context merge is in
 * flight. Unlike the modal-shape merge surface, this overlay is per-tab —
 * the user can keep working in other tabs while the merge runs in the
 * background. Shape: a bordered card containing a spinner/check/warning
 * head icon, a status title row (with elapsed-time chip and cancel
 * affordance), an animated progress bar, the four-stage indicator row
 * (`collecting` → `grooming` → `creating` → `complete`), an error message
 * row (on `MergeResult.success === false`), an end-of-run completion stats
 * row (when `tokensSaved > 0`), and an inline cancel-confirmation card
 * gated by `showCancelConfirm` state.
 *
 * Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer" src/renderer/components/MergeProgressOverlay.tsx`
 * returned empty (exit 1). The component touches none of the banned surface;
 * all side effects flow through the `onCancel` prop callback.
 *
 * Lift policy: verbatim copy of the body with two import-path adjustments
 * matching the L2.5 precedent (`PlaybookDeleteConfirmModal`,
 * `ContextWarningSash`, `GitStatusWidget`, etc.):
 *
 * 1. `Theme` from `'../types'` → `'../../shared/theme-types'`. Renderer
 *    routes through `src/renderer/types/index.ts` which re-exports the
 *    canonical type from `src/shared/theme-types`; webFull imports the
 *    canonical type directly to avoid a silent-drift surface.
 *
 * 2. `GroomingProgress` and `MergeResult` from `'../types/contextMerge'` →
 *    `'../../renderer/types/contextMerge'`. These types form the
 *    progress-stage + merge-result vocabulary the lifted component renders.
 *    The renderer-side `contextMerge.ts` is itself dependency-clean as far
 *    as the two types this component consumes — `GroomingProgress` is
 *    `{ stage: 'collecting' | 'grooming' | 'creating' | 'complete';
 *    progress: number; message: string }` (pure), and `MergeResult` is a
 *    flat shape of optional primitives + `LogEntry[]`. The lifted module
 *    reads only `MergeResult.success`, `MergeResult.error`, and
 *    `MergeResult.tokensSaved` (three primitive fields). Pulling the types
 *    via cross-fork import follows the established L2.5 precedent
 *    (`GroupChatHeader`, `ShortcutsHelpModal`, etc. import renderer types
 *    directly rather than copying the type modules into the webFull tree,
 *    which would create the silent-drift surface audit risk A explicitly
 *    warns against). When/if a future port consolidates the context-merge
 *    type surface into `src/shared/`, this import line flips with a single
 *    sed; until then the renderer aggregator stays canonical.
 *
 * Theme access pattern: kept the renderer's `theme: Theme` prop convention,
 * consistent with every L2.1 / L2.3 / L2.4 / L2.5 lift. Callers in webFull
 * call `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * Composition shape: no `Modal` / `ModalFooter` / layer-stack registration —
 * this is an inline replacement for the input area, NOT a modal overlay.
 * The cancel-confirmation it gates is a bare `absolute inset-0` overlay
 * scoped to the card (verbatim from the renderer source); future plumbing
 * could re-port the confirmation onto the L2.1 `Modal` primitive if the
 * chrome ever converges, but that's out of scope per the verbatim-lift
 * rule.
 *
 * `lucide-react` icons (`X`, `Check`, `Loader2`, `AlertTriangle`,
 * `GitMerge`) kept verbatim — already a webFull-tree dep used by sibling
 * L2.5 lifts.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. 0 `src/main/`
 * touches. 0 `src/renderer/` edits. 0 `src/web/` edits. 0 `src/server/`
 * edits.
 */

import { useState, useEffect, memo, useCallback } from 'react';
import { X, Check, Loader2, AlertTriangle, GitMerge } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { GroomingProgress, MergeResult } from '../../renderer/types/contextMerge';

/**
 * Progress stage definition for display
 */
interface ProgressStage {
	id: GroomingProgress['stage'];
	label: string;
	activeLabel: string;
}

/**
 * Stage definitions with their display labels
 */
const STAGES: ProgressStage[] = [
	{ id: 'collecting', label: 'Collect contexts', activeLabel: 'Collecting contexts...' },
	{ id: 'grooming', label: 'Groom with AI', activeLabel: 'Grooming with AI...' },
	{ id: 'creating', label: 'Add to session', activeLabel: 'Adding to session...' },
	{ id: 'complete', label: 'Complete', activeLabel: 'Complete' },
];

export interface MergeProgressOverlayProps {
	theme: Theme;
	progress: GroomingProgress | null;
	result: MergeResult | null;
	sourceName?: string;
	targetName?: string;
	onCancel: () => void;
	startTime: number;
}

/**
 * Format milliseconds as a readable time string
 */
function formatElapsedTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	if (minutes > 0) {
		return `${minutes}m ${remainingSeconds}s`;
	}
	return `${remainingSeconds}s`;
}

/**
 * Elapsed time display component with auto-updating timer
 */
const ElapsedTimeDisplay = memo(
	({ startTime, textColor }: { startTime: number; textColor: string }) => {
		const [elapsedMs, setElapsedMs] = useState(Date.now() - startTime);

		useEffect(() => {
			const interval = setInterval(() => {
				setElapsedMs(Date.now() - startTime);
			}, 1000);
			return () => clearInterval(interval);
		}, [startTime]);

		return (
			<span className="font-mono text-xs" style={{ color: textColor }}>
				{formatElapsedTime(elapsedMs)}
			</span>
		);
	}
);

ElapsedTimeDisplay.displayName = 'ElapsedTimeDisplay';

/**
 * MergeProgressOverlay Component
 *
 * Displays inline in the input area when a merge is active for this tab
 */
export const MergeProgressOverlay = memo(function MergeProgressOverlay({
	theme,
	progress,
	result,
	sourceName,
	targetName,
	onCancel,
	startTime,
}: MergeProgressOverlayProps) {
	const [showCancelConfirm, setShowCancelConfirm] = useState(false);

	const handleCancelClick = useCallback(() => {
		if (showCancelConfirm) {
			onCancel();
			setShowCancelConfirm(false);
		} else {
			setShowCancelConfirm(true);
		}
	}, [showCancelConfirm, onCancel]);

	const handleDismissCancel = useCallback(() => {
		setShowCancelConfirm(false);
	}, []);

	// Get the current stage index
	const currentStageIndex = progress ? STAGES.findIndex((s) => s.id === progress.stage) : 0;

	const isComplete = progress?.stage === 'complete';
	const progressValue = progress?.progress ?? 0;
	const hasError = result && !result.success && result.error;

	// Build title text
	const titleText = hasError
		? 'Merge Failed'
		: isComplete
			? 'Contexts Merged'
			: sourceName && targetName
				? `Merging "${sourceName}" into "${targetName}"...`
				: 'Merging Contexts...';

	return (
		<div
			className="relative p-4 border-t"
			style={{
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.bgSidebar,
			}}
		>
			<div
				className="rounded-lg border p-4"
				style={{
					backgroundColor: theme.colors.bgMain,
					borderColor: hasError ? theme.colors.error : theme.colors.accent,
				}}
			>
				{/* Cancel Confirmation Overlay */}
				{showCancelConfirm && (
					<div
						className="absolute inset-0 flex items-center justify-center z-10 rounded-lg"
						style={{ backgroundColor: `${theme.colors.bgMain}ee` }}
					>
						<div
							className="p-4 rounded-lg border shadow-lg max-w-xs"
							style={{
								backgroundColor: theme.colors.bgSidebar,
								borderColor: theme.colors.border,
							}}
						>
							<div className="flex items-center gap-2 mb-3">
								<AlertTriangle className="w-4 h-4" style={{ color: theme.colors.warning }} />
								<span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
									Cancel Merge?
								</span>
							</div>
							<p className="text-xs mb-3" style={{ color: theme.colors.textDim }}>
								This will abort the merge operation and discard progress.
							</p>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									onClick={handleDismissCancel}
									className="px-2 py-1 rounded text-xs border hover:bg-white/5 transition-colors"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								>
									Continue
								</button>
								<button
									type="button"
									onClick={onCancel}
									className="px-2 py-1 rounded text-xs font-medium transition-colors"
									style={{
										backgroundColor: theme.colors.error,
										color: '#fff',
									}}
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
				)}

				<div className="flex items-start gap-4">
					{/* Spinner or icon */}
					<div className="flex-shrink-0">
						{isComplete ? (
							<div
								className="w-8 h-8 rounded-full flex items-center justify-center"
								style={{ backgroundColor: `${theme.colors.success}20` }}
							>
								<Check className="w-4 h-4" style={{ color: theme.colors.success }} />
							</div>
						) : hasError ? (
							<div
								className="w-8 h-8 rounded-full flex items-center justify-center"
								style={{ backgroundColor: `${theme.colors.error}20` }}
							>
								<AlertTriangle className="w-4 h-4" style={{ color: theme.colors.error }} />
							</div>
						) : (
							<div className="relative w-8 h-8">
								<div
									className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
									style={{
										borderColor: theme.colors.border,
										borderTopColor: theme.colors.accent,
									}}
								/>
								<div className="absolute inset-0 flex items-center justify-center">
									<GitMerge className="w-3.5 h-3.5" style={{ color: theme.colors.accent }} />
								</div>
							</div>
						)}
					</div>

					{/* Content */}
					<div className="flex-1 min-w-0">
						{/* Header with status and elapsed time */}
						<div className="flex items-center justify-between mb-2">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
									{titleText}
								</span>
								{!isComplete && !hasError && (
									<ElapsedTimeDisplay startTime={startTime} textColor={theme.colors.textDim} />
								)}
							</div>
							{!isComplete && (
								<button
									type="button"
									onClick={handleCancelClick}
									className="p-1 rounded hover:bg-white/10 transition-colors"
									style={{ color: theme.colors.textDim }}
									title="Cancel"
								>
									<X className="w-4 h-4" />
								</button>
							)}
						</div>

						{/* Error message */}
						{hasError && (
							<p className="text-xs mb-2" style={{ color: theme.colors.error }}>
								{result.error}
							</p>
						)}

						{/* Progress bar */}
						{!hasError && (
							<div className="mb-2">
								<div
									className="h-1.5 rounded-full overflow-hidden"
									style={{ backgroundColor: theme.colors.bgSidebar }}
								>
									<div
										className="h-full rounded-full transition-all duration-300 ease-out"
										style={{
											width: `${progressValue}%`,
											backgroundColor: isComplete ? theme.colors.success : theme.colors.accent,
										}}
									/>
								</div>
							</div>
						)}

						{/* Stage indicators */}
						{!hasError && (
							<div className="flex items-center gap-3 flex-wrap">
								{STAGES.map((stage, index) => {
									const isActive = index === currentStageIndex;
									const isCompleted = index < currentStageIndex;

									return (
										<div key={stage.id} className="flex items-center gap-1">
											{isCompleted ? (
												<Check className="w-3 h-3" style={{ color: theme.colors.success }} />
											) : isActive ? (
												<Loader2
													className="w-3 h-3 animate-spin"
													style={{ color: theme.colors.accent }}
												/>
											) : (
												<div
													className="w-3 h-3 rounded-full border"
													style={{ borderColor: theme.colors.border }}
												/>
											)}
											<span
												className="text-[10px]"
												style={{
													color: isActive
														? theme.colors.textMain
														: isCompleted
															? theme.colors.success
															: theme.colors.textDim,
													fontWeight: isActive ? 500 : 400,
												}}
											>
												{stage.label}
											</span>
										</div>
									);
								})}
							</div>
						)}

						{/* Completion stats */}
						{isComplete &&
							result &&
							result.success &&
							result.tokensSaved !== undefined &&
							result.tokensSaved > 0 && (
								<div className="mt-2 text-xs" style={{ color: theme.colors.success }}>
									Saved ~{result.tokensSaved.toLocaleString()} tokens through deduplication
								</div>
							)}
					</div>
				</div>
			</div>
		</div>
	);
});

export default MergeProgressOverlay;
