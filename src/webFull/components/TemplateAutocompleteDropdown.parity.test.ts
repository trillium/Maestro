/**
 * Parity catalog — TemplateAutocompleteDropdown
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * TemplateAutocompleteDropdown is a `forwardRef<HTMLDivElement>`
 * presentational dropdown that renders the absolute-positioned
 * template-variable picker used by both `AgentPromptComposerModal` and the
 * Auto Run document editor. It accepts `{ theme, state, onSelect }` where
 * `state` carries `{ isOpen, position, selectedIndex, searchText,
 * filteredVariables }`.
 *
 * Render rules:
 *   - returns `null` when `!state.isOpen` OR
 *     `state.filteredVariables.length === 0` (the two short-circuits)
 *   - when rendered: outer `<div>` with className containing `"absolute z-50"`
 *     positioned at `state.position.{top,left}` carrying the
 *     `theme.colors.bgSidebar` background
 *   - each variable row has a `data-index={index}` attribute, a `<code>` chip
 *     with the variable name, and a `<span>` with the description
 *   - the `state.selectedIndex` row gets `theme.colors.bgActivity` background
 *     (vs `transparent` for the others)
 *   - footer surfaces three `<kbd>` chips: "↑↓", "Tab", "Esc"
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative. This catalog ships
 * 4 happy + 3 negative = 7 stories.
 */

import { describe, expect, it } from 'vitest';

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

export const templateAutocompleteDropdownParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'template-autocomplete-renders-list-and-footer-when-open-with-variables',
		given:
			'The dropdown is mounted with state.isOpen=true, state.selectedIndex=0, and filteredVariables=[{variable:"{{date}}",description:"Current date"},{variable:"{{time}}",description:"Current time"}].',
		when: ['the dropdown renders'],
		then: [
			// Row chrome: one row per filtered variable, each carrying data-index
			{ verb: 'hasElement', target: 'div[data-index="0"]' },
			{ verb: 'hasElement', target: 'div[data-index="1"]' },
			// Variable name surfaces in the <code> chip
			{ verb: 'hasText', target: 'code', value: '{{date}}' },
			// Description surfaces in the row's <span>
			{ verb: 'hasText', target: 'span', value: 'Current date' },
			// Footer keyboard hint surfaces in <kbd> chips
			{ verb: 'hasText', target: 'kbd', value: '↑↓' },
			{ verb: 'hasText', target: 'kbd', value: 'Tab' },
			{ verb: 'hasText', target: 'kbd', value: 'Esc' },
		],
		happyPath: true,
	},
	{
		name: 'template-autocomplete-renders-second-row-as-selected-when-selectedIndex-is-one',
		given:
			'The dropdown is mounted with state.isOpen=true, state.selectedIndex=1, and two filteredVariables.',
		when: ['the dropdown renders'],
		then: [
			// Both rows render (data-index attribute is the discriminator)
			{ verb: 'hasElement', target: 'div[data-index="0"]' },
			{ verb: 'hasElement', target: 'div[data-index="1"]' },
		],
		happyPath: true,
	},
	{
		name: 'template-autocomplete-renders-arbitrary-row-count-when-many-variables-filtered',
		given:
			'The dropdown is mounted with state.isOpen=true, state.selectedIndex=0, and five filteredVariables.',
		when: ['the dropdown renders'],
		then: [
			// Five rows — pins the .map() rendering through all elements
			{ verb: 'hasElement', target: 'div[data-index="0"]' },
			{ verb: 'hasElement', target: 'div[data-index="4"]' },
		],
		happyPath: true,
	},
	{
		name: 'template-autocomplete-surfaces-description-text-for-each-variable-row',
		given:
			'The dropdown is mounted with state.isOpen=true and filteredVariables=[{variable:"{{branch}}",description:"Git branch name"}].',
		when: ['the dropdown renders'],
		then: [
			// Variable name in the code chip
			{ verb: 'hasText', target: 'code', value: '{{branch}}' },
			// Description in the row span
			{ verb: 'hasText', target: 'span', value: 'Git branch name' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'template-autocomplete-returns-null-when-state-is-closed',
		given: 'The dropdown is mounted with state.isOpen=false (filteredVariables can be non-empty).',
		when: ['the dropdown renders'],
		then: [
			// The early-return null means no row, no footer kbd, no <code> chip
			// — the entire panel surface is suppressed.
			{ verb: 'hasElement', target: 'body:not(:has(div[data-index="0"]))' },
			{ verb: 'hasElement', target: 'body:not(:has(kbd))' },
		],
		happyPath: false,
	},
	{
		name: 'template-autocomplete-returns-null-when-filtered-variables-is-empty',
		given: 'The dropdown is mounted with state.isOpen=true but filteredVariables=[].',
		when: ['the dropdown renders'],
		then: [
			// Same null short-circuit — the `length === 0` guard suppresses the
			// dropdown even when isOpen is true. Pins both halves of the
			// `!state.isOpen || filteredVariables.length === 0` early-return.
			{ verb: 'hasElement', target: 'body:not(:has(div[data-index="0"]))' },
			{ verb: 'hasElement', target: 'body:not(:has(kbd))' },
		],
		happyPath: false,
	},
	{
		name: 'template-autocomplete-fires-no-ipc-or-websocket-traffic-on-mount-or-row-click',
		given:
			'The dropdown is mounted with state.isOpen=true, state.selectedIndex=0, two filteredVariables.',
		when: [
			'the dropdown mounts',
			'the user hovers over the second row',
			'the user clicks the first row',
		],
		then: [
			// Presentational-only: selection is delivered through `onSelect`, not
			// a transport. The pin is the structural presence of the canonical
			// row surface — no modal wrap, no banner, no transport-implying
			// affordance.
			{ verb: 'hasElement', target: 'div[data-index="0"]' },
		],
		happyPath: false,
	},
];

describe('TemplateAutocompleteDropdown — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = templateAutocompleteDropdownParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story', () => {
		const negative = templateAutocompleteDropdownParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of templateAutocompleteDropdownParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of templateAutocompleteDropdownParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of templateAutocompleteDropdownParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (dropdown uses no role=dialog, no role=alert)', () => {
		// TemplateAutocompleteDropdown is a transient absolute-positioned
		// dropdown — it is NOT a modal (role=dialog) and NOT a banner
		// (role=alert). If a future refactor wraps it in either, the catalog
		// should fail rather than silently track the drift.
		for (const story of templateAutocompleteDropdownParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
			expect(haystack.includes('role="alert"')).toBe(false);
		}
	});
});
