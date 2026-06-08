/**
 * RenameGroupModal
 *
 * Lifted from src/renderer/components/RenameGroupModal.tsx as part of the
 * Layer 2.5 leaf-component wave (leaf-parade batch #4). Implementation is
 * verbatim except for the import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes
 *   through `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `Group` resolves directly from `src/shared/types` (already exported there
 *   as the single source of truth; renderer types/index.ts re-exports it).
 *   The leaf-hunt's "blocked-on-infra" note for `Group` was found stale during
 *   the L2.4 CreateGroupModal lift — same applies here. No type-ownership
 *   change required.
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer to prevent
 *   silent drift).
 * - The renderer composes its imports through `./ui` (a barrel). webFull does
 *   not currently maintain a `components/ui/index.ts` barrel, so the imports
 *   are split into three direct module paths instead. Pure plumbing change —
 *   no behavior diff. Same precedent as L2.4 CreateGroupModal.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.3/L2.4 lifts
 * (RenameTabModal, CreateGroupModal). Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and thread it
 * down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { useRef } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { Group } from '../../shared/types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';
import { EmojiPickerField } from './ui/EmojiPickerField';

interface RenameGroupModalProps {
	theme: Theme;
	groupId: string;
	groupName: string;
	setGroupName: (name: string) => void;
	groupEmoji: string;
	setGroupEmoji: (emoji: string) => void;
	onClose: () => void;
	groups: Group[];
	setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
}

export function RenameGroupModal(props: RenameGroupModalProps) {
	const {
		theme,
		groupId,
		groupName,
		setGroupName,
		groupEmoji,
		setGroupEmoji,
		onClose,
		groups: _groups,
		setGroups,
	} = props;

	const inputRef = useRef<HTMLInputElement>(null);

	const handleRename = () => {
		if (groupName.trim() && groupId) {
			setGroups((prev) =>
				prev.map((g) =>
					g.id === groupId ? { ...g, name: groupName.trim().toUpperCase(), emoji: groupEmoji } : g
				)
			);
			onClose();
		}
	};

	return (
		<Modal
			theme={theme}
			title="Rename Group"
			priority={MODAL_PRIORITIES.RENAME_GROUP}
			onClose={onClose}
			initialFocusRef={inputRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleRename}
					confirmLabel="Rename"
					confirmDisabled={!groupName.trim()}
				/>
			}
		>
			<div className="flex gap-4 items-end">
				{/* Emoji Selector - Left Side */}
				<EmojiPickerField
					theme={theme}
					value={groupEmoji}
					onChange={setGroupEmoji}
					restoreFocusRef={inputRef}
				/>

				{/* Group Name Input - Right Side */}
				<div className="flex-1">
					<FormInput
						ref={inputRef}
						theme={theme}
						label="Group Name"
						value={groupName}
						onChange={setGroupName}
						onSubmit={handleRename}
						placeholder="Enter group name..."
						heightClass="h-[52px]"
						autoFocus
					/>
				</div>
			</div>
		</Modal>
	);
}
