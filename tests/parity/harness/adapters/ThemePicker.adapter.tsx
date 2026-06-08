/**
 * ThemePicker — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/ThemePicker.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * ThemePicker is a pure presentational primitive — no internal state, no
 * lifecycle, no portals. It renders a two-column grid of theme swatch
 * buttons grouped by mode (dark / light). The catalog stories that
 * exercise the click → `setActiveThemeId(id)` callback use the
 * `notificationFired` backend verb, which the runner auto-skips per
 * `runParityCatalog.ts`'s `VERBS_REQUIRING_BACKEND` set. We still provide
 * a render mapping for those stories so the switch stays exhaustive.
 *
 * Theme map shape: the catalog stories use synthesized themes with
 * known names ("Midnight", "Daybreak") and known modes — we build those
 * locally rather than reach into the shared THEMES map, so the assertions
 * against `body :has-text("Midnight")` resolve deterministically and
 * don't depend on the production theme registry's contents.
 */

import type { ReactElement } from 'react';
import { ThemePicker } from '../../../../src/webFull/components/ThemePicker';
import { themePickerParityCatalog } from '../../../../src/webFull/components/ThemePicker.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { Theme, ThemeId } from '../../../../src/shared/theme-types';
import type { ParityStory } from '../registry';

const baseTheme = THEMES['dracula'];
const noop = (): void => {};

// Build synthesized themes from the dracula base — overriding only
// `id`, `name`, and `mode` so the assertions against rendered theme
// names ("Midnight", "Daybreak") resolve deterministically without
// coupling the catalog to the production theme registry.
function makeTheme(id: string, name: string, mode: 'dark' | 'light'): Theme {
	return { ...baseTheme, id: id as ThemeId, name, mode };
}

const midnight = makeTheme('midnight', 'Midnight', 'dark');
const daybreak = makeTheme('daybreak', 'Daybreak', 'light');

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'theme-picker-renders-both-dark-and-light-mode-section-headings':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight, daybreak } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-renders-button-per-theme-with-theme-name-visible':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight, daybreak } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-active-theme-swatch-shows-active-indicator-dot':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-click-inactive-swatch-invokes-set-active-theme-id-callback':
			// Backend-verb story (`notificationFired`) — executor auto-skips.
			// Render the picker with both themes for switch exhaustiveness.
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight, daybreak } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-does-not-render-mode-section-when-no-themes-of-that-mode':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-inactive-swatch-does-not-render-active-indicator-dot':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight, daybreak } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-empty-themes-map-renders-no-swatch-buttons':
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{} as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		case 'theme-picker-click-already-active-swatch-still-fires-callback-with-same-id':
			// Backend-verb story (`notificationFired`) — executor auto-skips.
			return (
				<ThemePicker
					theme={baseTheme}
					themes={{ midnight } as unknown as Record<ThemeId, Theme>}
					activeThemeId={'midnight' as ThemeId}
					setActiveThemeId={noop}
				/>
			);

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: themePickerParityCatalog as ParityStory[],
	render,
};

export default adapter;
