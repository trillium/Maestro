/**
 * RenameGroupModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/RenameGroupModal.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * RenameGroupModal composes the L2.1 `Modal` + `ModalFooter` primitives.
 * `Modal` calls `useModalLayer(...)` which reaches into
 * `LayerStackContext`, so every render-mount story is wrapped in
 * `<LayerStackProvider>` — same pattern as the batch-3 confirmation
 * modals.
 *
 * Distinguishing prop shape: `groupName` and `groupEmoji` are CONTROLLED
 * — the caller owns the state and threads setters through. A small
 * `ControlledModal` wrapper holds `useState` for each so the modal can
 * react to the catalog's render-time discrimination:
 *  - shows-title-and-rename-button → `groupName="Backend"`,
 *    `groupEmoji="📂"`
 *  - prefills-current-name-and-emoji → same; the catalog asserts that
 *    the text-input and the emoji glyph reflect the initial state
 *  - empty-name-disables-rename-button → `groupName=""`,
 *    `groupEmoji="📂"`; the renderer evaluates `confirmDisabled =
 *    !groupName.trim()` and the Rename button renders with `[disabled]`
 *
 * Terminal-state close stories (3 of 6) — null-rendered (post-action
 * `body:not(:has([role="dialog"]))` holds against the empty root):
 *  - rename-with-valid-name-closes-modal
 *  - cancel-closes-without-renaming
 *  - escape-key-closes-modal
 */

import { useState, type ReactElement } from 'react';
import { RenameGroupModal } from '../../../../src/webFull/components/RenameGroupModal';
import { renameGroupModalParityCatalog } from '../../../../src/webFull/components/RenameGroupModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { Group } from '../../../../src/shared/types';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface ControlledMountOpts {
	initialName: string;
	initialEmoji: string;
}

function ControlledModal(props: ControlledMountOpts): ReactElement {
	const [groupName, setGroupName] = useState(props.initialName);
	const [groupEmoji, setGroupEmoji] = useState(props.initialEmoji);
	const [groups, setGroups] = useState<Group[]>([
		{
			id: 'g-1',
			name: props.initialName.toUpperCase(),
			emoji: props.initialEmoji,
			collapsed: false,
		},
	]);

	return (
		<LayerStackProvider>
			<RenameGroupModal
				theme={theme}
				groupId="g-1"
				groupName={groupName}
				setGroupName={setGroupName}
				groupEmoji={groupEmoji}
				setGroupEmoji={setGroupEmoji}
				onClose={noop}
				groups={groups}
				setGroups={setGroups}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'rename-group-modal-shows-title-and-rename-button':
		case 'rename-group-modal-prefills-current-name-and-emoji':
			return <ControlledModal initialName="Backend" initialEmoji="📂" />;

		case 'rename-group-modal-empty-name-disables-rename-button':
			return <ControlledModal initialName="" initialEmoji="📂" />;

		// Terminal-state assertions — see header.
		case 'rename-group-modal-rename-with-valid-name-closes-modal':
		case 'rename-group-modal-cancel-closes-without-renaming':
		case 'rename-group-modal-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: renameGroupModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
