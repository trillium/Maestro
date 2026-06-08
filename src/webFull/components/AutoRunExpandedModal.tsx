/**
 * AutoRunExpandedModal
 *
 * Lifted verbatim from `src/renderer/components/AutoRunExpandedModal.tsx`
 * (~470 LOC, 0 module-load IPC per pre-flight grep) as part of the Layer
 * 2.5 leaf-parade lift wave. Direct sibling of the L2.5 `AutoRunLightbox`
 * / `AutoRunnerHelpModal` / `AutoRunSearchBar` lifts — same Auto-Run
 * feature surface, distinguishing feature is the full-screen Edit/Preview
 * shell around the `AutoRun` view. Lifted in the same branch as the
 * sibling `AutoRunDocumentSelector` lift (the type-only import
 * `DocumentTaskCount` is consumed from the local sibling at
 * `'./AutoRunDocumentSelector'`).
 *
 * Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer" src/renderer/components/AutoRunExpandedModal.tsx`
 * returned empty (exit 1). The component touches none of the banned
 * surface at module load. All side effects flow through the prop callbacks
 * the caller supplies (`onClose`, `onStateChange`, `onOpenBatchRunner`,
 * `onStopBatchRun`, the Phase-5.10 error-handling triad, etc.).
 *
 * Lift policy: verbatim copy of the body with the following import-path
 * adjustments:
 *
 * 1. `Theme` from `'../types'` → `'../../shared/theme-types'`. Standard
 *    L2.5 swap — renderer aggregator routes through `src/renderer/types/
 *    index.ts` which re-exports the canonical type from
 *    `src/shared/theme-types`; webFull imports the canonical type directly
 *    to avoid a silent-drift surface (Architect 2026-06-08 audit risk A).
 *
 * 2. `BatchRunState`, `SessionState`, `Shortcut` from `'../types'` →
 *    `'../../renderer/types'` (cross-fork transitive type-only import).
 *    These types are aggregator-defined in the renderer types module and
 *    not yet promoted into `src/shared/`; matches the established
 *    `GroupChatHeader` / `SessionItem` / `ExecutionQueueIndicator`
 *    precedent. `BatchRunState` carries Auto-Run batch lifecycle state
 *    (`isRunning`, `isStopping`, plus error/progress fields); `SessionState`
 *    is the canonical `idle | busy | waiting_input | connecting | error`
 *    discriminant; `Shortcut` is the keyboard-binding descriptor. No
 *    transitive `window.maestro` reach — all three are pure data shapes.
 *
 * 3. `useLayerStack` from `'../contexts/LayerStackContext'` →
 *    `'../contexts/LayerStackContext'` (no path change — webFull-side
 *    LayerStack context from the L2.1 port).
 *
 * 4. `MODAL_PRIORITIES` from `'../constants/modalPriorities'` →
 *    `'../constants/modalPriorities'` (no path change — webFull re-export
 *    shim at `src/webFull/constants/modalPriorities.ts` per the Architect
 *    2026-06-08 audit risk A precedent; constants don't diverge).
 *
 * 5. `AutoRun, AutoRunHandle` from `'./AutoRun'` →
 *    `'../../renderer/components/AutoRun'` (CROSS-FORK EDGE). The
 *    `AutoRun` view is the full Auto-Run editor surface (~2200+ LOC, heavy
 *    runtime IPC: `window.maestro.autoRun.*`, `window.maestro.fs.*`,
 *    `window.maestro.dialog.*`, `window.maestro.shell.openPath`,
 *    `window.maestro.images.*`, etc.). Lifting `AutoRun` itself would
 *    drag the entire Auto-Run IPC namespace through webFull, which is out
 *    of scope for this leaf and blocked on the server-side `/api/autorun/*`
 *    + `/api/fs/*` + `/api/images/*` REST routes that have not been
 *    ported. This matches the established cross-fork-edge precedent set by
 *    `GitDiffViewer`'s edge to `'../../renderer/components/ImageDiffViewer'`
 *    before the corresponding routes landed. The modal shell itself is a
 *    pure presentational surface (Edit/Preview toggle + Save/Revert +
 *    Run/Stop + PlayBooks + Collapse/Close) that delegates the heavy
 *    document-editor view to `AutoRun` through an `AutoRunHandle` ref
 *    surface (`isDirty()`, `save()`, `revert()`, `switchMode()`, `focus()`).
 *    A future ISC-44.layer-2.5.autorun_view lift drops the edge when the
 *    server routes land.
 *
 * 6. `DocumentTaskCount` from `'./AutoRunDocumentSelector'` →
 *    `'./AutoRunDocumentSelector'` (no path change — sibling lift in
 *    THIS branch). The selector ships as a separate webFull module
 *    alongside this modal; the type-only import resolves locally without
 *    a cross-fork edge.
 *
 * 7. `ConfirmModal` from `'./ConfirmModal'` → `'./ConfirmModal'` (no path
 *    change — L2.1 webFull primitive).
 *
 * 8. `formatShortcutKeys` from `'../utils/shortcutFormatter'` →
 *    `'../utils/shortcutFormatter'` (no path change — webFull-side
 *    mirror from earlier L2.x port).
 *
 * Composition shape: portal-mounted into `document.body` as a `fixed
 * inset-0 z-[100]` overlay with a centered card sized at `90vw x 80vh`
 * matching the PromptComposer modal. Header carries the title, the
 * Edit/Preview/Save/Revert/Run/PlayBooks button row, and the
 * Collapse/Close affordances. Body renders the `AutoRun` view with
 * `hideTopControls` set so the header isn't duplicated. An unsaved-changes
 * `ConfirmModal` composes on top when the user attempts to close while
 * `isDirty=true`.
 *
 * Keyboard handling: registers with the LayerStack at
 * `MODAL_PRIORITIES.AUTORUN_EXPANDED` with `focusTrap: 'strict'` and
 * routes Escape through the LayerStack's `onEscape` callback, which fires
 * the unsaved-changes-aware close handler.
 *
 * Theme access pattern: kept the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift.
 *
 * 0 IPC namespaces touched at module load. 0 Electron-only APIs touched
 * at module load. 0 `src/main/` touches. 0 `src/renderer/` edits. 0
 * `src/web/` edits. 0 `src/server/` edits. The cross-fork edge to the
 * renderer-side `AutoRun` view defers any IPC reach to runtime within
 * that subcomponent, NOT at this modal shell's module load.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import {
	X,
	Minimize2,
	Eye,
	Edit,
	Play,
	Square,
	Loader2,
	Save,
	RotateCcw,
	LayoutGrid,
	AlertTriangle,
} from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { BatchRunState, SessionState, Shortcut } from '../../renderer/types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { AutoRun, type AutoRunHandle } from './AutoRun';
import type { DocumentTaskCount } from './AutoRunDocumentSelector';
import { ConfirmModal } from './ConfirmModal';
import { formatShortcutKeys } from '../utils/shortcutFormatter';

interface AutoRunExpandedModalProps {
	theme: Theme;
	onClose: () => void;
	// Pass through all AutoRun props
	sessionId: string;
	sshRemoteId?: string; // SSH remote config ID - when set, all fs/autorun operations use SSH
	folderPath: string | null;
	selectedFile: string | null;
	documentList: string[];
	documentTree?: Array<{
		name: string;
		type: 'file' | 'folder';
		path: string;
		children?: unknown[];
	}>;
	content: string;
	onContentChange: (content: string) => void;
	contentVersion?: number;
	// Optional external draft content management (for sharing between panel and expanded modal)
	externalLocalContent?: string;
	onExternalLocalContentChange?: (content: string) => void;
	externalSavedContent?: string;
	onExternalSavedContentChange?: (content: string) => void;
	mode: 'edit' | 'preview';
	onModeChange: (mode: 'edit' | 'preview') => void;
	initialCursorPosition?: number;
	initialEditScrollPos?: number;
	initialPreviewScrollPos?: number;
	onStateChange?: (state: {
		mode: 'edit' | 'preview';
		cursorPosition: number;
		editScrollPos: number;
		previewScrollPos: number;
	}) => void;
	onOpenSetup: () => void;
	onRefresh: () => void;
	onSelectDocument: (filename: string) => void;
	onCreateDocument: (filename: string) => Promise<boolean>;
	isLoadingDocuments?: boolean;
	documentTaskCounts?: Map<string, DocumentTaskCount>; // Task counts per document
	batchRunState?: BatchRunState;
	onOpenBatchRunner?: () => void;
	onStopBatchRun?: (sessionId?: string) => void;
	// Error handling callbacks (Phase 5.10)
	onSkipCurrentDocument?: () => void;
	onAbortBatchOnError?: () => void;
	onResumeAfterError?: () => void;
	sessionState?: SessionState;
	shortcuts?: Record<string, Shortcut>;
	onOpenMarketplace?: () => void;
}

export function AutoRunExpandedModal({
	theme,
	onClose,
	mode: initialMode,
	onModeChange,
	onStateChange,
	batchRunState,
	onOpenBatchRunner,
	onStopBatchRun,
	// Error handling callbacks (Phase 5.10)
	onSkipCurrentDocument,
	onAbortBatchOnError,
	onResumeAfterError,
	sessionState,
	shortcuts,
	sessionId,
	onOpenMarketplace,
	...autoRunProps
}: AutoRunExpandedModalProps) {
	const { registerLayer, unregisterLayer } = useLayerStack();
	const onCloseRef = useRef(onClose);
	const handleCloseRef = useRef<() => void>(onClose);
	const autoRunRef = useRef<AutoRunHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	onCloseRef.current = onClose;

	const handleLayerEscape = useCallback(() => {
		handleCloseRef.current();
	}, []);

	// Local mode state - independent from the right panel behind the modal
	const [localMode, setLocalMode] = useState<'edit' | 'preview'>(initialMode);

	// Wrap onStateChange to prevent mode from propagating to parent
	// This keeps the expanded modal's mode independent from the right panel
	const handleStateChange = useCallback(
		(state: {
			mode: 'edit' | 'preview';
			cursorPosition: number;
			editScrollPos: number;
			previewScrollPos: number;
		}) => {
			if (onStateChange) {
				// Pass through cursor and scroll positions, but keep the parent's current mode
				onStateChange({
					...state,
					mode: initialMode, // Don't propagate mode changes to parent
				});
			}
		},
		[onStateChange, initialMode]
	);

	const isLocked = batchRunState?.isRunning || false;
	const isAgentBusy = sessionState === 'busy' || sessionState === 'connecting';
	const isStopping = batchRunState?.isStopping || false;

	// Track dirty state from AutoRun component
	const [isDirty, setIsDirty] = useState(false);

	// Poll dirty state from AutoRun ref
	useEffect(() => {
		const interval = setInterval(() => {
			if (autoRunRef.current) {
				setIsDirty(autoRunRef.current.isDirty());
			}
		}, 100);
		return () => clearInterval(interval);
	}, []);

	// Save handler
	const handleSave = useCallback(async () => {
		if (autoRunRef.current) {
			await autoRunRef.current.save();
			setIsDirty(false);
		}
	}, []);

	// Revert handler
	const handleRevert = useCallback(() => {
		if (autoRunRef.current) {
			autoRunRef.current.revert();
			setIsDirty(false);
		}
	}, []);

	// Unsaved changes confirmation state
	const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

	// Close handler that checks for unsaved changes
	const handleClose = useCallback(() => {
		if (isDirty) {
			setShowUnsavedConfirm(true);
		} else {
			onClose();
		}
	}, [isDirty, onClose]);
	handleCloseRef.current = handleClose;

	// Discard changes and close
	const handleDiscardAndClose = useCallback(() => {
		handleRevert();
		setShowUnsavedConfirm(false);
		onClose();
	}, [handleRevert, onClose]);

	// Register layer on mount
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.AUTORUN_EXPANDED,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			onEscape: handleLayerEscape,
		});

		return () => {
			unregisterLayer(id);
		};
	}, [registerLayer, unregisterLayer, handleLayerEscape]);

	// Focus the AutoRun component on mount
	useEffect(() => {
		const timer = setTimeout(() => {
			autoRunRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, []);

	// Use the AutoRun's switchMode for scroll sync, falling back to local mode change
	const setMode = useCallback(
		(newMode: 'edit' | 'preview') => {
			if (autoRunRef.current?.switchMode) {
				autoRunRef.current.switchMode(newMode);
			} else {
				setLocalMode(newMode);
				onModeChange(newMode);
			}
		},
		[onModeChange]
	);

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center"
			style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					handleClose();
				}
			}}
		>
			{/* Modal - same size as PromptComposer for consistency */}
			<div
				className="relative w-[90vw] h-[80vh] max-w-5xl overflow-hidden rounded-xl border shadow-2xl flex flex-col"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
			>
				{/* Header with controls */}
				<div
					className="flex items-center justify-between px-4 py-3 border-b shrink-0"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
				>
					{/* Left side - Title */}
					<h2 className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
						Auto Run
					</h2>

					{/* Center - Mode controls */}
					<div className="flex items-center gap-2">
						<button
							onClick={() => !isLocked && setMode('edit')}
							disabled={isLocked}
							className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
								localMode === 'edit' && !isLocked ? 'font-semibold' : ''
							} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
							style={{
								backgroundColor:
									localMode === 'edit' && !isLocked ? theme.colors.bgMain : 'transparent',
								color: isLocked
									? theme.colors.textDim
									: localMode === 'edit'
										? theme.colors.textMain
										: theme.colors.textDim,
								border: `1px solid ${localMode === 'edit' && !isLocked ? theme.colors.accent : theme.colors.border}`,
							}}
							title={isLocked ? 'Editing disabled while Auto Run active' : 'Edit document'}
						>
							<Edit className="w-3.5 h-3.5" />
							Edit
						</button>
						<button
							onClick={() => setMode('preview')}
							className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${
								localMode === 'preview' || isLocked ? 'font-semibold' : ''
							}`}
							style={{
								backgroundColor:
									localMode === 'preview' || isLocked ? theme.colors.bgMain : 'transparent',
								color:
									localMode === 'preview' || isLocked
										? theme.colors.textMain
										: theme.colors.textDim,
								border: `1px solid ${localMode === 'preview' || isLocked ? theme.colors.accent : theme.colors.border}`,
							}}
							title="Preview document"
						>
							<Eye className="w-3.5 h-3.5" />
							Preview
						</button>
						{/* Image upload button - hidden for now, can be re-enabled when needed
            <button
              onClick={() => localMode === 'edit' && !isLocked && fileInputRef.current?.click()}
              disabled={localMode !== 'edit' || isLocked}
              className={`flex items-center justify-center w-8 h-8 rounded text-xs transition-colors ${
                localMode === 'edit' && !isLocked ? 'hover:opacity-80' : 'opacity-30 cursor-not-allowed'
              }`}
              style={{
                backgroundColor: 'transparent',
                color: theme.colors.textDim,
                border: `1px solid ${theme.colors.border}`
              }}
              title={localMode === 'edit' && !isLocked ? 'Add image (or paste from clipboard)' : 'Switch to Edit mode to add images'}
            >
              <Image className="w-3.5 h-3.5" />
            </button>
            */}
						<input ref={fileInputRef} type="file" accept="image/*" className="hidden" />
						{/* Save/Revert buttons - shown when dirty */}
						{isDirty && localMode === 'edit' && !isLocked && (
							<>
								<div className="w-px h-4 mx-1" style={{ backgroundColor: theme.colors.border }} />
								<button
									onClick={handleRevert}
									className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors hover:opacity-80"
									style={{
										backgroundColor: 'transparent',
										color: theme.colors.textDim,
										border: `1px solid ${theme.colors.border}`,
									}}
									title="Discard changes"
								>
									<RotateCcw className="w-3 h-3" />
									Revert
								</button>
								<button
									onClick={handleSave}
									className="group relative flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors hover:opacity-80"
									style={{
										backgroundColor: theme.colors.accent,
										color: theme.colors.accentForeground,
										border: `1px solid ${theme.colors.accent}`,
									}}
									title="Save changes"
								>
									<Save className="w-3 h-3" />
									Save
									{/* Keyboard shortcut overlay on hover */}
									<span
										className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
										style={{
											backgroundColor: theme.colors.bgMain,
											color: theme.colors.textDim,
											border: `1px solid ${theme.colors.border}`,
										}}
									>
										{formatShortcutKeys(['Meta', 's'])}
									</span>
								</button>
							</>
						)}
						{/* Run / Stop button */}
						{isLocked ? (
							<button
								onClick={() => !isStopping && onStopBatchRun?.(sessionId)}
								disabled={isStopping}
								className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors font-semibold ${isStopping ? 'cursor-not-allowed' : ''}`}
								style={{
									backgroundColor: isStopping ? theme.colors.warning : theme.colors.error,
									color: isStopping ? theme.colors.bgMain : 'white',
									border: `1px solid ${isStopping ? theme.colors.warning : theme.colors.error}`,
									pointerEvents: isStopping ? 'none' : 'auto',
								}}
								title={isStopping ? 'Stopping after current task...' : 'Stop auto-run'}
							>
								{isStopping ? (
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
								) : (
									<Square className="w-3.5 h-3.5" />
								)}
								{isStopping ? 'Stopping...' : 'Stop'}
							</button>
						) : (
							<button
								onClick={() => {
									// Save before opening batch runner if dirty
									if (isDirty) {
										handleSave();
									}
									onOpenBatchRunner?.();
								}}
								disabled={isAgentBusy}
								className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors ${isAgentBusy ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
								style={{
									backgroundColor: theme.colors.accent,
									color: theme.colors.accentForeground,
									border: `1px solid ${theme.colors.accent}`,
								}}
								title={isAgentBusy ? 'Cannot run while agent is thinking' : 'Run auto-run on tasks'}
							>
								<Play className="w-3.5 h-3.5" />
								Run
							</button>
						)}
						{/* PlayBooks button */}
						{onOpenMarketplace && (
							<button
								onClick={onOpenMarketplace}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors hover:opacity-90"
								style={{
									color: theme.colors.accent,
									border: `1px solid ${theme.colors.accent}`,
									backgroundColor: `${theme.colors.accent}15`,
								}}
								title="Browse PlayBooks - discover and share community playbooks"
							>
								<LayoutGrid className="w-3.5 h-3.5" />
								PlayBooks
							</button>
						)}
					</div>

					{/* Right side - Collapse/Close */}
					<div className="flex items-center gap-2">
						<button
							onClick={handleClose}
							className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors hover:bg-white/10"
							style={{ color: theme.colors.textDim }}
							title={`Collapse${shortcuts?.toggleAutoRunExpanded ? ` (${formatShortcutKeys(shortcuts.toggleAutoRunExpanded.keys)})` : ' (Esc)'}`}
						>
							<Minimize2 className="w-4 h-4" />
							Collapse
						</button>
						<button
							onClick={handleClose}
							className="p-1 rounded hover:bg-white/10 transition-colors"
							title="Close (Esc)"
						>
							<X className="w-5 h-5" style={{ color: theme.colors.textDim }} />
						</button>
					</div>
				</div>

				{/* AutoRun Content - hide top controls since they're in header */}
				<div className="flex-1 min-h-0 overflow-hidden p-4">
					<AutoRun
						ref={autoRunRef}
						theme={theme}
						mode={localMode}
						onModeChange={setLocalMode}
						onStateChange={handleStateChange}
						batchRunState={batchRunState}
						onOpenBatchRunner={onOpenBatchRunner}
						onStopBatchRun={onStopBatchRun}
						onSkipCurrentDocument={onSkipCurrentDocument}
						onAbortBatchOnError={onAbortBatchOnError}
						onResumeAfterError={onResumeAfterError}
						sessionState={sessionState}
						sessionId={sessionId}
						hideTopControls
						{...autoRunProps}
					/>
				</div>
			</div>

			{/* Unsaved changes confirmation */}
			{showUnsavedConfirm && (
				<ConfirmModal
					theme={theme}
					title="Unsaved Changes"
					headerIcon={<AlertTriangle className="w-4 h-4" style={{ color: theme.colors.warning }} />}
					message="You have unsaved changes to this Auto Run document. Discard changes and close?"
					onConfirm={handleDiscardAndClose}
					onClose={() => setShowUnsavedConfirm(false)}
					destructive={false}
					confirmLabel="Discard"
				/>
			)}
		</div>,
		document.body
	);
}
