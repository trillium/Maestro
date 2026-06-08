/**
 * Playwright parity spec — ToggleButtonGroup
 *
 * Imports the catalog verbatim from
 * `src/webFull/components/ToggleButtonGroup.parity.test.ts` and expands
 * it into Playwright tests via `runParityCatalog()`.
 *
 * ToggleButtonGroup is a pure stateless primitive — every story is a
 * single static mount with `onChange` as a no-op. The catalog's
 * render-shape stories cover label precedence, active-state ring class,
 * numeric value generics, and absence cases. See
 * `tests/parity/harness/adapters/ToggleButtonGroup.adapter.tsx` for the
 * prose-to-props translation.
 */

import { toggleButtonGroupParityCatalog } from '../../../src/webFull/components/ToggleButtonGroup.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'ToggleButtonGroup',
	catalog: toggleButtonGroupParityCatalog as ParityStory[],
});
