/**
 * Playwright parity spec — HistoryHelpModal
 *
 * Adoption wave 4. Imports the catalog verbatim from
 * `src/webFull/components/HistoryHelpModal.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog is 8
 * stories; all use only `hasElement` and `hasText` verbs so every story
 * runs live.
 */

import { historyHelpModalParityCatalog } from '../../../src/webFull/components/HistoryHelpModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'HistoryHelpModal',
	catalog: historyHelpModalParityCatalog as ParityStory[],
});
