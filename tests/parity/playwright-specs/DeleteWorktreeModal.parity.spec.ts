/**
 * Playwright parity spec — DeleteWorktreeModal
 *
 * Adoption wave 3. Imports the catalog verbatim from
 * `src/webFull/components/DeleteWorktreeModal.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog is 8
 * stories; all use only `hasElement` and `hasText` verbs so every story
 * runs live.
 */

import { deleteWorktreeModalParityCatalog } from '../../../src/webFull/components/DeleteWorktreeModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'DeleteWorktreeModal',
	catalog: deleteWorktreeModalParityCatalog as ParityStory[],
});
