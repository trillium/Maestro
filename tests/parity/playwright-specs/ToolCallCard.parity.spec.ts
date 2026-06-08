/**
 * Playwright parity spec — ToolCallCard
 *
 * Adoption wave 4. Imports the catalog verbatim from
 * `src/webFull/components/ToolCallCard.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`. The catalog is 11
 * stories; all use only `hasElement` and `hasText` verbs so every
 * story runs live.
 */

import { toolCallCardParityCatalog } from '../../../src/webFull/components/ToolCallCard.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'ToolCallCard',
	catalog: toolCallCardParityCatalog as ParityStory[],
});
