/**
 * DeleteAgentConfirmModal
 *
 * Lifted from src/renderer/components/DeleteAgentConfirmModal.tsx as part of the
 * Layer 2.5 leaf-parade wave. Implementation is verbatim except for two import
 * paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the prior L2.4 / L2.5
 * lifts (ResetTasksConfirmModal, PlaybookNameModal, PlaybookDeleteConfirmModal).
 * Callers in webFull call `const { theme } = useTheme()` at the
 * feature-component level and thread it down.
 *
 * Surface diff vs the sibling PlaybookDeleteConfirmModal (L2.5 batch #1):
 * - Three-button footer (Cancel / Agent Only / Agent + Working Directory)
 *   instead of the standard two-button ModalFooter shape. The two destructive
 *   buttons have different consequences and a typed-confirmation gate on the
 *   second, so this composes raw `<button>` markup directly rather than
 *   `ModalFooter`. Preserved verbatim from the renderer.
 * - Typed-confirmation gate: the second destructive action requires the user
 *   to retype `agentName` into the body input before the button enables.
 * - `width={540}` (vs ConfirmModal's default 450) to fit the working-directory
 *   path display and the longer destructive button label.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { useRef, useCallback, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';

interface DeleteAgentConfirmModalProps {
	theme: Theme;
	agentName: string;
	workingDirectory: string;
	onConfirm: () => void;
	onConfirmAndErase: () => void;
	onClose: () => void;
}

export function DeleteAgentConfirmModal({
	theme,
	agentName,
	workingDirectory,
	onConfirm,
	onConfirmAndErase,
	onClose,
}: DeleteAgentConfirmModalProps) {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);
	const [confirmationText, setConfirmationText] = useState('');
	const isEraseEnabled = confirmationText === agentName;

	const handleConfirm = useCallback(() => {
		onConfirm();
		onClose();
	}, [onConfirm, onClose]);

	const handleConfirmAndErase = useCallback(() => {
		onConfirmAndErase();
		onClose();
	}, [onConfirmAndErase, onClose]);

	// Stop Enter key propagation to prevent parent handlers from triggering after modal closes
	const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
		if (e.key === 'Enter') {
			e.stopPropagation();
			action();
		}
	};

	return (
		<Modal
			theme={theme}
			title="Confirm Delete"
			priority={MODAL_PRIORITIES.CONFIRM}
			onClose={onClose}
			headerIcon={<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />}
			width={540}
			zIndex={10000}
			initialFocusRef={confirmButtonRef}
			footer={
				<div className="flex gap-2 w-full flex-nowrap">
					<button
						type="button"
						onClick={onClose}
						onKeyDown={(e) => handleKeyDown(e, onClose)}
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
						onKeyDown={(e) => handleKeyDown(e, handleConfirm)}
						className="px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap"
						style={{
							backgroundColor: `${theme.colors.error}99`,
							color: '#ffffff',
						}}
					>
						Agent Only
					</button>
					<button
						type="button"
						onClick={isEraseEnabled ? handleConfirmAndErase : undefined}
						onKeyDown={isEraseEnabled ? (e) => handleKeyDown(e, handleConfirmAndErase) : undefined}
						disabled={!isEraseEnabled}
						className={`px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap ${
							!isEraseEnabled ? 'opacity-50 cursor-not-allowed' : ''
						}`}
						style={{
							backgroundColor: theme.colors.error,
							color: '#ffffff',
						}}
					>
						Agent + Working Directory
					</button>
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
						<strong style={{ color: theme.colors.warning }}>Danger:</strong> You are about to delete
						the agent "{agentName}". This action cannot be undone.
					</p>
					<p className="text-sm leading-relaxed" style={{ color: theme.colors.textDim }}>
						<strong>Agent + Working Directory</strong> will also move the working directory to the
						trash:
					</p>
					<code
						className="block text-xs px-2 py-1 rounded break-all"
						style={{
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textDim,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{workingDirectory}
					</code>
					<p className="text-xs leading-relaxed" style={{ color: theme.colors.textDim }}>
						Enter agent name below to enable working directory deletion:
					</p>
					<input
						type="text"
						value={confirmationText}
						onChange={(e) => setConfirmationText(e.target.value)}
						placeholder=""
						className="block w-full text-sm px-3 py-2 rounded outline-none focus:ring-2 focus:ring-offset-1"
						style={{
							backgroundColor: theme.colors.bgMain,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
						aria-label="Confirm agent name"
					/>
				</div>
			</div>
		</Modal>
	);
}
