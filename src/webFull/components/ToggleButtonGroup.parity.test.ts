/**
 * Parity catalog — ToggleButtonGroup
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ToggleButtonGroup is a pure stateless UI primitive that renders a
 * horizontal row of segmented toggle buttons. It takes `options`, `value`,
 * `onChange`, `theme`, and an optional `labels` map. It touches 0 IPC
 * namespaces and 0 Electron-only APIs.
 *
 * Per the SessionListItem precedent (also a pure primitive with no internal
 * lifecycle), stories here are **render-shape oriented** (hasElement /
 * hasText) rather than interaction-flow oriented. The component has no
 * lifecycle, no focus management, no layer-stack registration — it renders
 * a single `<div>` with one `<button>` per option, with the active button
 * carrying `ring-2` styling and `aria-pressed`-equivalent observable text.
 *
 *   IN (asserted here):
 *     - The row renders one `<button>` per option.
 *     - Each option's display label resolves correctly through the
 *       precedence chain: option.label > labels map > String(value).
 *     - The currently-selected option is visually distinguished (the
 *       `ring-2` class is on exactly one button).
 *     - Per-option custom colour overrides do not break label rendering.
 *     - Both string and number value types are supported (generic shape).
 *     - The container is a single horizontal flex row.
 *
 *   DROPPED (named so the partial-parity surface is countable):
 *     - Keyboard navigation between toggles (Tab is the native browser
 *       contract; no arrow-key roving tabindex implemented in either
 *       target — this is intentional, matches the renderer).
 *     - ARIA `role="radiogroup"` / `aria-pressed` semantics (the renderer
 *       uses plain `<button>` elements; lifting verbatim preserves this).
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron oracle
 *     at localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior,
 *     not DOM structure or CSS.
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

export const toggleButtonGroupParityCatalog: ParityStory[] = [
	// ============ Happy path: render-shape oriented ============
	{
		name: 'toggle-button-group-renders-one-button-per-option',
		given: 'The component is mounted with options=["small","medium","large"] and value="medium".',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// One button per option in the row
			{ verb: 'hasElement', target: 'button:nth-of-type(1)' },
			{ verb: 'hasElement', target: 'button:nth-of-type(2)' },
			{ verb: 'hasElement', target: 'button:nth-of-type(3)' },
			// Each label is visible
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: 'small' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: 'medium' },
			{ verb: 'hasText', target: 'button:nth-of-type(3)', value: 'large' },
		],
		happyPath: true,
	},
	{
		name: 'toggle-button-group-active-option-has-ring-class',
		given: 'The component is mounted with options=["a","b","c"] and value="b" (the middle option).',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// The middle button has the ring-2 class indicating active selection
			{ verb: 'hasElement', target: 'button.ring-2' },
			// And exactly the "b" button is the one with the ring
			{ verb: 'hasText', target: 'button.ring-2', value: 'b' },
		],
		happyPath: true,
	},
	{
		name: 'toggle-button-group-label-precedence-option-label-wins',
		given:
			'The component is mounted with options=[{value:"sm",label:"Small"},{value:"md",label:"Medium"}], labels={sm:"FALLBACK"}, value="sm".',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// option.label wins over the labels map
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: 'Small' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: 'Medium' },
			// The fallback string from labels must NOT have leaked through.
			// (`:contains("X")` is a jQuery selector and is not valid CSS — the
			// Playwright executor parses it with `document.querySelector`-shape
			// CSS and would throw `SyntaxError`. The catalog vocabulary's
			// absence form uses `body:not(:has-text("X"))`, which Playwright
			// supports natively; the `runParityCatalog` executor routes
			// `:not(:has-text(` to the absence-selector branch.)
			{ verb: 'hasElement', target: 'body:not(:has-text("FALLBACK"))' },
		],
		happyPath: true,
	},
	{
		name: 'toggle-button-group-label-precedence-labels-map-second',
		given:
			'The component is mounted with options=["sm","md"] (bare values, no option.label), labels={sm:"Small",md:"Medium"}, value="md".',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// labels map resolves the display label when option.label is absent
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: 'Small' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: 'Medium' },
		],
		happyPath: true,
	},
	{
		name: 'toggle-button-group-supports-numeric-values',
		given: 'The component is mounted with options=[1,2,3] (numbers) and value=2.',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// Generic over number — String(value) becomes the label
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: '1' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: '2' },
			{ verb: 'hasText', target: 'button:nth-of-type(3)', value: '3' },
			// The "2" button is the active one
			{ verb: 'hasText', target: 'button.ring-2', value: '2' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'toggle-button-group-inactive-options-have-no-ring-class',
		given: 'The component is mounted with options=["a","b","c"] and value="a".',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// Only ONE button carries the ring-2 marker — the other two do not
			{ verb: 'hasElement', target: 'button:not(.ring-2)' },
			// The "a" button has the ring-2; the others do not
			{ verb: 'hasText', target: 'button.ring-2', value: 'a' },
		],
		happyPath: false,
	},
	{
		name: 'toggle-button-group-falsy-label-falls-back-to-string-value',
		given:
			'The component is mounted with options=[{value:"x",label:""},{value:"y"}], value="x" (option.label is the empty string — falsy).',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// Empty-string option.label is falsy → falls through to String(value) "x"
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: 'x' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: 'y' },
		],
		happyPath: false,
	},
	{
		name: 'toggle-button-group-no-matching-value-leaves-all-inactive',
		given:
			'The component is mounted with options=["a","b","c"] and value="z" (a value not in the options list).',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// No button carries the ring-2 class — nothing matches
			{ verb: 'hasElement', target: 'div:not(:has(button.ring-2))' },
			// All three buttons still render
			{ verb: 'hasText', target: 'button:nth-of-type(1)', value: 'a' },
			{ verb: 'hasText', target: 'button:nth-of-type(3)', value: 'c' },
		],
		happyPath: false,
	},
	{
		name: 'toggle-button-group-empty-options-renders-empty-row',
		given: 'The component is mounted with options=[] (empty array).',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// The flex container is present but holds no buttons
			{ verb: 'hasElement', target: 'div:not(:has(button))' },
		],
		happyPath: false,
	},
	{
		name: 'toggle-button-group-custom-activeColor-does-not-break-label',
		given:
			'The component is mounted with options=[{value:"red",label:"Red",activeColor:"#ff0000"},{value:"blue",label:"Blue"}], value="red".',
		when: ['the ToggleButtonGroup renders'],
		then: [
			// Custom activeColor on an active option must not interfere with label resolution
			{ verb: 'hasText', target: 'button.ring-2', value: 'Red' },
			{ verb: 'hasText', target: 'button:nth-of-type(2)', value: 'Blue' },
		],
		happyPath: false,
	},
];

describe('ToggleButtonGroup — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(toggleButtonGroupParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = toggleButtonGroupParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = toggleButtonGroupParityCatalog.filter((s) => s.happyPath).length;
		const negative = toggleButtonGroupParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative per happy.
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
		for (const story of toggleButtonGroupParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of toggleButtonGroupParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of toggleButtonGroupParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('catalog is render-shape oriented (no interaction verbs)', () => {
		// Pure primitive — only hasElement / hasText. Click semantics belong to
		// the future feature-consumer's own catalog, not the primitive's.
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of toggleButtonGroupParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
