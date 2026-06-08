/**
 * Playwright parity spec — CsvTableRenderer
 *
 * Imports the catalog verbatim from
 * `src/webFull/components/CsvTableRenderer.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`.
 *
 * CsvTableRenderer is a delimited-content table renderer — most stories
 * are single static mounts driven by the input `content` / `delimiter` /
 * `searchQuery` props. One story (`...sorts-column-ascending...`) needs
 * a header-click interaction before the assertion runs; the adapter's
 * <SortDriver> wrapper handles that on first paint. One story uses the
 * `wsFrameMatches` / `fsHas` / `processHas` backend verbs; the runner
 * auto-skips that per `runParityCatalog.ts`'s `VERBS_REQUIRING_BACKEND`
 * set. See `tests/parity/harness/adapters/CsvTableRenderer.adapter.tsx`
 * for the prose-to-props translation.
 */

import { csvTableRendererParityCatalog } from '../../../src/webFull/components/CsvTableRenderer.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'CsvTableRenderer',
	catalog: csvTableRendererParityCatalog as ParityStory[],
});
