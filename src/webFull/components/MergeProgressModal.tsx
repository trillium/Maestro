/**
 * MergeProgressModal
 *
 * Lifted verbatim from `src/renderer/components/MergeProgressModal.tsx`
 * (455 LOC, 0 IPC, 0 Electron-only API per pre-flight grep) as part of the
 * Layer 2.5 leaf-parade wave. Direct sibling of `MergeProgressOverlay`
 * (already lifted) but in the modal shape: a centered, blocking
 * `role="dialog"` surface with focus trap, layer-stack registration, and an
 * Escape-handler that shows a cancel-confirmation sub-overlay. Surfaces a
 * centered Wand2 spinner head, a status title row (with elapsed-time chip),
 * an animated progress bar with percentage, a four-stage vertical
 * indicator list (`collecting` → `grooming` → `creating` → `complete`),
 * and a footer Cancel/Done button that flips style on completion.
 *
 * Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer" src/renderer/components/MergeProgressModal.tsx`
 * returned empty (exit 1). The component touches none of the banned surface;
 * all side effects flow through the `onCancel` prop callback.
 *
 * Lift policy: verbatim copy of the body with the standard L2.5 import-path
 * adjustments matching the sibling `MergeProgressOverlay` lift and
 * `AgentPromptComposerModal` precedent:
 *
 * 1. `Theme` from `'../types'` → `'../../shared/theme-types'`. Renderer
 *    routes through `src/renderer/types/index.ts` which re-exports the
 *    canonical type from `src/shared/theme-types`; webFull imports the
 *    canonical type directly to avoid a silent-drift surface (audit risk A).
 *
 * 2. `GroomingProgress` from `'../types/contextMerge'` →
 *    `'../../renderer/types/contextMerge'`. The renderer-side aggregator is
 *    dependency-clean for this type — `GroomingProgress` is `{ stage:
 *    'collecting' | 'grooming' | 'creating' | 'complete'; progress: number;
 *    message: string }` (pure discriminated union + primitives). Pulling
 *    via cross-fork import matches the sibling `MergeProgressOverlay` /
 *    `SummarizeProgressOverlay` precedent (audit risk A: no duplicate type
 *    modules into webFull).
 *
 * 3. `useLayerStack` from `'../contexts/LayerStackContext'` →
 *    `'../contexts/LayerStackContext'` (resolves to the L2.1 webFull
 *    re-export at `src/webFull/contexts/LayerStackContext.tsx`).
 *
 * 4. `MODAL_PRIORITIES` resolves via the webFull re-export at
 *    `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08
 *    audit risk A — non-divergent constants stay re-exported from renderer
 *    to prevent silent drift). Uses `MODAL_PRIORITIES.MERGE_PROGRESS` (684).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with every L2.1 / L2.3 / L2.4 / L2.5 lift. Callers in webFull
 * call `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * Composition shape: full-viewport blocking modal with layer-stack focus
 * trap. Not a composition of the L2.1 `Modal` primitive — the renderer
 * source pre-dates the L2.1 shared-modal extraction and renders its own
 * 450px-wide centered dialog with custom header/footer chrome and an
 * absolute-positioned cancel-confirmation sub-overlay. Lift is verbatim to
 * preserve behavioral parity (Escape → cancel-confirmation when active,
 * Escape → close when complete, layer-stack registration with strict focus
 * trap, MERGE_PROGRESS priority).
 *
 * `lucide-react` icons (`X`, `Check`, `Loader2`, `AlertTriangle`, `Wand2`)
 * kept verbatim — already a webFull-tree dep used by sibling L2.5 lifts.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. 0 `src/main/`
 * touches. 0 `src/renderer/` edits. 0 `src/web/` edits. 0 `src/server/`
 * edits.
 */

import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { X, Check, Loader2, AlertTriangle, Wand2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { GroomingProgress } from '../../renderer/types/contextMerge';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

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

export interface MergeProgressModalProps {
	theme: Theme;
	isOpen: boolean;
	progress: GroomingProgress;
	/** Name of the source session/tab being merged from */
	sourceName?: string;
	/** Name of the target session being merged into */
	targetName?: string;
	onCancel: () => void;
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
 * Animated spinner component
 */
function Spinner({ theme }: { theme: Theme }) {
	return (
		<div className="relative">
			<div
				className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
				style={{
					borderColor: theme.colors.border,
					borderTopColor: theme.colors.accent,
				}}
			/>
			{/* Wand icon in center */}
			<div className="absolute inset-0 flex items-center justify-center">
				<Wand2 className="w-5 h-5" style={{ color: theme.colors.accent }} />
			</div>
		</div>
	);
}

/**
 * Cancel confirmation dialog
 */
function CancelConfirmDialog({
	theme,
	onConfirm,
	onCancel,
}: {
	theme: Theme;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div
			className="absolute inset-0 flex items-center justify-center z-10"
			style={{ backgroundColor: `${theme.colors.bgMain}ee` }}
		>
			<div
				className="p-6 rounded-xl border shadow-xl max-w-sm"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
			>
				<div className="flex items-center gap-3 mb-4">
					<AlertTriangle className="w-5 h-5" style={{ color: theme.colors.warning }} />
					<h3 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
						Cancel Merge?
					</h3>
				</div>
				<p className="text-xs mb-4" style={{ color: theme.colors.textDim }}>
					This will abort the merge operation and clean up any temporary resources. The original
					sessions will remain unchanged.
				</p>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="px-3 py-1.5 rounded text-xs border hover:bg-white/5 transition-colors"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						Continue Merge
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
						style={{
							backgroundColor: theme.colors.error,
							color: '#fff',
						}}
					>
						Cancel Merge
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * MergeProgressModal Component
 */
export function MergeProgressModal({
	theme,
	isOpen,
	progress,
	sourceName,
	targetName,
	onCancel,
}: MergeProgressModalProps) {
	// Track start time for elapsed time display
	const [startTime] = useState(() => Date.now());

	// Cancel confirmation state
	const [showCancelConfirm, setShowCancelConfirm] = useState(false);

	// Layer stack registration
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef('');
	const onCancelRef = useRef(onCancel);

	// Keep onCancel ref up to date
	useEffect(() => {
		onCancelRef.current = onCancel;
	});

	// Handle escape key - show confirmation
	const handleEscape = useCallback(() => {
		if (progress.stage === 'complete') {
			onCancelRef.current();
		} else {
			setShowCancelConfirm(true);
		}
	}, [progress.stage]);

	// Register layer on mount
	useEffect(() => {
		if (!isOpen) return;

		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.MERGE_PROGRESS,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Merge Progress',
			onEscape: handleEscape,
		});
		layerIdRef.current = id;

		return () => {
			unregisterLayer(id);
		};
	}, [isOpen, registerLayer, unregisterLayer, handleEscape]);

	// Update handler when callbacks change
	useEffect(() => {
		if (!isOpen) return;
		updateLayerHandler(layerIdRef.current, handleEscape);
	}, [isOpen, updateLayerHandler, handleEscape]);

	// Get the current stage index
	const currentStageIndex = useMemo(() => {
		return STAGES.findIndex((s) => s.id === progress.stage);
	}, [progress.stage]);

	// Handle cancel confirmation
	const handleConfirmCancel = useCallback(() => {
		setShowCancelConfirm(false);
		onCancel();
	}, [onCancel]);

	const handleDismissCancel = useCallback(() => {
		setShowCancelConfirm(false);
	}, []);

	// Handle cancel button click
	const handleCancelClick = useCallback(() => {
		if (progress.stage === 'complete') {
			onCancel();
		} else {
			setShowCancelConfirm(true);
		}
	}, [progress.stage, onCancel]);

	if (!isOpen) return null;

	const isComplete = progress.stage === 'complete';

	return (
		<div
			className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999]"
			role="dialog"
			aria-modal="true"
			aria-label="Merge Progress"
			tabIndex={-1}
		>
			<div
				className="w-[450px] rounded-xl shadow-2xl border outline-none relative overflow-hidden"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Cancel Confirmation Overlay */}
				{showCancelConfirm && (
					<CancelConfirmDialog
						theme={theme}
						onConfirm={handleConfirmCancel}
						onCancel={handleDismissCancel}
					/>
				)}

				{/* Header */}
				<div
					className="p-4 border-b flex items-center justify-between"
					style={{ borderColor: theme.colors.border }}
				>
					<h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
						{isComplete
							? 'Merge Complete'
							: sourceName
								? `Merging "${sourceName}" into "${targetName || 'session'}"...`
								: 'Merging Contexts...'}
					</h2>
					{isComplete && (
						<button
							type="button"
							onClick={onCancel}
							className="p-1 rounded hover:bg-white/10 transition-colors"
							style={{ color: theme.colors.textDim }}
							aria-label="Close modal"
						>
							<X className="w-4 h-4" />
						</button>
					)}
				</div>

				{/* Content */}
				<div className="p-6">
					{/* Spinner or Success Icon */}
					<div className="flex justify-center mb-6">
						{isComplete ? (
							<div
								className="w-12 h-12 rounded-full flex items-center justify-center"
								style={{ backgroundColor: `${theme.colors.success}20` }}
							>
								<Check className="w-6 h-6" style={{ color: theme.colors.success }} />
							</div>
						) : (
							<Spinner theme={theme} />
						)}
					</div>

					{/* Current Status Message */}
					<div className="text-center mb-6">
						<p className="text-sm font-medium mb-1" style={{ color: theme.colors.textMain }}>
							{progress.message || STAGES[currentStageIndex]?.activeLabel || 'Processing...'}
						</p>
						{!isComplete && (
							<div
								className="flex items-center justify-center gap-2 text-xs"
								style={{ color: theme.colors.textDim }}
							>
								<span>Elapsed:</span>
								<ElapsedTimeDisplay startTime={startTime} textColor={theme.colors.textMain} />
							</div>
						)}
					</div>

					{/* Progress Bar */}
					<div className="mb-6">
						<div className="flex justify-between text-xs mb-1">
							<span style={{ color: theme.colors.textDim }}>Progress</span>
							<span style={{ color: theme.colors.textMain }}>{progress.progress}%</span>
						</div>
						<div
							className="h-2 rounded-full overflow-hidden"
							style={{ backgroundColor: theme.colors.bgMain }}
						>
							<div
								className="h-full rounded-full transition-all duration-300 ease-out"
								style={{
									width: `${progress.progress}%`,
									backgroundColor: isComplete ? theme.colors.success : theme.colors.accent,
								}}
							/>
						</div>
					</div>

					{/* Stage Progress */}
					<div className="space-y-2">
						{STAGES.map((stage, index) => {
							const isActive = index === currentStageIndex;
							const isCompleted = index < currentStageIndex;

							return (
								<div key={stage.id} className="flex items-center gap-3">
									{/* Stage Indicator */}
									<div className="w-6 h-6 flex items-center justify-center shrink-0">
										{isCompleted ? (
											<div
												className="w-5 h-5 rounded-full flex items-center justify-center"
												style={{ backgroundColor: theme.colors.success }}
											>
												<Check className="w-3 h-3" style={{ color: '#fff' }} />
											</div>
										) : isActive ? (
											<Loader2
												className="w-5 h-5 animate-spin"
												style={{ color: theme.colors.accent }}
											/>
										) : (
											<div
												className="w-5 h-5 rounded-full border-2"
												style={{ borderColor: theme.colors.border }}
											/>
										)}
									</div>

									{/* Stage Label */}
									<span
										className="text-xs"
										style={{
											color: isActive
												? theme.colors.textMain
												: isCompleted
													? theme.colors.success
													: theme.colors.textDim,
											fontWeight: isActive ? 500 : 400,
										}}
									>
										{isActive ? stage.activeLabel : stage.label}
									</span>
								</div>
							);
						})}
					</div>
				</div>

				{/* Footer */}
				<div className="p-4 border-t flex justify-end" style={{ borderColor: theme.colors.border }}>
					<button
						type="button"
						onClick={handleCancelClick}
						className="px-4 py-2 rounded text-sm border transition-colors"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							backgroundColor: isComplete ? theme.colors.accent : 'transparent',
							...(isComplete && {
								borderColor: theme.colors.accent,
								color: theme.colors.accentForeground,
							}),
						}}
					>
						{isComplete ? 'Done' : 'Cancel'}
					</button>
				</div>
			</div>

			{/* Animation styles */}
			<style>{`
        @keyframes bounce-dot {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
      `}</style>
		</div>
	);
}

export default MergeProgressModal;
