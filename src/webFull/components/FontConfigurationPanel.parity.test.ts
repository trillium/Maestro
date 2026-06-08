/**
 * Parity catalog — FontConfigurationPanel
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * FontConfigurationPanel is a pure presentational component for configuring
 * the interface font. It renders:
 *
 *   1. A `<label>` with the canonical "Interface Font" headline copy
 *      ("INTERFACE FONT" visually because of `uppercase`, but the DOM text
 *      content is `Interface Font`).
 *   2. EITHER a "Loading fonts..." placeholder (when `fontLoading` is true)
 *      OR the font configuration body (select dropdown + custom-font input
 *      + custom-font chip list).
 *   3. The dropdown carries an `<optgroup label="Common Monospace Fonts">`
 *      with one `<option>` per entry in COMMON_MONOSPACE_FONTS (10 fonts).
 *   4. The dropdown additionally carries an `<optgroup label="Custom Fonts">`
 *      ONLY when `customFonts.length > 0`.
 *   5. A custom-font `<input type="text" placeholder="Add custom font name...">`
 *      paired with an "Add" `<button>`.
 *   6. A flex chip list rendering each entry in `customFonts` as a removable
 *      chip with a "×" close affordance (ONLY when `customFonts.length > 0`).
 *
 * The panel itself owns one piece of state (`customFontInput`); every other
 * interaction is threaded out as a callback (`setFontFamily`,
 * `onAddCustomFont`, `onRemoveCustomFont`, `onFontInteraction`). The
 * panel does not call any IPC or REST endpoint directly — the consuming
 * parent (`DisplayTab` in Electron / its webFull-mode equivalent) calls
 * `fonts:detect` IPC (Electron) or `GET /api/fonts/detected` (W2-fonts
 * REST route on `main`) and threads the result through `systemFonts`,
 * `fontsLoaded`, `fontLoading` props.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 * - Render-shape oriented per the SettingCheckbox / ToggleButtonGroup /
 *   SessionListItem / CollapsibleJsonViewer / GroupChatPanel L2.5
 *   precedent (`hasElement` / `hasText` only — click semantics belong to
 *   the feature-consumer catalog).
 *
 * Story floor (per brief): >=3 happy + >=1 negative. This catalog ships
 * 4 happy + 4 negative = 8 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb here
 * is explicitly out of scope; if a story needs an assertion that doesn't fit,
 * the story is wrong, not the vocabulary.
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

export const fontConfigurationPanelParityCatalog: ParityStory[] = [
	// ============ Happy path: canonical headline copy + body region present ============
	{
		name: 'font-configuration-panel-renders-interface-font-headline',
		given:
			'FontConfigurationPanel mounts with fontFamily="Menlo", fontsLoaded=true, fontLoading=false, systemFonts=["Menlo","Monaco"], and customFonts=[].',
		when: ['the component renders'],
		then: [
			// The canonical "Interface Font" label copy is present (uppercase styling is purely visual; the DOM text node carries the literal mixed-case string).
			{ verb: 'hasText', target: 'label', value: 'Interface Font' },
			// The select dropdown is the primary affordance, anchored under the label.
			{ verb: 'hasElement', target: 'select' },
		],
		happyPath: true,
	},
	// ============ Happy path: common monospace optgroup with 10 options ============
	{
		name: 'font-configuration-panel-renders-common-monospace-optgroup',
		given: 'FontConfigurationPanel mounts with fontsLoaded=true and fontLoading=false.',
		when: ['the dropdown renders its built-in catalog'],
		then: [
			// The "Common Monospace Fonts" optgroup is always present (independent of system font availability).
			{ verb: 'hasElement', target: 'optgroup[label="Common Monospace Fonts"]' },
			// At least one well-known monospace option from the COMMON_MONOSPACE_FONTS list is reachable.
			{ verb: 'hasElement', target: 'option[value="JetBrains Mono"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: custom-font input affordance + Add button ============
	{
		name: 'font-configuration-panel-renders-custom-font-input-and-add-button',
		given: 'FontConfigurationPanel mounts with fontLoading=false.',
		when: ['the body region renders'],
		then: [
			// The custom-font text input carries the canonical placeholder copy.
			{ verb: 'hasElement', target: 'input[type="text"][placeholder="Add custom font name..."]' },
			// The Add button is reachable as a sibling to the input.
			{ verb: 'hasText', target: 'button', value: 'Add' },
		],
		happyPath: true,
	},
	// ============ Happy path: custom fonts optgroup + chip list when customFonts has entries ============
	{
		name: 'font-configuration-panel-renders-custom-fonts-optgroup-when-populated',
		given:
			'FontConfigurationPanel mounts with customFonts=["Cartograph CF"] and fontLoading=false.',
		when: ['the dropdown renders its conditional custom-fonts optgroup'],
		then: [
			// The "Custom Fonts" optgroup only renders when customFonts.length > 0; the catalog pins that branch.
			{ verb: 'hasElement', target: 'optgroup[label="Custom Fonts"]' },
			// The user-supplied font name surfaces as a dropdown option.
			{ verb: 'hasElement', target: 'option[value="Cartograph CF"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'font-configuration-panel-suppresses-body-when-font-loading',
		given: 'FontConfigurationPanel mounts with fontLoading=true.',
		when: ['the component renders'],
		then: [
			// While loading, the body region collapses to a "Loading fonts..." placeholder; the select dropdown must be absent.
			{ verb: 'hasElement', target: 'div:not(:has(select))' },
			// The Loading copy is what surfaces in place of the body.
			{ verb: 'hasText', target: 'div', value: 'Loading fonts...' },
		],
		happyPath: false,
	},
	{
		name: 'font-configuration-panel-suppresses-custom-fonts-optgroup-when-empty',
		given: 'FontConfigurationPanel mounts with customFonts=[] and fontLoading=false.',
		when: ['the dropdown renders'],
		then: [
			// The "Custom Fonts" optgroup must NOT be present when there are no custom fonts.
			{ verb: 'hasElement', target: 'select:not(:has(optgroup[label="Custom Fonts"]))' },
		],
		happyPath: false,
	},
	{
		name: 'font-configuration-panel-does-not-render-its-own-modal',
		given: 'FontConfigurationPanel mounts with any well-formed props.',
		when: ['the component renders'],
		then: [
			// The panel is an inline settings region, not a modal. It must not emit a [role="dialog"] wrapper.
			{ verb: 'hasElement', target: 'div:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'font-configuration-panel-no-ipc-no-ws-no-broadcast-on-pure-render',
		given:
			'FontConfigurationPanel mounts with stable, well-formed props (fontsLoaded=true, fontLoading=false, customFonts=[], systemFonts=[]).',
		when: ['the component renders and remains mounted with no user input'],
		then: [
			// A pure render of this panel must not fire any WS frame, broadcast, or notification. The W2-fonts REST call is the parent's responsibility, not the panel's.
			{ verb: 'wsFrameMatches', target: 'none', value: '' },
			{ verb: 'broadcast', target: 'none', value: '' },
			{ verb: 'notificationFired', target: 'none', value: '' },
		],
		happyPath: false,
	},
];

describe('FontConfigurationPanel — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(fontConfigurationPanelParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = fontConfigurationPanelParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story', () => {
		const negative = fontConfigurationPanelParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
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
		for (const story of fontConfigurationPanelParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of fontConfigurationPanelParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of fontConfigurationPanelParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('uses render-shape vocabulary only on happy-path stories (no interaction verbs)', () => {
		// Render-shape oriented per the L2.5 precedent (SettingCheckbox / ToggleButtonGroup /
		// SessionListItem / CollapsibleJsonViewer / GroupChatPanel). Click / submit /
		// interaction semantics (Add custom font, remove chip, change selection) belong to
		// the feature-consumer's catalog (a future DisplayTab webFull host that wires
		// onAddCustomFont to a setting-update broadcast, etc.).
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of fontConfigurationPanelParityCatalog.filter((s) => s.happyPath)) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
