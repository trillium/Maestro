/**
 * Playwright parity spec — MaestroSilhouette
 *
 * Second wave adoption of the Playwright parity scaffold (batch-1).
 * Imports the catalog verbatim from
 * `src/webFull/components/MaestroSilhouette.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`.
 *
 * Two named exports (`MaestroSilhouette` static + `AnimatedMaestro`
 * animated) discriminated by `alt` attribute. One coexistence story
 * mounts BOTH side-by-side. See
 * `tests/parity/harness/adapters/MaestroSilhouette.adapter.tsx` for the
 * prose-to-props translation.
 */

import { maestroSilhouetteParityCatalog } from '../../../src/webFull/components/MaestroSilhouette.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'MaestroSilhouette',
	catalog: maestroSilhouetteParityCatalog as ParityStory[],
});
