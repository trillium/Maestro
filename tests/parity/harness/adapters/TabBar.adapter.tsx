/**
 * TabBar — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/TabBar.parity.test.ts`) is imported verbatim;
 * adding / removing / editing a story over there flows through here via
 * `story.name`.
 *
 * The TabBar catalog is broadcast-heavy: 9 of 13 stories use the
 * `broadcast` verb to assert callback invocation (click → onSelectTab,
 * close → onCloseTab, Cmd shortcuts → onSelectTab, etc.). The runner's
 * `usesBackendVerb` skip check routes those to
 * `[skipped: backend verbs not yet wired]`, so they don't need an arm
 * here — the catalog itself stays the source of truth and the count
 * survives into the report.
 *
 * The three stories this adapter exercises are pure render-shape
 * assertions:
 *   - `tab-bar-renders-each-tab-with-name-and-state-attributes` — three
 *     tabs with idle/busy/idle states, "alpha" active. Asserts
 *     [data-testid="tab-bar"][role="tablist"], per-tab data-tab-id /
 *     aria-selected / data-tab-state, and visible name text.
 *   - `tab-bar-renders-nothing-when-there-is-only-one-tab` — single-tab
 *     case where the bar hides itself (tabs.length <= 1). Asserts
 *     `body:not(:has([data-testid="tab-bar"]))` — i.e. nothing is
 *     mounted at all. We render a `<></>` fragment carrying just the
 *     TabBar so the assertion passes against an empty harness body
 *     (modulo the harness `#root` / `#__parity_error` chrome that lives
 *     OUTSIDE the assertion's `:not(:has(...))` scope).
 *   - `tab-bar-does-not-expose-html5-drag-reorder` — two-or-more-tabs
 *     case asserts `[data-testid="tab-bar"]:not(:has([draggable="true"]))`,
 *     i.e. NO draggable attribute appears anywhere inside the bar. The
 *     webFull TabBar lift intentionally omits HTML5 drag/drop wiring.
 *
 * TabBar uses `useThemeColors()` from the `ThemeProvider` context;
 * mounting without the provider throws. The adapter wraps every story in
 * a minimal `<ThemeProvider>` initialised with the dracula theme.
 */

import type { ReactElement } from 'react';
import { TabBar } from '../../../../src/webFull/components/TabBar';
import { tabBarParityCatalog } from '../../../../src/webFull/components/TabBar.parity.test';
import { ThemeProvider } from '../../../../src/webFull/components/ThemeProvider';
import type { AITabData } from '../../../../src/webFull/hooks/useWebSocket';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];
const noop = () => {};

interface TabStub {
	id: string;
	name: string;
	state: 'idle' | 'busy';
	starred?: boolean;
}

function makeTab(stub: TabStub): AITabData {
	return {
		id: stub.id,
		agentSessionId: null,
		name: stub.name,
		starred: stub.starred ?? false,
		inputValue: '',
		createdAt: 1_700_000_000_000,
		state: stub.state,
	};
}

interface MountOpts {
	tabs: AITabData[];
	activeTabId: string;
}

function Mounted(props: MountOpts): ReactElement {
	return (
		<ThemeProvider theme={theme}>
			<TabBar
				tabs={props.tabs}
				activeTabId={props.activeTabId}
				onSelectTab={noop}
				onNewTab={noop}
				onCloseTab={noop}
			/>
		</ThemeProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'tab-bar-renders-each-tab-with-name-and-state-attributes': {
			const alpha = makeTab({ id: 'alpha-id', name: 'alpha', state: 'idle' });
			const beta = makeTab({ id: 'beta-id', name: 'beta', state: 'busy' });
			const gamma = makeTab({ id: 'gamma-id', name: 'gamma', state: 'idle' });
			return <Mounted tabs={[alpha, beta, gamma]} activeTabId="alpha-id" />;
		}

		case 'tab-bar-renders-nothing-when-there-is-only-one-tab': {
			const alpha = makeTab({ id: 'alpha-id', name: 'alpha', state: 'idle' });
			return <Mounted tabs={[alpha]} activeTabId="alpha-id" />;
		}

		case 'tab-bar-does-not-expose-html5-drag-reorder': {
			const alpha = makeTab({ id: 'alpha-id', name: 'alpha', state: 'idle' });
			const beta = makeTab({ id: 'beta-id', name: 'beta', state: 'idle' });
			const gamma = makeTab({ id: 'gamma-id', name: 'gamma', state: 'idle' });
			return <Mounted tabs={[alpha, beta, gamma]} activeTabId="alpha-id" />;
		}

		// Backend-verb stories ('broadcast') route to the skip path. If a
		// new pure-render story lands without an arm, default surfaces it.
		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: tabBarParityCatalog as ParityStory[],
	render,
};

export default adapter;
