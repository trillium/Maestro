/**
 * Playwright parity spec — SettingCheckbox
 *
 * Imports the catalog verbatim from
 * `src/webFull/components/SettingCheckbox.parity.test.ts` and expands it
 * into Playwright tests via `runParityCatalog()`.
 *
 * SettingCheckbox is a pure stateless presentational primitive — every
 * story is a single static mount with `onChange` as a no-op. The
 * catalog's render-shape stories cover section-label / icon / row /
 * description presence and the switch's `aria-checked` reflection. See
 * `tests/parity/harness/adapters/SettingCheckbox.adapter.tsx` for the
 * prose-to-props translation.
 */

import { settingCheckboxParityCatalog } from '../../../src/webFull/components/SettingCheckbox.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'SettingCheckbox',
	catalog: settingCheckboxParityCatalog as ParityStory[],
});
