/**
 * WelcomeContent — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/WelcomeContent.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * WelcomeContent is a pure presentational content block — no state,
 * no lifecycle, no portals — so every story is a single static mount.
 * The only varying input is the `showGetStarted` boolean, which gates
 * the bottom call-to-action paragraph.
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven `color` values resolve deterministically. The catalog's
 * assertions all target tag names and text — not inline-style values —
 * so the specific theme picked here is cosmetic.
 */

import type { ReactElement } from 'react';
import { WelcomeContent } from '../../../../src/webFull/components/WelcomeContent';
import { welcomeContentParityCatalog } from '../../../../src/webFull/components/WelcomeContent.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'welcome-content-renders-icon-and-heading':
			return <WelcomeContent theme={theme} />;

		case 'welcome-content-renders-intro-and-numbered-goals':
			return <WelcomeContent theme={theme} />;

		case 'welcome-content-renders-how-it-works-explainer':
			return <WelcomeContent theme={theme} />;

		case 'welcome-content-shows-get-started-cta-when-flag-set':
			return <WelcomeContent theme={theme} showGetStarted />;

		case 'welcome-content-hides-get-started-cta-when-flag-omitted':
			return <WelcomeContent theme={theme} />;

		case 'welcome-content-hides-get-started-cta-when-flag-false':
			return <WelcomeContent theme={theme} showGetStarted={false} />;

		case 'welcome-content-renders-no-third-numbered-goal':
			return <WelcomeContent theme={theme} />;

		case 'welcome-content-touches-no-ipc-or-electron-surface':
			// Backend-verb story (`notificationFired` / `broadcast`) — the
			// executor marks these skipped automatically before the harness
			// is even invoked. We still need a render mapping to keep the
			// `switch` exhaustive in case the executor's skip logic is ever
			// loosened; mount the default block.
			return <WelcomeContent theme={theme} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: welcomeContentParityCatalog as ParityStory[],
	render,
};

export default adapter;
