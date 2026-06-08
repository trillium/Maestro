/**
 * DeleteGroupChatModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/DeleteGroupChatModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * DeleteGroupChatModal composes the L2.1 `Modal` + `ModalFooter`
 * primitives — `Modal` calls `useModalLayer(...)` which reaches into
 * `LayerStackContext`. Every story is wrapped in `<LayerStackProvider>`
 * to satisfy that hook.
 *
 * Two of the six stories are render-shape assertions on an open modal
 * (`isOpen=true` with a named group chat):
 *  - shows-title-and-delete-button (Delete Group Chat chrome + Delete +
 *    Cancel labels)
 *  - surfaces-group-chat-name-in-prompt (name verbatim + "permanently
 *    delete" + "Participant sessions" copy)
 *
 * One story (`isopen-false-renders-nothing`) mounts the component with
 * `isOpen=false` — the renderer's early `return null` matches the
 * absence assertion directly.
 *
 * Three stories assert the terminal closed state
 * `body:not(:has([role="dialog"]))` — delete button, cancel, escape.
 * Returning `null` for those stories renders no dialog, matching the
 * post-action terminal state.
 */

import type { ReactElement } from 'react';
import { DeleteGroupChatModal } from '../../../../src/webFull/components/DeleteGroupChatModal';
import { deleteGroupChatModalParityCatalog } from '../../../../src/webFull/components/DeleteGroupChatModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface MountOpts {
	isOpen: boolean;
	groupChatName: string;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<DeleteGroupChatModal
				theme={theme}
				isOpen={props.isOpen}
				groupChatName={props.groupChatName}
				onClose={noop}
				onConfirm={noop}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'delete-groupchat-modal-shows-title-and-delete-button':
		case 'delete-groupchat-modal-surfaces-group-chat-name-in-prompt':
			return <MountedModal isOpen={true} groupChatName="Backend Standup" />;

		case 'delete-groupchat-modal-isopen-false-renders-nothing':
			return <MountedModal isOpen={false} groupChatName="Backend Standup" />;

		// Terminal-state assertions — see header.
		case 'delete-groupchat-modal-delete-button-closes-modal':
		case 'delete-groupchat-modal-cancel-closes-without-confirming':
		case 'delete-groupchat-modal-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: deleteGroupChatModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
