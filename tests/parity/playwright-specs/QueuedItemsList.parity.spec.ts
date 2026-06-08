/**
 * Playwright parity spec — QueuedItemsList
 *
 * Adoption wave 4. Imports the catalog verbatim from
 * `src/webFull/components/QueuedItemsList.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog is
 * 12 stories; all use only `hasElement` and `hasText` verbs so every
 * story runs live.
 */

import { queuedItemsListParityCatalog } from '../../../src/webFull/components/QueuedItemsList.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'QueuedItemsList',
	catalog: queuedItemsListParityCatalog as ParityStory[],
});
