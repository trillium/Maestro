/**
 * PlaybookNameModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/PlaybookNameModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * PlaybookNameModal composes the L2.1 `Modal` + `ModalFooter` primitives.
 * `Modal` calls `useModalLayer(...)` under the hood which reaches into
 * `LayerStackContext`, so every render-mount story is wrapped in
 * `<LayerStackProvider>`.
 *
 * Render-mount stories (2 of 5):
 *  - shows-default-title-and-button (default props: title=`Save
 *    Playbook`, saveButtonText=`Save`, helper text + input placeholder)
 *  - prefills-input-with-initial-name (rename mode: title=`Rename
 *    Playbook`, saveButtonText=`Rename`, initialName=`Morning Routine`
 *    — the input's `value` reflects the initial name)
 *
 * Terminal-state close stories (3 of 5) — null-rendered (post-action
 * `body:not(:has([role="dialog"]))` holds against the empty root):
 *  - save-with-valid-name-closes-modal
 *  - cancel-closes-without-saving
 *  - escape-key-closes-modal
 */

import type { ReactElement } from 'react';
import { PlaybookNameModal } from '../../../../src/webFull/components/PlaybookNameModal';
import { playbookNameModalParityCatalog } from '../../../../src/webFull/components/PlaybookNameModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}
function noopSave(): void {}

interface MountOpts {
	initialName?: string;
	title?: string;
	saveButtonText?: string;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<PlaybookNameModal
				theme={theme}
				onSave={noopSave}
				onCancel={noop}
				initialName={props.initialName}
				title={props.title}
				saveButtonText={props.saveButtonText}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'playbook-name-modal-shows-default-title-and-button':
			return <MountedModal />;

		case 'playbook-name-modal-prefills-input-with-initial-name':
			return (
				<MountedModal
					initialName="Morning Routine"
					title="Rename Playbook"
					saveButtonText="Rename"
				/>
			);

		// Terminal-state assertions — see header.
		case 'playbook-name-modal-save-with-valid-name-closes-modal':
		case 'playbook-name-modal-cancel-closes-without-saving':
		case 'playbook-name-modal-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: playbookNameModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
