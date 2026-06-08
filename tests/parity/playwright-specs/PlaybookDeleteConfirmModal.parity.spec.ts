/**
 * Playwright parity spec — PlaybookDeleteConfirmModal
 *
 * Adoption wave 3. Imports the catalog verbatim from
 * `src/webFull/components/PlaybookDeleteConfirmModal.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`. The catalog
 * is 5 stories; all use only `hasElement` and `hasText` verbs so every
 * story runs live.
 */

import { playbookDeleteConfirmModalParityCatalog } from '../../../src/webFull/components/PlaybookDeleteConfirmModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'PlaybookDeleteConfirmModal',
	catalog: playbookDeleteConfirmModalParityCatalog as ParityStory[],
});
