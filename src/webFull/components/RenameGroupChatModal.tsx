/**
 * RenameGroupChatModal
 *
 * Lifted from src/renderer/components/RenameGroupChatModal.tsx as part of the
 * Layer 2.5 leaf-component lift wave (leaf-parade batch #3). Implementation is
 * verbatim except for two import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly), matching
 *   the L2.1 Modal/FormInput primitive convention and the L2.3 RenameTabModal
 *   precedent.
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 *
 * Sibling to `RenameTabModal` (L2.3); reuses the same lifted `Modal` +
 * `ModalFooter` + `FormInput` primitives. Direct module imports (not the `./ui`
 * barrel) per the L2.4 plumbing decision — webFull does not maintain a
 * `src/webFull/components/ui/index.ts` barrel.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1+ lifted primitives. Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and thread it
 * down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useState, useRef, useEffect } from 'react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';

interface RenameGroupChatModalProps {
	theme: Theme;
	isOpen: boolean;
	currentName: string;
	onClose: () => void;
	onRename: (newName: string) => void;
}

export function RenameGroupChatModal({
	theme,
	isOpen,
	currentName,
	onClose,
	onRename,
}: RenameGroupChatModalProps): JSX.Element | null {
	const [name, setName] = useState(currentName);
	const inputRef = useRef<HTMLInputElement>(null);

	// Reset name when modal opens with new currentName
	useEffect(() => {
		if (isOpen) {
			setName(currentName);
		}
	}, [isOpen, currentName]);

	const handleRename = () => {
		if (name.trim() && name.trim() !== currentName) {
			onRename(name.trim());
			onClose();
		}
	};

	const canRename = name.trim().length > 0 && name.trim() !== currentName;

	if (!isOpen) return null;

	return (
		<Modal
			theme={theme}
			title="Rename Group Chat"
			priority={MODAL_PRIORITIES.RENAME_GROUP_CHAT}
			onClose={onClose}
			initialFocusRef={inputRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleRename}
					confirmLabel="Rename"
					confirmDisabled={!canRename}
				/>
			}
		>
			<FormInput
				ref={inputRef}
				theme={theme}
				label="Chat Name"
				value={name}
				onChange={setName}
				onSubmit={canRename ? handleRename : undefined}
				placeholder="Enter new name..."
				autoFocus
			/>
		</Modal>
	);
}
