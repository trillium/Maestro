/**
 * Playwright parity spec — GroupChatHeader
 *
 * Adoption wave 2. Imports the catalog verbatim from
 * `src/webFull/components/GroupChatHeader.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 */

import { groupChatHeaderParityCatalog } from '../../../src/webFull/components/GroupChatHeader.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'GroupChatHeader',
	catalog: groupChatHeaderParityCatalog as ParityStory[],
});
