/**
 * Playwright parity spec — AutoRunnerHelpModal
 *
 * Adoption wave 4. Imports the catalog verbatim from
 * `src/webFull/components/AutoRunnerHelpModal.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`. The
 * catalog is 10 stories; all use only `hasElement` and `hasText`
 * verbs so every story runs live.
 */

import { autoRunnerHelpModalParityCatalog } from '../../../src/webFull/components/AutoRunnerHelpModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'AutoRunnerHelpModal',
	catalog: autoRunnerHelpModalParityCatalog as ParityStory[],
});
