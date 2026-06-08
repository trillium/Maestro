/**
 * HistoryHelpModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/HistoryHelpModal.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * HistoryHelpModal composes the L2.1 `Modal` primitive — `Modal` calls
 * `useModalLayer(...)` which reaches into `LayerStackContext`. Every
 * render-mount story is wrapped in `<LayerStackProvider>` to satisfy
 * that hook (same pattern as the batch-3 confirmation modals).
 *
 * The catalog has four render-mount stories that assert the open dialog
 * chrome / body / footer / sections, and four terminal-state stories
 * (`got-it-button-closes-modal`, `escape-key-closes-modal`,
 * `backdrop-click-closes-modal`, `emits-no-ipc-or-wire-traffic`) that
 * assert `body:not(:has([role="dialog"]))`. The terminal-state arms
 * return `null` — observably equivalent to the post-action state. Same
 * null-render pattern as every batch-3 confirmation modal adapter.
 *
 * One catalog story (`does-not-render-confirm-or-cancel-controls`) is a
 * negative-path render-mount that pins the affirmative "Got it" label —
 * it shares the open-modal arm with the chrome stories.
 */

import type { ReactElement } from 'react';
import { HistoryHelpModal } from '../../../../src/webFull/components/HistoryHelpModal';
import { historyHelpModalParityCatalog } from '../../../../src/webFull/components/HistoryHelpModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

function MountedModal(): ReactElement {
	return (
		<LayerStackProvider>
			<HistoryHelpModal theme={theme} onClose={noop} />
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'history-help-modal-shows-title-and-dismissal-button':
		case 'history-help-modal-renders-entry-type-and-status-sections':
		case 'history-help-modal-renders-feature-walkthrough-sections':
		case 'history-help-modal-does-not-render-confirm-or-cancel-controls':
			return <MountedModal />;

		// Terminal-state assertions — render nothing; the absence selector
		// `body:not(:has([role="dialog"]))` matches the empty harness root.
		case 'history-help-modal-got-it-button-closes-modal':
		case 'history-help-modal-escape-key-closes-modal':
		case 'history-help-modal-backdrop-click-closes-modal':
		case 'history-help-modal-emits-no-ipc-or-wire-traffic-during-lifecycle':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: historyHelpModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
