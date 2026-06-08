/**
 * PlaybookNameModal
 *
 * Lifted from src/renderer/components/PlaybookNameModal.tsx as part of the
 * Layer 2.4 leaf-component wave. Implementation is verbatim except for two
 * import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.3 lifts
 * (RenameTabModal). Callers in webFull call `const { theme } = useTheme()` at
 * the feature-component level and thread it down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useState, useRef, useEffect } from 'react';
import { Save } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';

interface PlaybookNameModalProps {
	theme: Theme;
	onSave: (name: string) => void;
	onCancel: () => void;
	/** Optional initial name for editing existing playbook */
	initialName?: string;
	/** Title shown in the modal header */
	title?: string;
	/** Button text for the save action */
	saveButtonText?: string;
}

export function PlaybookNameModal({
	theme,
	onSave,
	onCancel,
	initialName = '',
	title = 'Save Playbook',
	saveButtonText = 'Save',
}: PlaybookNameModalProps) {
	const [name, setName] = useState(initialName);
	const inputRef = useRef<HTMLInputElement>(null);

	// Auto-focus the input on mount and select text if there's an initial name
	useEffect(() => {
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			if (initialName) {
				inputRef.current?.select();
			}
		});
	}, [initialName]);

	const handleSave = () => {
		const trimmedName = name.trim();
		if (trimmedName) {
			onSave(trimmedName);
		}
	};

	const isValid = name.trim().length > 0;

	return (
		<Modal
			theme={theme}
			title={title}
			priority={MODAL_PRIORITIES.PLAYBOOK_NAME}
			onClose={onCancel}
			headerIcon={<Save className="w-4 h-4" style={{ color: theme.colors.accent }} />}
			initialFocusRef={inputRef as React.RefObject<HTMLElement>}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onCancel}
					onConfirm={handleSave}
					confirmLabel={saveButtonText}
					confirmDisabled={!isValid}
				/>
			}
		>
			<FormInput
				ref={inputRef}
				theme={theme}
				label="Playbook Name"
				value={name}
				onChange={setName}
				onSubmit={handleSave}
				submitEnabled={isValid}
				placeholder="Enter playbook name..."
				helperText="Give your playbook a descriptive name to easily identify it later."
			/>
		</Modal>
	);
}
