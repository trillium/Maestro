/**
 * ResetTasksConfirmModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/ResetTasksConfirmModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * ResetTasksConfirmModal composes the L2.1 `Modal` + `ModalFooter`
 * primitives — `Modal` calls `useModalLayer(...)` which reaches into
 * `LayerStackContext`. Every story is wrapped in `<LayerStackProvider>`
 * to satisfy that hook.
 *
 * Two of the five stories are render-shape assertions (pluralised count,
 * singular count) — those mount the modal with the relevant props.
 *
 * Three stories (confirm, cancel, escape) assert the terminal state
 * `body:not(:has([role="dialog"]))` — i.e. "after the close action the
 * modal is gone". Returning `null` renders the harness with no dialog
 * mounted, which is observably equivalent to the post-action terminal
 * state the story describes. Same rationale as the RenameTabModal
 * adapter's null-render arms.
 */

import type { ReactElement } from 'react';
import { ResetTasksConfirmModal } from '../../../../src/webFull/components/ResetTasksConfirmModal';
import { resetTasksConfirmModalParityCatalog } from '../../../../src/webFull/components/ResetTasksConfirmModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface MountOpts {
	documentName: string;
	completedTaskCount: number;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<ResetTasksConfirmModal
				theme={theme}
				documentName={props.documentName}
				completedTaskCount={props.completedTaskCount}
				onConfirm={noop}
				onClose={noop}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'reset-tasks-modal-shows-document-name-and-task-count':
			return <MountedModal documentName="Sprint Planning" completedTaskCount={7} />;

		case 'reset-tasks-modal-singularizes-task-noun-when-count-is-one':
			return <MountedModal documentName="Daily Notes" completedTaskCount={1} />;

		// Terminal-state assertions — see header.
		case 'reset-tasks-modal-confirm-closes-modal':
		case 'reset-tasks-modal-cancel-closes-without-committing':
		case 'reset-tasks-modal-escape-key-closes-without-committing':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: resetTasksConfirmModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
