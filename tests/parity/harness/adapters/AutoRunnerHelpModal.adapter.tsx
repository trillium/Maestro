/**
 * AutoRunnerHelpModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/AutoRunnerHelpModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * AutoRunnerHelpModal composes the L2.1 `Modal` primitive — `Modal`
 * calls `useModalLayer(...)` which reaches into `LayerStackContext`.
 * Every render-mount story is wrapped in `<LayerStackProvider>` to
 * satisfy that hook (same pattern as the batch-3 confirmation modals
 * and the sibling HistoryHelpModal in this batch).
 *
 * Five catalog stories assert the open dialog chrome / body / sections
 * and one negative-path render-mount story
 * (`does-not-render-action-buttons-beyond-got-it`) shares the open
 * arm. Three terminal-state stories
 * (`got-it-button-closes-modal`, `escape-key-closes-modal`,
 * `backdrop-click-closes-modal`) assert
 * `body:not(:has([role="dialog"]))` — those arms return `null`. The
 * `keyboard-shortcut-rows-render-without-platform-bridge` story is a
 * webFull-runtime-only pin (the shim swaps the renderer's
 * `window.maestro.platform` for `navigator.userAgent`); it renders the
 * open modal and asserts the shortcut tutor rows render.
 */

import type { ReactElement } from 'react';
import { AutoRunnerHelpModal } from '../../../../src/webFull/components/AutoRunnerHelpModal';
import { autoRunnerHelpModalParityCatalog } from '../../../../src/webFull/components/AutoRunnerHelpModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

function MountedModal(): ReactElement {
	return (
		<LayerStackProvider>
			<AutoRunnerHelpModal theme={theme} onClose={noop} />
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'autorunner-help-modal-shows-title-and-got-it-button':
		case 'autorunner-help-modal-renders-core-documentation-sections':
		case 'autorunner-help-modal-renders-advanced-feature-sections':
		case 'autorunner-help-modal-surfaces-playbook-concept-inline':
		case 'autorunner-help-modal-renders-keyboard-shortcut-tutor-labels':
		case 'autorunner-help-modal-does-not-render-action-buttons-beyond-got-it':
		case 'autorunner-help-modal-keyboard-shortcut-rows-render-without-platform-bridge':
			return <MountedModal />;

		// Terminal-state assertions — render nothing.
		case 'autorunner-help-modal-got-it-button-closes-modal':
		case 'autorunner-help-modal-escape-key-closes-modal':
		case 'autorunner-help-modal-backdrop-click-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: autoRunnerHelpModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
