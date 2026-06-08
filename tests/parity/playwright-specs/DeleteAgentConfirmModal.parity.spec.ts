/**
 * Playwright parity spec — DeleteAgentConfirmModal
 *
 * Adoption wave 5. Imports the catalog verbatim from
 * `src/webFull/components/DeleteAgentConfirmModal.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`. The catalog
 * ships 8 stories (4 happy + 4 negative); all use only `hasElement` and
 * `hasText` verbs so every story runs live.
 */

import { deleteAgentConfirmModalParityCatalog } from '../../../src/webFull/components/DeleteAgentConfirmModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'DeleteAgentConfirmModal',
	catalog: deleteAgentConfirmModalParityCatalog as ParityStory[],
});
