/**
 * Playwright parity spec — SessionList
 *
 * Adoption wave 2. Imports the catalog verbatim from
 * `src/webFull/components/SessionList.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 */

import { sessionListParityCatalog } from '../../../src/webFull/components/SessionList.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'SessionList',
	catalog: sessionListParityCatalog as ParityStory[],
});
