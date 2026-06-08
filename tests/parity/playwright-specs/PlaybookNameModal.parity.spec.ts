/**
 * Playwright parity spec — PlaybookNameModal
 *
 * Adoption wave 5. Imports the catalog verbatim from
 * `src/webFull/components/PlaybookNameModal.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog ships 5
 * stories (3 happy + 2 negative); all use only `hasElement` and `hasText`
 * verbs so every story runs live.
 */

import { playbookNameModalParityCatalog } from '../../../src/webFull/components/PlaybookNameModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'PlaybookNameModal',
	catalog: playbookNameModalParityCatalog as ParityStory[],
});
