/**
 * RenameTabModal
 *
 * Lifted from src/renderer/components/RenameTabModal.tsx as part of the
 * Layer 2.3 leaf-component wave. Implementation is verbatim except for two
 * import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes through
 *   `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives. Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and thread it
 * down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { memo, useRef, useState } from 'react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';

interface RenameTabModalProps {
	theme: Theme;
	initialName: string;
	agentSessionId?: string | null;
	onClose: () => void;
	onRename: (newName: string) => void;
}

export const RenameTabModal = memo(function RenameTabModal(props: RenameTabModalProps) {
	const { theme, initialName, agentSessionId, onClose, onRename } = props;
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(initialName);

	// Generate placeholder with UUID octet if available
	const placeholder = agentSessionId
		? `Rename ${agentSessionId.split('-')[0].toUpperCase()}...`
		: 'Enter tab name...';

	const handleRename = () => {
		onRename(value.trim());
		onClose();
	};

	return (
		<Modal
			theme={theme}
			title="Rename Tab"
			priority={MODAL_PRIORITIES.RENAME_TAB}
			onClose={onClose}
			width={400}
			initialFocusRef={inputRef as React.RefObject<HTMLElement>}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleRename}
					confirmLabel="Rename"
				/>
			}
		>
			<FormInput
				ref={inputRef}
				theme={theme}
				value={value}
				onChange={setValue}
				onSubmit={handleRename}
				placeholder={placeholder}
			/>
		</Modal>
	);
});
