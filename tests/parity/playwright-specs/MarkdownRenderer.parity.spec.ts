/**
 * Playwright parity spec — MarkdownRenderer
 *
 * Adoption wave 2. Imports the catalog verbatim from
 * `src/webFull/components/MarkdownRenderer.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`. Catalog-shape vitest
 * checks continue to run under `npm test`; this spec adds the behavioral
 * execution layer.
 */

import { markdownRendererParityCatalog } from '../../../src/webFull/components/MarkdownRenderer.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'MarkdownRenderer',
	catalog: markdownRendererParityCatalog as ParityStory[],
});
