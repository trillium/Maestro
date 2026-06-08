/**
 * CreateGroupModal
 *
 * Lifted from src/renderer/components/CreateGroupModal.tsx as part of the
 * Layer 2.4 leaf-component wave. Implementation is verbatim except for the
 * import paths:
 * - `Theme` now resolves from `src/shared/theme-types` (renderer routes
 *   through `src/renderer/types/index.ts`; webFull imports the type directly).
 * - `Group` resolves directly from `src/shared/types` (already exported there
 *   as the single source of truth; renderer types/index.ts re-exports it).
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08 audit
 *   risk A — non-divergent constants stay re-exported from renderer).
 * - `generateId` resolves via the webFull re-export at
 *   `src/webFull/utils/ids.ts` (same drift-prevention rationale).
 * - The renderer composes its imports through `./ui` (a barrel). webFull does
 *   not currently maintain a `components/ui/index.ts` barrel, so the imports
 *   are split into the three direct module paths instead. Pure plumbing
 *   change — no behavior diff.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.3 lifts
 * (RenameTabModal). Callers in webFull call `const { theme } = useTheme()` at
 * the feature-component level and thread it down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { useState, useRef } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { Group } from '../../shared/types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';
import { EmojiPickerField } from './ui/EmojiPickerField';
import { generateId } from '../utils/ids';

interface CreateGroupModalProps {
	theme: Theme;
	onClose: () => void;
	groups: Group[];
	setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
	onGroupCreated?: (groupId: string) => void; // Optional callback when group is created
}

export function CreateGroupModal(props: CreateGroupModalProps) {
	const { theme, onClose, groups, setGroups, onGroupCreated } = props;

	const [groupName, setGroupName] = useState('');
	const [groupEmoji, setGroupEmoji] = useState('📂');

	const inputRef = useRef<HTMLInputElement>(null);

	const handleCreate = () => {
		const trimmedGroupName = groupName.trim();
		const newGroupId = `group-${generateId()}`;
		const newGroup: Group = {
			id: newGroupId,
			name: trimmedGroupName.toUpperCase(),
			emoji: groupEmoji,
			collapsed: false,
		};
		setGroups([...groups, newGroup]);

		// Call callback with new group ID if provided
		if (onGroupCreated) {
			onGroupCreated(newGroupId);
		}

		setGroupName('');
		setGroupEmoji('📂');
		onClose();
	};

	return (
		<Modal
			theme={theme}
			title="Create New Group"
			priority={MODAL_PRIORITIES.CREATE_GROUP}
			onClose={onClose}
			initialFocusRef={inputRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleCreate}
					confirmLabel="Create"
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
						onSubmit={groupName.trim() ? handleCreate : undefined}
						placeholder="Enter group name..."
						heightClass="h-[52px]"
						autoFocus
					/>
				</div>
			</div>
		</Modal>
	);
}
