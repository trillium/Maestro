/**
 * Playwright parity spec — CreateGroupModal
 *
 * Adoption wave 5. Imports the catalog verbatim from
 * `src/webFull/components/CreateGroupModal.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`. The catalog ships 5
 * stories; all use only `hasElement` and `hasText` verbs so every story
 * runs live.
 */

import { createGroupModalParityCatalog } from '../../../src/webFull/components/CreateGroupModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'CreateGroupModal',
	catalog: createGroupModalParityCatalog as ParityStory[],
});
