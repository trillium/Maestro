/**
 * CreateGroupModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/CreateGroupModal.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * CreateGroupModal composes the L2.1 `Modal` + `ModalFooter` primitives.
 * `Modal` calls `useModalLayer(...)` under the hood which reaches into
 * `LayerStackContext`, so every render-mount story is wrapped in
 * `<LayerStackProvider>` — same pattern as the batch-3 confirmation
 * modals.
 *
 * Two of the five stories are render-shape assertions on an open modal:
 *  - shows-title-and-create-button (header / Create button label / Group
 *    Name label + input)
 *  - defaults-to-open-folder-emoji (📂 glyph present in the
 *    EmojiPickerField)
 *
 * The remaining three stories assert the terminal closed state
 * `body:not(:has([role="dialog"]))` — create-with-valid-name, cancel,
 * escape. Returning `null` for those stories renders no dialog, which
 * matches the post-action terminal state the story describes. Same
 * null-render pattern as every batch-3 confirmation modal adapter.
 *
 * `setGroups` and `onClose` are noops — the catalog asserts the dialog
 * chrome / observable behaviour, not the caller-side persistence.
 */

import type { Dispatch, ReactElement, SetStateAction } from 'react';
import { CreateGroupModal } from '../../../../src/webFull/components/CreateGroupModal';
import { createGroupModalParityCatalog } from '../../../../src/webFull/components/CreateGroupModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { Group } from '../../../../src/shared/types';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}
const noopSetGroups: Dispatch<SetStateAction<Group[]>> = () => {};

function MountedModal(): ReactElement {
	return (
		<LayerStackProvider>
			<CreateGroupModal theme={theme} onClose={noop} groups={[]} setGroups={noopSetGroups} />
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'create-group-modal-shows-title-and-create-button':
		case 'create-group-modal-defaults-to-open-folder-emoji':
			return <MountedModal />;

		// Terminal-state assertions — see header.
		case 'create-group-modal-create-with-valid-name-closes-modal':
		case 'create-group-modal-cancel-closes-without-creating':
		case 'create-group-modal-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: createGroupModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
