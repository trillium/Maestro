/**
 * PlaybookDeleteConfirmModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/PlaybookDeleteConfirmModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * PlaybookDeleteConfirmModal composes the L2.1 `Modal` + `ModalFooter`
 * primitives — `Modal` calls `useModalLayer(...)` which reaches into
 * `LayerStackContext`. Every story is wrapped in `<LayerStackProvider>`
 * to satisfy that hook.
 *
 * Two of the five stories are render-shape assertions (destructive chrome
 * + Delete button, named-playbook prompt + irreversibility warning) —
 * those mount the modal with the relevant props.
 *
 * Three stories (confirm, cancel, escape) assert the terminal state
 * `body:not(:has([role="dialog"]))` — i.e. "after the close action the
 * modal is gone". Returning `null` renders the harness with no dialog
 * mounted, which is observably equivalent to the post-action terminal
 * state the story describes. Same rationale as the RenameTabModal /
 * ResetTasksConfirmModal adapter null-render arms.
 */

import type { ReactElement } from 'react';
import { PlaybookDeleteConfirmModal } from '../../../../src/webFull/components/PlaybookDeleteConfirmModal';
import { playbookDeleteConfirmModalParityCatalog } from '../../../../src/webFull/components/PlaybookDeleteConfirmModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface MountOpts {
	playbookName: string;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<PlaybookDeleteConfirmModal
				theme={theme}
				playbookName={props.playbookName}
				onConfirm={noop}
				onCancel={noop}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'playbook-delete-confirm-modal-shows-destructive-title-and-button':
		case 'playbook-delete-confirm-modal-names-the-playbook-and-warns':
			return <MountedModal playbookName="Morning Routine" />;

		// Terminal-state assertions — see header.
		case 'playbook-delete-confirm-modal-confirm-closes-modal':
		case 'playbook-delete-confirm-modal-cancel-closes-without-deleting':
		case 'playbook-delete-confirm-modal-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: playbookDeleteConfirmModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
