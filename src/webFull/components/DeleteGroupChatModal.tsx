/**
 * DeleteGroupChatModal
 *
 * Lifted from src/renderer/components/DeleteGroupChatModal.tsx as part of the
 * Layer 2.5 leaf-parade wave (batch #2 per Architect plan-reeval-3 audit).
 * Implementation is verbatim except for the import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 * - `Modal` / `ModalFooter` resolve from `./ui/Modal` exactly as in the
 *   renderer; both files keep the same relative path to the primitive.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.3+L2.4 lifts
 * (RenameTabModal, ResetTasksConfirmModal, PlaybookNameModal, CreateGroupModal).
 * Callers in webFull call `const { theme } = useTheme()` at the
 * feature-component level and thread it down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. `lucide-react`
 * (`AlertTriangle`, `Trash2`) is already a transitive dep used by L2.1 Modal /
 * Settings / ConfirmModal.
 */

import { useRef, useCallback } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';

interface DeleteGroupChatModalProps {
	theme: Theme;
	isOpen: boolean;
	groupChatName: string;
	onClose: () => void;
	onConfirm: () => void;
}

export function DeleteGroupChatModal({
	theme,
	isOpen,
	groupChatName,
	onClose,
	onConfirm,
}: DeleteGroupChatModalProps): JSX.Element | null {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);

	const handleConfirm = useCallback(() => {
		onConfirm();
		onClose();
	}, [onConfirm, onClose]);

	if (!isOpen) return null;

	return (
		<Modal
			theme={theme}
			title="Delete Group Chat"
			priority={MODAL_PRIORITIES.DELETE_GROUP_CHAT}
			onClose={onClose}
			headerIcon={<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />}
			width={450}
			initialFocusRef={confirmButtonRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleConfirm}
					confirmLabel="Delete"
					destructive
					confirmButtonRef={confirmButtonRef}
				/>
			}
		>
			<div className="flex gap-4">
				<div
					className="flex-shrink-0 p-2 rounded-full h-fit"
					style={{ backgroundColor: `${theme.colors.error}20` }}
				>
					<AlertTriangle className="w-5 h-5" style={{ color: theme.colors.error }} />
				</div>
				<div>
					<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
						Are you sure you want to delete <strong>"{groupChatName}"</strong>?
					</p>
					<p className="text-sm leading-relaxed mt-2" style={{ color: theme.colors.textDim }}>
						This will permanently delete the group chat and all its messages. Participant sessions
						will not be affected.
					</p>
				</div>
			</div>
		</Modal>
	);
}
