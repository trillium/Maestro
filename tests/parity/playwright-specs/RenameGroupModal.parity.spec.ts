/**
 * Playwright parity spec — RenameGroupModal
 *
 * Adoption wave 5. Imports the catalog verbatim from
 * `src/webFull/components/RenameGroupModal.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog ships 6
 * stories (3 happy + 3 negative); all use only `hasElement` and
 * `hasText` verbs so every story runs live.
 */

import { renameGroupModalParityCatalog } from '../../../src/webFull/components/RenameGroupModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'RenameGroupModal',
	catalog: renameGroupModalParityCatalog as ParityStory[],
});
