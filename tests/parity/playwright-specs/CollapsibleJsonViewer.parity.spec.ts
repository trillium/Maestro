/**
 * Playwright parity spec — CollapsibleJsonViewer
 *
 * Second wave adoption of the Playwright parity scaffold (batch-1).
 * Imports the catalog verbatim from
 * `src/webFull/components/CollapsibleJsonViewer.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`.
 *
 * Render-shape primitive — every story is a single static mount with a
 * different `data` payload and (for the truncation story) a tighter
 * `maxStringLength` cap. See
 * `tests/parity/harness/adapters/CollapsibleJsonViewer.adapter.tsx` for
 * the prose-to-props translation. No backend-verb stories — every story
 * uses `hasElement` + `hasText` exclusively, so the executor runs all 12.
 */

import { collapsibleJsonViewerParityCatalog } from '../../../src/webFull/components/CollapsibleJsonViewer.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'CollapsibleJsonViewer',
	catalog: collapsibleJsonViewerParityCatalog as ParityStory[],
});
