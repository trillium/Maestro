/**
 * Playwright parity spec — AgentErrorModal
 *
 * Adoption wave 2. Imports the catalog verbatim from
 * `src/webFull/components/AgentErrorModal.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 */

import { agentErrorModalParityCatalog } from '../../../src/webFull/components/AgentErrorModal.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'AgentErrorModal',
	catalog: agentErrorModalParityCatalog as ParityStory[],
});
