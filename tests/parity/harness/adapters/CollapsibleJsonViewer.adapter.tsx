/**
 * CollapsibleJsonViewer — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/CollapsibleJsonViewer.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * CollapsibleJsonViewer is a pure presentational primitive — it owns a
 * per-node `isExpanded` boolean for chevron toggle and a `hovered`
 * boolean for the Copy affordance, but the catalog stories are all
 * render-shape oriented and assert against the initial paint with
 * `initialExpandLevel=2` (catalog default). No driver wrappers are
 * needed for any story.
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven `color` values resolve deterministically. The catalog's
 * assertions all target text and the per-node copy button — not
 * inline-style values — so the picked theme is cosmetic.
 *
 * The "truncates long strings" story takes a `maxStringLength=10` cap
 * and asserts the literal `...` ellipsis is present; we supply a 41-char
 * string so the truncation branch is exercised.
 */

import type { ReactElement } from 'react';
import { CollapsibleJsonViewer } from '../../../../src/webFull/components/CollapsibleJsonViewer';
import { collapsibleJsonViewerParityCatalog } from '../../../../src/webFull/components/CollapsibleJsonViewer.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

// 41-character string so `maxStringLength=10` truncates it. The catalog
// says "<41-char string>" as a placeholder — we materialise it here.
const LONG_STRING = 'this is a fairly long string for truncate';

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'collapsible-json-viewer-renders-object-root-with-curly-brackets':
			return (
				<CollapsibleJsonViewer
					data={{ name: 'alice', age: 30 }}
					theme={theme}
					initialExpandLevel={2}
				/>
			);

		case 'collapsible-json-viewer-renders-array-root-with-square-brackets':
			return <CollapsibleJsonViewer data={[1, 2, 3]} theme={theme} initialExpandLevel={2} />;

		case 'collapsible-json-viewer-renders-primitive-value-categories':
			return (
				<CollapsibleJsonViewer
					data={{ s: 'hi', n: 42, b: true, z: null }}
					theme={theme}
					initialExpandLevel={2}
				/>
			);

		case 'collapsible-json-viewer-renders-copy-affordance-per-node':
			return <CollapsibleJsonViewer data={{ k: 'v' }} theme={theme} initialExpandLevel={2} />;

		case 'collapsible-json-viewer-renders-root-label-as-quoted-key':
			return (
				<CollapsibleJsonViewer
					data={{ child: 1 }}
					theme={theme}
					rootLabel="payload"
					initialExpandLevel={2}
				/>
			);

		case 'collapsible-json-viewer-truncates-long-strings-with-ellipsis':
			return (
				<CollapsibleJsonViewer data={{ msg: LONG_STRING }} theme={theme} maxStringLength={10} />
			);

		case 'collapsible-json-viewer-primitive-root-renders-without-brackets':
			return <CollapsibleJsonViewer data="just a string" theme={theme} />;

		case 'collapsible-json-viewer-empty-object-renders-without-chevron-toggle':
			return <CollapsibleJsonViewer data={{}} theme={theme} />;

		case 'collapsible-json-viewer-empty-array-renders-without-chevron-toggle':
			return <CollapsibleJsonViewer data={[]} theme={theme} />;

		case 'collapsible-json-viewer-fires-no-ipc-or-websocket-traffic-on-mount':
			return <CollapsibleJsonViewer data={{ a: 1, b: [2, 3], c: { d: 'x' } }} theme={theme} />;

		case 'collapsible-json-viewer-does-not-render-modal-or-banner-chrome':
			return <CollapsibleJsonViewer data={{ k: 'v' }} theme={theme} initialExpandLevel={2} />;

		case 'collapsible-json-viewer-undefined-value-renders-as-undefined-literal':
			return <CollapsibleJsonViewer data={{ x: undefined }} theme={theme} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: collapsibleJsonViewerParityCatalog as ParityStory[],
	render,
};

export default adapter;
