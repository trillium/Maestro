/**
 * Playwright parity spec — RenameTabModal
 *
 * Adoption wave 3. Imports the catalog verbatim from
 * `src/webFull/components/RenameTabModal.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`. The catalog is 5
 * stories; all use only `hasElement` and `hasText` verbs so every story
 * runs live.
 */

import { renameTabModalParityCatalog } from '../../../src/webFull/components/RenameTabModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'RenameTabModal',
	catalog: renameTabModalParityCatalog as ParityStory[],
});
