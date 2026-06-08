/**
 * GitStatusWidget — webFull lift
 *
 * Layer 2.5 leaf-parade lift of `src/renderer/components/GitStatusWidget.tsx`
 * (244 LOC). Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]"
 * src/renderer/components/GitStatusWidget.tsx` returned empty (exit 1) — the
 * widget itself touches zero IPC namespaces and zero Electron-only APIs.
 *
 * **Reference oracle:** `src/renderer/components/GitStatusWidget.tsx` — header
 * widget that displays git file changes with GitHub-style diff bars. Behavior
 * surface:
 *   - hidden when `!isGitRepo` or `fileCount === 0`
 *   - compact pill (file count) at narrow widths, full breakdown at wider
 *     widths (CSS-driven via `header-git-status-compact` / `header-git-status-full`)
 *   - hover tooltip with per-file diff bars + "View Full Diff" + optional
 *     "View Git Log" actions
 *   - GitBranch / Plus / Minus / FileEdit / FileDiff / History lucide icons
 *
 * **The decision: strip the two hook self-sources and promote to props.**
 *
 * The renderer source self-sources git status data from two focused contexts:
 *
 *   const { getFileCount }   = useGitFileStatus();
 *   const { getFileDetails } = useGitDetail();
 *   const fileCount   = getFileCount(sessionId);
 *   const fileDetails = getFileDetails(sessionId);
 *
 * The provider for those contexts (`GitStatusProvider` in
 * `src/renderer/contexts/GitStatusContext.tsx`) is built on
 * `useGitStatusPolling`, which calls `window.maestro.git.getStatus(...)` and
 * is therefore IPC-bound at module-instantiation. Lifting the context as-is
 * would drag the entire git-status polling hook (and the IPC site with it)
 * through the webFull bundle entry point — out of scope per the brief's
 * "needs a server-side route which is out of scope" guard.
 *
 * Matching webFull pattern (established by `AppOverlays` and `SessionList`
 * L4.1 — see Decisions 2026-06-08): **promote the self-sourced values to
 * props.** Two new optional inputs:
 *
 *   - `fileCount: number` — replaces `getFileCount(sessionId)`
 *   - `fileDetails?: GitFileDetails` — replaces `getFileDetails(sessionId)`
 *
 * The host (a downstream layer-wiring pass that ports the git-status
 * substrate as a REST + WS surface) decides where those values come from —
 * a future webFull `useGitFileStatus()` hook reading `/api/git/status`,
 * a global store, or prop-drilling from the App root. The widget stays a
 * pure render of (fileCount, fileDetails, theme, callbacks) with no implicit
 * data dependencies. This matches the brief's explicit guard: the widget
 * does not read git status via IPC at module-load.
 *
 * **The `sessionId` prop is consequently dropped from the lifted surface.**
 * The renderer source uses it only to key into the two hooks; with the hooks
 * gone, the widget no longer needs to know which session it's representing.
 * If a future host wants to surface "this widget is for session X" for
 * debugging or analytics, that's a host concern (a wrapping `<div
 * data-session-id={id}>` for the L1 audit), not a widget concern.
 *
 * **Type-resolution adapts (matching the L2.5 precedent):**
 *
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'`. The renderer
 *     `types/index.ts` aggregator re-exports the same canonical type;
 *     webFull pulls it directly to avoid the silent-drift surface audit risk
 *     A explicitly warns against.
 *   - `GitFileChange` is NOT pulled from `'../contexts/GitStatusContext'`
 *     (which re-exports it from `useGitStatusPolling`). The renderer's
 *     `GitFileChange` interface is small and stable (5 primitive fields:
 *     `path`, `status`, `additions`, `deletions`, `modified`) — this lift
 *     defines it locally rather than dragging the hook + context graph into
 *     the webFull tree. Matches the `ExecutionQueueIndicator` /
 *     `DeleteWorktreeModal` precedent of pulling only the specific data
 *     shape each lifted module consumes.
 *   - `GitFileDetails` is a new aggregate that captures the shape the
 *     renderer hook's `getFileDetails(sessionId)` returns: `{ fileChanges?,
 *     totalAdditions, totalDeletions, modifiedCount }`. The renderer
 *     declares this shape inline inside `GitDetailContextValue`; lifting it
 *     to a named type here keeps the prop contract greppable.
 *
 * **What this lift is NOT:**
 *   - Not a lift of `GitStatusContext` / `GitStatusProvider` / the
 *     `useGitStatusPolling` hook (IPC-bound; needs a server-side `/api/git/*`
 *     port — explicitly out of scope per the brief).
 *   - Not a lift of `git:getStatus` IPC handler (renderer-only by design).
 *   - Not a wiring change inside webFull `App.tsx` — exporting only; host
 *     wiring is a follow-on.
 */

import { useState, useRef, useEffect, memo } from 'react';
import { GitBranch, Plus, Minus, FileEdit, FileDiff, History } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';

/**
 * Individual file change with line-level statistics.
 *
 * Mirrors the renderer's `GitFileChange` from
 * `src/renderer/hooks/git/useGitStatusPolling.ts:36` field-for-field.
 * Lifted locally rather than imported so the webFull tree does not pull
 * the IPC-bound polling hook through this leaf.
 */
export interface GitFileChange {
	path: string;
	status: string;
	additions: number;
	deletions: number;
	modified: boolean;
}

/**
 * Aggregate file-detail shape that the widget consumes — matches the
 * renderer `GitDetailContextValue.getFileDetails()` return shape from
 * `src/renderer/contexts/GitStatusContext.tsx`.
 */
export interface GitFileDetails {
	fileChanges?: GitFileChange[];
	totalAdditions: number;
	totalDeletions: number;
	modifiedCount: number;
}

export interface GitStatusWidgetProps {
	/** Whether this session is a git repo */
	isGitRepo: boolean;
	/** Number of changed files (replaces renderer `getFileCount(sessionId)`) */
	fileCount: number;
	/**
	 * Detailed file changes (replaces renderer `getFileDetails(sessionId)`).
	 * Only the active session would have this in renderer; absent rows show
	 * just the basic file count pill.
	 */
	fileDetails?: GitFileDetails;
	theme: Theme;
	onViewDiff: () => void;
	onViewLog?: () => void;
}

/**
 * GitStatusWidget - Displays git file changes with GitHub-style diff bars
 *
 * The host supplies file count + (optional) detailed file changes via props
 * — this widget does not read from IPC or self-source from a context.
 *
 * PERF: Memoized to prevent re-renders when parent re-renders with same props.
 */
export const GitStatusWidget = memo(function GitStatusWidget({
	isGitRepo,
	fileCount,
	fileDetails,
	theme,
	onViewDiff,
	onViewLog,
}: GitStatusWidgetProps) {
	// Tooltip hover state with timeout for smooth UX
	const [tooltipOpen, setTooltipOpen] = useState(false);
	const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTooltipCloseTimeout = () => {
		if (tooltipTimeout.current) {
			clearTimeout(tooltipTimeout.current);
			tooltipTimeout.current = null;
		}
	};

	// Cleanup hover timeout on unmount
	useEffect(() => {
		return () => {
			if (tooltipTimeout.current) {
				clearTimeout(tooltipTimeout.current);
			}
		};
	}, []);

	// Don't render if not a git repo or no file count or no changes
	if (!isGitRepo || fileCount === 0) {
		return null;
	}

	// Use detailed file changes if available (active session), otherwise show basic counts
	const fileChanges = fileDetails?.fileChanges || [];
	const additions = fileDetails?.totalAdditions ?? 0;
	const deletions = fileDetails?.totalDeletions ?? 0;
	const modified = fileDetails?.modifiedCount ?? 0;
	const totalChanges = additions + deletions + modified;

	return (
		<div
			className="relative shrink-0"
			onMouseEnter={() => {
				// Clear any pending close timeout
				clearTooltipCloseTimeout();
				setTooltipOpen(true);
			}}
			onMouseLeave={() => {
				// Delay closing to allow mouse to reach the dropdown
				tooltipTimeout.current = setTimeout(() => {
					setTooltipOpen(false);
				}, 150);
			}}
		>
			<button
				onClick={onViewDiff}
				className="flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors hover:bg-white/5"
				style={{ color: theme.colors.textMain }}
				title={`+${additions} −${deletions} ~${modified}`}
			>
				{/* Compact mode: just show file count - shown at narrow widths via CSS */}
				<span className="header-git-status-compact flex items-center gap-1" aria-hidden="true">
					<FileDiff className="w-3 h-3" style={{ color: theme.colors.textDim }} />
					<span style={{ color: theme.colors.textDim }}>{fileCount}</span>
				</span>

				{/* Full mode: show breakdown by type - shown at wider widths via CSS */}
				<span className="header-git-status-full flex items-center gap-2">
					<GitBranch className="w-3 h-3" />

					{additions > 0 && (
						<span className="flex items-center gap-0.5 text-green-500">
							<Plus className="w-3 h-3" />
							{additions}
						</span>
					)}

					{deletions > 0 && (
						<span className="flex items-center gap-0.5 text-red-500">
							<Minus className="w-3 h-3" />
							{deletions}
						</span>
					)}

					{modified > 0 && (
						<span className="flex items-center gap-0.5 text-orange-500">
							<FileEdit className="w-3 h-3" />
							{modified}
						</span>
					)}
				</span>
			</button>

			{/* Hover tooltip showing file list with GitHub-style diff bars */}
			{tooltipOpen && fileChanges.length > 0 && (
				<>
					{/* Invisible bridge to prevent hover gap */}
					<div
						className="absolute left-0 right-0 h-3 pointer-events-auto"
						style={{ top: '100%' }}
						onMouseEnter={() => {
							clearTooltipCloseTimeout();
							setTooltipOpen(true);
						}}
					/>
					<div
						className="absolute top-full left-0 mt-2 w-max max-w-[400px] rounded shadow-xl z-[100] pointer-events-auto"
						style={{
							backgroundColor: theme.colors.bgSidebar,
							border: `1px solid ${theme.colors.border}`,
						}}
						onMouseEnter={() => {
							clearTooltipCloseTimeout();
							setTooltipOpen(true);
						}}
						onMouseLeave={() => {
							tooltipTimeout.current = setTimeout(() => {
								setTooltipOpen(false);
							}, 150);
						}}
					>
						<div
							className="text-[10px] uppercase font-bold p-3 border-b"
							style={{
								color: theme.colors.textDim,
								borderColor: theme.colors.border,
							}}
						>
							Changed Files ({totalChanges}) • +{additions} −{deletions}
						</div>
						<div className="max-h-96 overflow-y-auto scrollbar-thin">
							{fileChanges.map((file: GitFileChange, idx: number) => {
								const total = file.additions + file.deletions;
								const maxBarWidth = 60; // Max width in pixels for the bar
								const additionsWidth = total > 0 ? (file.additions / total) * maxBarWidth : 0;
								const deletionsWidth = total > 0 ? (file.deletions / total) * maxBarWidth : 0;

								return (
									<div
										key={idx}
										className="px-3 py-2 text-xs border-b last:border-b-0"
										style={{
											borderColor: theme.colors.border,
											color: theme.colors.textMain,
										}}
									>
										<div className="flex items-center justify-between gap-3 mb-1">
											<span className="font-mono flex-1 min-w-0" title={file.path}>
												{file.path}
											</span>
											<div className="flex items-center gap-2 shrink-0 text-[10px]">
												{file.additions > 0 && (
													<span className="text-green-500">+{file.additions}</span>
												)}
												{file.deletions > 0 && (
													<span className="text-red-500">−{file.deletions}</span>
												)}
											</div>
										</div>
										{/* GitHub-style diff bar */}
										{total > 0 && (
											<div className="flex gap-0.5 h-2">
												{file.additions > 0 && (
													<div
														className="bg-green-500 rounded-sm"
														style={{ width: `${additionsWidth}px` }}
													/>
												)}
												{file.deletions > 0 && (
													<div
														className="bg-red-500 rounded-sm"
														style={{ width: `${deletionsWidth}px` }}
													/>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
						<button
							onClick={onViewDiff}
							className="flex items-center justify-center gap-2 text-xs p-2 border-t w-full hover:bg-white/10 transition-colors cursor-pointer"
							style={{
								color: theme.colors.textDim,
								borderColor: theme.colors.border,
							}}
						>
							<FileDiff className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
							View Full Diff
						</button>
						{onViewLog && (
							<button
								onClick={onViewLog}
								className="flex items-center justify-center gap-2 text-xs p-2 border-t w-full hover:bg-white/10 transition-colors cursor-pointer"
								style={{
									color: theme.colors.textDim,
									borderColor: theme.colors.border,
								}}
							>
								<History className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
								View Git Log
							</button>
						)}
					</div>
				</>
			)}
		</div>
	);
});
