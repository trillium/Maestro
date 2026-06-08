/**
 * Playwright parity spec — ResetTasksConfirmModal
 *
 * Adoption wave 3. Imports the catalog verbatim from
 * `src/webFull/components/ResetTasksConfirmModal.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`. The catalog
 * is 5 stories; all use only `hasElement` and `hasText` verbs so every
 * story runs live.
 */

import { resetTasksConfirmModalParityCatalog } from '../../../src/webFull/components/ResetTasksConfirmModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'ResetTasksConfirmModal',
	catalog: resetTasksConfirmModalParityCatalog as ParityStory[],
});
