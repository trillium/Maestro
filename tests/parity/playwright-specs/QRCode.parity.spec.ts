/**
 * Playwright parity spec — QRCode
 *
 * Imports the catalog verbatim from
 * `src/webFull/components/QRCode.parity.test.ts` and expands it into
 * Playwright tests via `runParityCatalog()`.
 *
 * QRCode renders asynchronously: the `useEffect` kicks off a Promise via
 * the `qrcode` library and re-renders with the data URL on resolution.
 * Loading-placeholder and error-state stories observe pre-resolution
 * states; success stories observe post-resolution states. The harness
 * adapter (`tests/parity/harness/adapters/QRCode.adapter.tsx`) handles
 * the prose-to-props translation.
 */

import { qrcodeParityCatalog } from '../../../src/webFull/components/QRCode.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'QRCode',
	catalog: qrcodeParityCatalog as ParityStory[],
});
