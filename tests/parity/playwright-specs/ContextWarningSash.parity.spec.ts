/**
 * Playwright parity spec — ContextWarningSash
 *
 * First adoption of the Playwright parity scaffold. Imports the catalog
 * verbatim from `src/webFull/components/ContextWarningSash.parity.test.ts`
 * and expands it into Playwright tests via `runParityCatalog()`.
 *
 * The catalog-shape vitest checks (`describe('ContextWarningSash — parity
 * catalog', ...)`) continue to run under `npm test`. This spec adds the
 * behavioral execution layer: each story actually renders the lifted
 * webFull component and asserts the documented `then[]` against a real DOM.
 *
 * To add another adoption, copy this file, swap the import + catalog name,
 * and register a matching adapter in `tests/parity/harness/registry.ts`.
 */

import { contextWarningSashParityCatalog } from '../../../src/webFull/components/ContextWarningSash.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'ContextWarningSash',
	catalog: contextWarningSashParityCatalog as ParityStory[],
});
