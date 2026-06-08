/**
 * Playwright parity spec — TabBar
 *
 * Adoption wave 2. Imports the catalog verbatim from
 * `src/webFull/components/TabBar.parity.test.ts` and expands it into
 * Playwright tests via `runParityCatalog()`. Backend-verb stories (the
 * keyboard-shortcut + callback-broadcast majority) are skipped by the
 * executor with a `[skipped: backend verbs not yet wired]` marker; the
 * three render-shape stories (list rendering, single-tab hide,
 * no-html5-drag) run live.
 */

import { tabBarParityCatalog } from '../../../src/webFull/components/TabBar.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'TabBar',
	catalog: tabBarParityCatalog as ParityStory[],
});
