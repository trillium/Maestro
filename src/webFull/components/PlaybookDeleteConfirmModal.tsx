/**
 * PlaybookDeleteConfirmModal
 *
 * Lifted from src/renderer/components/PlaybookDeleteConfirmModal.tsx as part of
 * the Layer 2.5 leaf-parade wave. Implementation is verbatim except for two
 * import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.4 lifts
 * (ResetTasksConfirmModal, PlaybookNameModal). Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and thread it
 * down.
 *
 * Direct sibling of PlaybookNameModal (L2.4): same ConfirmModal-shape
 * composition over Modal + ModalFooter, same prop-threaded theme, same
 * destructive-action surface.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useRef } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';

interface PlaybookDeleteConfirmModalProps {
	theme: Theme;
	playbookName: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export function PlaybookDeleteConfirmModal({
	theme,
	playbookName,
	onConfirm,
	onCancel,
}: PlaybookDeleteConfirmModalProps) {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);

	const handleConfirmClick = () => {
		onConfirm();
		onCancel(); // Close the modal after confirming
	};

	return (
		<Modal
			theme={theme}
			title="Delete Playbook"
			priority={MODAL_PRIORITIES.PLAYBOOK_DELETE_CONFIRM}
			onClose={onCancel}
			headerIcon={<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />}
			zIndex={10000}
			initialFocusRef={confirmButtonRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onCancel}
					onConfirm={handleConfirmClick}
					confirmLabel="Delete"
					destructive
					confirmButtonRef={confirmButtonRef}
				/>
			}
			layerOptions={{
				blocksLowerLayers: true,
				capturesFocus: true,
				focusTrap: 'strict',
			}}
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
						Are you sure you want to delete "<strong>{playbookName}</strong>"?
					</p>
					<p className="text-sm mt-2" style={{ color: theme.colors.textDim }}>
						This cannot be undone.
					</p>
				</div>
			</div>
		</Modal>
	);
}
