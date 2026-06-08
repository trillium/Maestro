/**
 * Playwright parity spec — RenameGroupChatModal
 *
 * Adoption wave 5. Imports the catalog verbatim from
 * `src/webFull/components/RenameGroupChatModal.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`. The catalog
 * ships 7 stories (3 happy + 4 negative); all use only `hasElement` and
 * `hasText` verbs so every story runs live.
 */

import { renameGroupChatModalParityCatalog } from '../../../src/webFull/components/RenameGroupChatModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'RenameGroupChatModal',
	catalog: renameGroupChatModalParityCatalog as ParityStory[],
});
