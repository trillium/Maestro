/**
 * DeleteWorktreeModal
 *
 * Lifted from src/renderer/components/DeleteWorktreeModal.tsx as part of the
 * Layer 2.5 leaf-parade lift wave. Implementation is verbatim except for the
 * standard L2.4/L2.5 import-path adjustments:
 * - `Theme` and `Session` previously resolved through the renderer's
 *   `src/renderer/types/index.ts` aggregator. webFull has no `types/`
 *   aggregator — `Theme` is pulled directly from `src/shared/theme-types`
 *   (per the L2.1 / L2.3 / L2.4 / L2.5 sibling precedent) and `Session` is
 *   pulled from `src/webFull/hooks/useSessions` where it's the webFull
 *   canonical Session type (extends the wire-protocol `SessionData` from
 *   `src/web/hooks/useWebSocket`). The wire-protocol `SessionData` carries
 *   the only two fields this modal actually consumes (`name`, `cwd`) so the
 *   substitution is observably equivalent for this leaf.
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08
 *   audit risk A — non-divergent constants stay re-exported from renderer to
 *   prevent silent drift).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and every Layer 2.4 /
 * 2.5 modal lift to date. Callers in webFull call `const { theme } =
 * useTheme()` at the feature-component level and thread it down.
 *
 * Footer shape: this modal does NOT compose `ModalFooter` because its action
 * surface is a three-button row (Cancel / Remove / Remove and Delete) plus a
 * single-button replacement loading state ("Deleting..." with a spinner).
 * `ModalFooter` is shaped for the two-button confirm/cancel pattern. The
 * renderer source builds the row inline; this lift preserves that verbatim.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { Session } from '../hooks/useSessions';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';

interface DeleteWorktreeModalProps {
	theme: Theme;
	session: Session;
	onClose: () => void;
	onConfirm: () => void;
	onConfirmAndDelete: () => Promise<void>;
}

/**
 * DeleteWorktreeModal - Confirmation modal for deleting a worktree session
 *
 * Provides three options:
 * - Cancel: Close without action
 * - Confirm: Remove the sub-agent but keep the worktree directory on disk
 * - Confirm and Delete on Disk: Remove the sub-agent AND delete the worktree directory
 */
export function DeleteWorktreeModal({
	theme,
	session,
	onClose,
	onConfirm,
	onConfirmAndDelete,
}: DeleteWorktreeModalProps) {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = () => {
		onConfirm();
		onClose();
	};

	const handleConfirmAndDelete = async () => {
		setIsDeleting(true);
		setError(null);
		try {
			await onConfirmAndDelete();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete worktree');
			setIsDeleting(false);
		}
	};

	return (
		<Modal
			theme={theme}
			title="Delete Worktree"
			priority={MODAL_PRIORITIES.CONFIRM}
			onClose={onClose}
			headerIcon={<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />}
			width={540}
			zIndex={10000}
			initialFocusRef={confirmButtonRef}
			footer={
				<div className="flex gap-2 w-full flex-nowrap">
					{isDeleting ? (
						<button
							type="button"
							disabled
							className="px-3 py-1.5 rounded transition-colors outline-none flex items-center justify-center gap-1.5 text-xs whitespace-nowrap ml-auto"
							style={{
								backgroundColor: theme.colors.error,
								color: '#ffffff',
								opacity: 0.7,
							}}
						>
							<Loader2 className="w-3 h-3 animate-spin" />
							Deleting...
						</button>
					) : (
						<>
							<button
								type="button"
								onClick={onClose}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.stopPropagation();
										onClose();
									}
								}}
								className="px-3 py-1.5 rounded border hover:bg-white/5 transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap mr-auto"
								style={{
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							>
								Cancel
							</button>
							<button
								ref={confirmButtonRef}
								type="button"
								onClick={handleConfirm}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.stopPropagation();
										handleConfirm();
									}
								}}
								className="px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap"
								style={{
									backgroundColor: `${theme.colors.error}99`,
									color: '#ffffff',
								}}
							>
								Remove
							</button>
							<button
								type="button"
								onClick={handleConfirmAndDelete}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.stopPropagation();
										handleConfirmAndDelete();
									}
								}}
								className="px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap"
								style={{
									backgroundColor: theme.colors.error,
									color: '#ffffff',
								}}
							>
								Remove and Delete
							</button>
						</>
					)}
				</div>
			}
		>
			<div className="flex gap-4">
				<div
					className="flex-shrink-0 p-2 rounded-full h-fit"
					style={{ backgroundColor: `${theme.colors.error}20` }}
				>
					<AlertTriangle className="w-5 h-5" style={{ color: theme.colors.error }} />
				</div>
				<div className="space-y-3">
					<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
						Delete worktree session "<span className="font-semibold">{session.name}</span>"?
					</p>
					<div className="text-sm space-y-2" style={{ color: theme.colors.textDim }}>
						<p>
							<strong style={{ color: theme.colors.textMain }}>Remove:</strong> Removes the
							sub-agent from Maestro but keeps the git worktree directory on disk.
						</p>
						<p>
							<strong style={{ color: theme.colors.textMain }}>Remove and Delete:</strong> Removes
							the sub-agent AND permanently deletes the worktree directory from disk.
						</p>
					</div>
					{session.cwd && (
						<p
							className="text-xs font-mono px-2 py-1.5 rounded truncate"
							style={{
								backgroundColor: theme.colors.bgActivity,
								color: theme.colors.textDim,
							}}
							title={session.cwd}
						>
							{session.cwd}
						</p>
					)}
					{error && (
						<p className="text-xs" style={{ color: theme.colors.error }}>
							{error}
						</p>
					)}
				</div>
			</div>
		</Modal>
	);
}

export default DeleteWorktreeModal;
