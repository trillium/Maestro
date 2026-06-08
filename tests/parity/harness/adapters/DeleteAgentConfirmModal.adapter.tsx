/**
 * DeleteAgentConfirmModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/DeleteAgentConfirmModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * DeleteAgentConfirmModal composes the L2.1 `Modal` primitive (NOT
 * `ModalFooter` — it builds its own three-button footer row to fit the
 * typed-confirmation gate on the destructive
 * "Agent + Working Directory" action). `Modal` calls `useModalLayer(...)`
 * under the hood which reaches into `LayerStackContext`, so every
 * render-mount story is wrapped in `<LayerStackProvider>`.
 *
 * Render-mount stories (5 of 8):
 *  - shows-agent-name-and-working-directory (title + agentName + cwd +
 *    cannot-be-undone copy)
 *  - renders-three-button-footer (Cancel / Agent Only /
 *    Agent + Working Directory labels + confirmation input aria-label)
 *  - erase-disabled-when-confirmation-text-empty (modal stays open;
 *    destructive label still rendered, gate keeps button disabled)
 *  - erase-disabled-when-confirmation-text-mismatches (modal stays open
 *    — only that the dialog is still present)
 *
 * Terminal-state close stories (3 of 8) — null-rendered (post-action
 * `body:not(:has([role="dialog"]))` holds against the empty root):
 *  - agent-only-click-closes-modal
 *  - erase-enabled-after-typing-agent-name (closes after the typed-text
 *    matches agentName and the destructive button fires)
 *  - cancel-closes-without-committing
 *  - escape-key-closes-without-committing
 */

import type { ReactElement } from 'react';
import { DeleteAgentConfirmModal } from '../../../../src/webFull/components/DeleteAgentConfirmModal';
import { deleteAgentConfirmModalParityCatalog } from '../../../../src/webFull/components/DeleteAgentConfirmModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface MountOpts {
	agentName: string;
	workingDirectory: string;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<DeleteAgentConfirmModal
				theme={theme}
				agentName={props.agentName}
				workingDirectory={props.workingDirectory}
				onConfirm={noop}
				onConfirmAndErase={noop}
				onClose={noop}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'delete-agent-modal-shows-agent-name-and-working-directory':
			return (
				<MountedModal agentName="graph-fixer" workingDirectory="/Users/dev/code/graph-fixer" />
			);

		case 'delete-agent-modal-renders-three-button-footer':
		case 'delete-agent-modal-erase-disabled-when-confirmation-text-empty':
		case 'delete-agent-modal-erase-disabled-when-confirmation-text-mismatches':
			return <MountedModal agentName="my-agent" workingDirectory="/tmp/x" />;

		// Terminal-state assertions — see header.
		case 'delete-agent-modal-agent-only-click-closes-modal':
		case 'delete-agent-modal-erase-enabled-after-typing-agent-name':
		case 'delete-agent-modal-cancel-closes-without-committing':
		case 'delete-agent-modal-escape-key-closes-without-committing':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: deleteAgentConfirmModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
