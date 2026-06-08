/**
 * Playwright parity spec — DeleteGroupChatModal
 *
 * Adoption wave 3. Imports the catalog verbatim from
 * `src/webFull/components/DeleteGroupChatModal.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`. The catalog is 6
 * stories; all use only `hasElement` and `hasText` verbs so every story
 * runs live.
 */

import { deleteGroupChatModalParityCatalog } from '../../../src/webFull/components/DeleteGroupChatModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'DeleteGroupChatModal',
	catalog: deleteGroupChatModalParityCatalog as ParityStory[],
});
