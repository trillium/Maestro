/**
 * Playwright parity spec — WelcomeContent
 *
 * Second wave adoption of the Playwright parity scaffold (batch-1).
 * Imports the catalog verbatim from
 * `src/webFull/components/WelcomeContent.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 *
 * Pure presentational content block — every story is a single static
 * mount with no driver wrapper. The `showGetStarted` boolean gates the
 * bottom call-to-action paragraph; happy/negative stories pivot on
 * that flag. See `tests/parity/harness/adapters/WelcomeContent.adapter.tsx`
 * for the prose-to-props translation.
 *
 * One story (`welcome-content-touches-no-ipc-or-electron-surface`)
 * uses the backend verbs `notificationFired` + `broadcast` which the
 * executor auto-skips per `runParityCatalog.ts` line 39's
 * `VERBS_REQUIRING_BACKEND` set.
 */

import { welcomeContentParityCatalog } from '../../../src/webFull/components/WelcomeContent.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'WelcomeContent',
	catalog: welcomeContentParityCatalog as ParityStory[],
});
