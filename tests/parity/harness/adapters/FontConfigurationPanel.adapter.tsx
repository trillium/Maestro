/**
 * FontConfigurationPanel — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/FontConfigurationPanel.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * FontConfigurationPanel is a stateful UI primitive but the catalog
 * stories are render-shape oriented — they vary on the input prop
 * surface (fontsLoaded, fontLoading, customFonts, systemFonts) and
 * assert against the resulting select / optgroup / option / button /
 * input structure.
 *
 * All side-effect callbacks (`setFontFamily`, `onAddCustomFont`,
 * `onRemoveCustomFont`, `onFontInteraction`) are no-ops at the harness
 * boundary — the catalog uses backend verbs (`notificationFired`,
 * `broadcast`, `wsFrameMatches`) for the one story that pins the
 * "no IPC on pure render" contract; the executor auto-skips that.
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven values resolve deterministically. The catalog's assertions all
 * target tag names, attributes, and text — not inline-style values — so
 * the picked theme is cosmetic.
 */

import type { ReactElement } from 'react';
import { FontConfigurationPanel } from '../../../../src/webFull/components/FontConfigurationPanel';
import { fontConfigurationPanelParityCatalog } from '../../../../src/webFull/components/FontConfigurationPanel.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

// All side-effect callbacks (`setFontFamily`, `onAddCustomFont`,
// `onRemoveCustomFont`, `onFontInteraction`) are no-ops at the harness
// boundary — the catalog stories assert render shape only and never
// invoke them. We use a single `noop` for both signatures so the
// arity-mismatched ones still type-check.
const noop = ((): void => {}) as (...args: never[]) => void;

interface MountProps {
	fontFamily?: string;
	systemFonts?: string[];
	fontsLoaded?: boolean;
	fontLoading?: boolean;
	customFonts?: string[];
}

function Mount(props: MountProps): ReactElement {
	return (
		<FontConfigurationPanel
			fontFamily={props.fontFamily ?? 'Menlo'}
			setFontFamily={noop}
			systemFonts={props.systemFonts ?? ['Menlo', 'Monaco']}
			fontsLoaded={props.fontsLoaded ?? true}
			fontLoading={props.fontLoading ?? false}
			customFonts={props.customFonts ?? []}
			onAddCustomFont={noop}
			onRemoveCustomFont={noop}
			onFontInteraction={noop}
			theme={theme}
		/>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'font-configuration-panel-renders-interface-font-headline':
			return (
				<Mount
					fontFamily="Menlo"
					fontsLoaded={true}
					fontLoading={false}
					systemFonts={['Menlo', 'Monaco']}
					customFonts={[]}
				/>
			);

		case 'font-configuration-panel-renders-common-monospace-optgroup':
			return <Mount fontsLoaded={true} fontLoading={false} />;

		case 'font-configuration-panel-renders-custom-font-input-and-add-button':
			return <Mount fontLoading={false} />;

		case 'font-configuration-panel-renders-custom-fonts-optgroup-when-populated':
			return <Mount customFonts={['Cartograph CF']} fontLoading={false} />;

		case 'font-configuration-panel-suppresses-body-when-font-loading':
			return <Mount fontLoading={true} />;

		case 'font-configuration-panel-suppresses-custom-fonts-optgroup-when-empty':
			return <Mount customFonts={[]} fontLoading={false} />;

		case 'font-configuration-panel-does-not-render-its-own-modal':
			return <Mount />;

		case 'font-configuration-panel-no-ipc-no-ws-no-broadcast-on-pure-render':
			// Backend-verb story (`wsFrameMatches` / `broadcast` /
			// `notificationFired`). The executor auto-skips. Provide a render
			// so the switch stays exhaustive in case the executor's skip
			// logic is ever loosened.
			return <Mount fontsLoaded={true} fontLoading={false} customFonts={[]} systemFonts={[]} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: fontConfigurationPanelParityCatalog as ParityStory[],
	render,
};

export default adapter;
