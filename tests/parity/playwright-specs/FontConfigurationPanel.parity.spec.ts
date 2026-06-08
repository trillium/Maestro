/**
 * Playwright parity spec — FontConfigurationPanel
 *
 * Second wave adoption of the Playwright parity scaffold (batch-1).
 * Imports the catalog verbatim from
 * `src/webFull/components/FontConfigurationPanel.parity.test.ts` and
 * expands it into Playwright tests via `runParityCatalog()`.
 *
 * Render-shape primitive — every story is a single static mount with
 * different `fontsLoaded` / `fontLoading` / `customFonts` /
 * `systemFonts` inputs. One story uses the backend verbs
 * `wsFrameMatches` + `broadcast` + `notificationFired`; the executor
 * auto-skips. See
 * `tests/parity/harness/adapters/FontConfigurationPanel.adapter.tsx`
 * for the prose-to-props translation.
 */

import { fontConfigurationPanelParityCatalog } from '../../../src/webFull/components/FontConfigurationPanel.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'FontConfigurationPanel',
	catalog: fontConfigurationPanelParityCatalog as ParityStory[],
});
