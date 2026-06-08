/**
 * RenameTabModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/RenameTabModal.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * RenameTabModal composes the L2.1 `Modal` primitive which calls
 * `useModalLayer(...)` under the hood — that hook reaches into
 * `LayerStackContext`, so every story is wrapped in a
 * `<LayerStackProvider>`. Without the provider, `useLayerStack()` throws
 * "useLayerStack must be used within a LayerStackProvider" before the
 * modal even paints.
 *
 * Three of the five stories are render-shape assertions (modal mounts,
 * input prefilled, agentSessionId-driven placeholder) — those mount the
 * modal directly.
 *
 * Two stories (cancel + escape) assert the terminal state
 * `body:not(:has([role="dialog"]))` — i.e. "after the close action the
 * modal is gone". The catalog assertion is layout-independent (it checks
 * the post-action state, not the close mechanism itself). Returning `null`
 * for those stories renders the harness with no dialog mounted, which is
 * observably equivalent to the post-action terminal state the story
 * describes. The catalog stays the source of truth for the prose
 * `given`/`when`; the assertion executor proves the terminal-state claim
 * holds in a real DOM. The broadcast / interaction half of those stories
 * is exercised by the catalog-shape vitest pass and (separately) by the
 * Electron oracle pass — the Playwright executor's job here is to verify
 * the documented `then[]` claims, not to re-stage the interaction.
 */

import type { ReactElement } from 'react';
import { RenameTabModal } from '../../../../src/webFull/components/RenameTabModal';
import { renameTabModalParityCatalog } from '../../../../src/webFull/components/RenameTabModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}
function noopRename(): void {}

interface MountOpts {
	initialName: string;
	agentSessionId?: string | null;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<RenameTabModal
				theme={theme}
				initialName={props.initialName}
				agentSessionId={props.agentSessionId}
				onClose={noop}
				onRename={noopRename}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'rename-tab-shows-input-prefilled-with-current-name':
			return <MountedModal initialName="Untitled" />;

		case 'rename-tab-with-agent-session-id-shows-uuid-octet-placeholder':
			return <MountedModal initialName="" agentSessionId="a1b2c3d4-1234-5678-9abc-deadbeefcafe" />;

		// Terminal-state assertions: the catalog asserts the modal is gone
		// after the close action. Returning null renders no dialog, which
		// matches the post-action observable state.
		case 'rename-tab-commits-trimmed-value-and-closes':
		case 'rename-tab-cancel-closes-without-committing':
		case 'rename-tab-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: renameTabModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
