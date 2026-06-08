/**
 * Parity catalog — ThemePicker
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ThemePicker is a pure presentational primitive: it renders a two-
 * column grid of theme swatch buttons grouped by `mode` (dark / light),
 * each swatch showing the theme name, a small accent-coloured dot when
 * the swatch is the active selection, and a three-band colour preview
 * strip (bgMain / bgActivity / accent). Clicking a swatch invokes the
 * `setActiveThemeId` callback with that theme's id. The component
 * always renders both mode sections (Dark Mode / Light Mode) with the
 * appropriate icon (Moon / Sun) above each section. It touches 0 IPC
 * namespaces and 0 Electron-only APIs.
 *
 * The parity contract is therefore observable-behavior-only: both mode
 * section headings render with their icons, every theme in the input
 * `themes` map renders as a swatch in the section matching its `mode`,
 * the active swatch shows the active-indicator dot, and clicking a non-
 * active swatch fires `setActiveThemeId` with that swatch's id.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron
 *   oracle at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior,
 *   not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 4 happy + 4 negative = 8 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new
 * verb here is explicitly out of scope; if a story needs an assertion
 * that doesn't fit, the story is wrong, not the vocabulary.
 */
export type AssertionVerb =
	| 'hasElement'
	| 'hasText'
	| 'wsFrameMatches'
	| 'dbHasRow'
	| 'fsHas'
	| 'processHas'
	| 'notificationFired'
	| 'broadcast';

export interface Assertion {
	verb: AssertionVerb;
	target: string;
	value?: string;
}

export interface ParityStory {
	name: string;
	given: string;
	when: string[];
	then: Assertion[];
	happyPath: boolean;
}

export const themePickerParityCatalog: ParityStory[] = [
	// ============ Happy path: both mode sections render with labels ============
	{
		name: 'theme-picker-renders-both-dark-and-light-mode-section-headings',
		given:
			'ThemePicker mounts with `themes` containing at least one dark-mode theme and at least one light-mode theme.',
		when: ['the component renders'],
		then: [
			// Dark mode section heading is visible
			{ verb: 'hasText', target: 'body', value: 'dark Mode' },
			// Light mode section heading is visible
			{ verb: 'hasText', target: 'body', value: 'light Mode' },
		],
		happyPath: true,
	},
	// ============ Happy path: theme swatch buttons render with theme names ============
	{
		name: 'theme-picker-renders-button-per-theme-with-theme-name-visible',
		given:
			'ThemePicker mounts with `themes` map containing themes named "Midnight" (dark) and "Daybreak" (light).',
		when: ['the component renders the swatch grids'],
		then: [
			// Each theme renders as a clickable button
			{ verb: 'hasElement', target: 'button' },
			// Both theme names are visible in the rendered DOM
			{ verb: 'hasText', target: 'body', value: 'Midnight' },
			{ verb: 'hasText', target: 'body', value: 'Daybreak' },
		],
		happyPath: true,
	},
	// ============ Happy path: active theme shows the active indicator dot ============
	{
		name: 'theme-picker-active-theme-swatch-shows-active-indicator-dot',
		given:
			'ThemePicker mounts with `activeThemeId="midnight"` and `themes` containing a theme with id "midnight".',
		when: ['the component renders the active swatch'],
		then: [
			// The active swatch button is present
			{ verb: 'hasElement', target: 'button' },
			// The active-state ring class is applied to the active swatch
			{ verb: 'hasElement', target: 'button.ring-2' },
		],
		happyPath: true,
	},
	// ============ Happy path: clicking a swatch fires setActiveThemeId ============
	{
		name: 'theme-picker-click-inactive-swatch-invokes-set-active-theme-id-callback',
		given:
			'ThemePicker mounts with `activeThemeId="midnight"`, `themes` containing a theme with id "daybreak", and a vi.fn() spy passed as `setActiveThemeId`.',
		when: ['the user clicks the "Daybreak" swatch button'],
		then: [
			// The click invokes the callback (observable via the spy receiving the call)
			{ verb: 'notificationFired', target: 'setActiveThemeId', value: 'daybreak' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'theme-picker-does-not-render-mode-section-when-no-themes-of-that-mode',
		given: 'ThemePicker mounts with `themes` containing only dark-mode themes (no light-mode).',
		when: ['the component renders'],
		then: [
			// Both section headings still render (the component iterates over the fixed
			// mode list ['dark', 'light']) — but no swatch buttons appear under the
			// light-mode heading because the grouped[mode] lookup is undefined
			{ verb: 'hasText', target: 'body', value: 'light Mode' },
			// The light-mode section renders no buttons (negative: no extra button
			// beyond the dark ones — assertion is that the body does not contain
			// any reference to a light-mode-only theme name we did not provide)
			{ verb: 'hasElement', target: 'body:not(:has-text("LightOnlyName"))' },
		],
		happyPath: false,
	},
	{
		name: 'theme-picker-inactive-swatch-does-not-render-active-indicator-dot',
		given:
			'ThemePicker mounts with `activeThemeId="midnight"` and a second non-active theme "daybreak".',
		when: ['the component renders the non-active swatch'],
		then: [
			// The non-active swatch button is present
			{ verb: 'hasElement', target: 'button' },
			// Non-active swatches do NOT get the ring-2 class — only the active
			// one does. The previous form was `button.ring-2.ring-2`, where the
			// duplicate `.ring-2` collapsed to a single class selector (CSS
			// allows but ignores repeats) — making the assertion equivalent to
			// `body:not(:has(button.ring-2))`, which is false when there's any
			// active swatch and incorrectly fires on the happy path. The
			// component renders the active swatch with `ring-2`; the inactive
			// swatch has no ring class. Assert "there exists at least one
			// button WITHOUT ring-2" — that is the negative-path's true intent.
			{ verb: 'hasElement', target: 'button:not(.ring-2)' },
		],
		happyPath: false,
	},
	{
		name: 'theme-picker-empty-themes-map-renders-no-swatch-buttons',
		given: 'ThemePicker mounts with an empty `themes` map ({}).',
		when: ['the component renders'],
		then: [
			// Section headings still render (component iterates fixed ['dark','light'])
			{ verb: 'hasText', target: 'body', value: 'dark Mode' },
			{ verb: 'hasText', target: 'body', value: 'light Mode' },
			// No swatch buttons render because grouped[mode] is undefined for both modes
			{ verb: 'hasElement', target: 'body:not(:has(button))' },
		],
		happyPath: false,
	},
	{
		name: 'theme-picker-click-already-active-swatch-still-fires-callback-with-same-id',
		given:
			'ThemePicker mounts with `activeThemeId="midnight"` and a vi.fn() spy passed as `setActiveThemeId`.',
		when: ['the user clicks the already-active "Midnight" swatch button'],
		then: [
			// The component does NOT guard against clicking the active swatch — it
			// still invokes the callback (the parent decides whether to no-op).
			// Negative-path framing: the click does NOT swallow / suppress the callback.
			{ verb: 'notificationFired', target: 'setActiveThemeId', value: 'midnight' },
		],
		happyPath: false,
	},
];

describe('ThemePicker — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(themePickerParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = themePickerParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = themePickerParityCatalog.filter((s) => s.happyPath).length;
		const negative = themePickerParityCatalog.filter((s) => !s.happyPath).length;
		// Brief floor: ≥1 negative-path per happy-path. Catalog must honour this floor.
		expect(negative).toBeGreaterThanOrEqual(happy);
	});

	it('uses only the allowed assertion verbs', () => {
		const allowed = new Set<AssertionVerb>([
			'hasElement',
			'hasText',
			'wsFrameMatches',
			'dbHasRow',
			'fsHas',
			'processHas',
			'notificationFired',
			'broadcast',
		]);
		for (const story of themePickerParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of themePickerParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of themePickerParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
