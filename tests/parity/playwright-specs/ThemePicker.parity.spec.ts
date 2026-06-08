/**
 * Playwright parity spec — ThemePicker
 *
 * Imports the catalog verbatim from
 * `src/webFull/components/ThemePicker.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 *
 * ThemePicker is a pure presentational primitive — every story is a
 * single static mount with `setActiveThemeId` as a no-op. The catalog's
 * render-shape stories cover dark/light mode-section headings, swatch
 * buttons per theme, active-state ring class, and empty-themes-map
 * absence behavior. Two stories use the `notificationFired` backend verb
 * for click → callback verification; the runner auto-skips those per
 * `runParityCatalog.ts`'s `VERBS_REQUIRING_BACKEND` set. See
 * `tests/parity/harness/adapters/ThemePicker.adapter.tsx` for the
 * prose-to-props translation.
 */

import { themePickerParityCatalog } from '../../../src/webFull/components/ThemePicker.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'ThemePicker',
	catalog: themePickerParityCatalog as ParityStory[],
});
