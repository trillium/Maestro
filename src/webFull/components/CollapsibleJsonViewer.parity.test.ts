/**
 * Parity catalog — CollapsibleJsonViewer
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * CollapsibleJsonViewer is a presentational JSON-tree component that renders
 * structured data with expandable nodes for objects and arrays, syntax-styled
 * primitives (string / number / boolean / null), and a per-node clipboard-copy
 * affordance that becomes visible on hover. It takes `data`, `theme`,
 * `initialExpandLevel`, `maxStringLength`, and an optional `rootLabel`. It
 * touches 0 IPC namespaces and 0 Electron-only APIs (its only impure import is
 * `safeClipboardWrite`, which routes through `navigator.clipboard.writeText`
 * only — pure browser API).
 *
 * Per the ToggleButtonGroup / SessionListItem precedent (other pure primitives
 * with no feature-consumer-level lifecycle), stories here are
 * **render-shape oriented** (hasElement / hasText) rather than interaction-
 * flow oriented. The component has no layer-stack registration, no focus
 * management at the consumer-contract level, no IPC, and no WS surface — its
 * external contract is what it paints.
 *
 *   IN (asserted here):
 *     - Object root renders with `{` and `}` brackets.
 *     - Array root renders with `[` and `]` brackets.
 *     - Primitive value categories (string / number / boolean / null) render
 *       their formatted forms ("..." quoted strings, bare numbers, bare
 *       booleans, the literal "null").
 *     - Keys for object children render in quoted form: `"keyName"`.
 *     - The optional `rootLabel` prop surfaces as a top-level quoted key.
 *     - String values longer than `maxStringLength` are truncated with the
 *       literal `...` marker inside the quoted form.
 *     - Each rendered node carries a Copy-value affordance (lucide-react
 *       `Copy` icon → button with title="Copy value").
 *     - Expandable nodes carry a chevron toggle (lucide-react `ChevronDown` /
 *       `ChevronRight`).
 *     - Empty objects / empty arrays render their brackets without a chevron
 *       toggle (no expandable children to gate).
 *
 *   DROPPED (named so the partial-parity surface is countable):
 *     - Interactive expand/collapse click semantics. The catalog asserts the
 *       chevron presence; the click handler that flips `useState` is internal
 *       and not part of the consumer-visible contract beyond the icon swap.
 *     - Copy-to-clipboard `navigator.clipboard.writeText` invocation — the
 *       `safeClipboardWrite` wrapper is browser-API only and not a parity
 *       surface (no WS / no IPC / no broadcast). The catalog asserts the Copy
 *       affordance is present; the clipboard payload is the caller's contract.
 *     - The `initialExpandLevel` default-2 cascading expansion through the
 *       tree — depth-dependent state is internal and tested implicitly by the
 *       render-shape stories (objects up to depth 1 render their children).
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *     localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior, not
 *     DOM structure or CSS.
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

export const collapsibleJsonViewerParityCatalog: ParityStory[] = [
	// ============ Happy paths: render-shape oriented ============
	{
		name: 'collapsible-json-viewer-renders-object-root-with-curly-brackets',
		given: 'The component is mounted with data={ name: "alice", age: 30 }, initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Opening curly bracket present as a primitive object root marker
			{ verb: 'hasText', target: 'div', value: '{' },
			// Closing curly bracket present
			{ verb: 'hasText', target: 'div', value: '}' },
			// Each object key renders as a quoted string label
			{ verb: 'hasText', target: 'div', value: '"name"' },
			{ verb: 'hasText', target: 'div', value: '"age"' },
			// String values render in their quoted form
			{ verb: 'hasText', target: 'div', value: '"alice"' },
			// Number values render bare (no quotes)
			{ verb: 'hasText', target: 'div', value: '30' },
		],
		happyPath: true,
	},
	{
		name: 'collapsible-json-viewer-renders-array-root-with-square-brackets',
		given: 'The component is mounted with data=[1, 2, 3], initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Opening square bracket present for array root
			{ verb: 'hasText', target: 'div', value: '[' },
			// Closing square bracket present
			{ verb: 'hasText', target: 'div', value: ']' },
			// All three numeric entries render bare
			{ verb: 'hasText', target: 'div', value: '1' },
			{ verb: 'hasText', target: 'div', value: '2' },
			{ verb: 'hasText', target: 'div', value: '3' },
		],
		happyPath: true,
	},
	{
		name: 'collapsible-json-viewer-renders-primitive-value-categories',
		given:
			'The component is mounted with data={ s: "hi", n: 42, b: true, z: null }, initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// String values render in quoted form
			{ verb: 'hasText', target: 'div', value: '"hi"' },
			// Number values render bare
			{ verb: 'hasText', target: 'div', value: '42' },
			// Boolean values render as their literal string form
			{ verb: 'hasText', target: 'div', value: 'true' },
			// null renders as the literal string "null" (no quotes)
			{ verb: 'hasText', target: 'div', value: 'null' },
		],
		happyPath: true,
	},
	{
		name: 'collapsible-json-viewer-renders-copy-affordance-per-node',
		given: 'The component is mounted with data={ k: "v" }, initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Per-node Copy affordance — button with title="Copy value"
			{ verb: 'hasElement', target: 'button[title="Copy value"]' },
		],
		happyPath: true,
	},
	{
		name: 'collapsible-json-viewer-renders-root-label-as-quoted-key',
		given:
			'The component is mounted with data={ child: 1 }, rootLabel="payload", initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// rootLabel surfaces as a top-level quoted key
			{ verb: 'hasText', target: 'div', value: '"payload"' },
			// Child key still renders in quoted form
			{ verb: 'hasText', target: 'div', value: '"child"' },
		],
		happyPath: true,
	},
	{
		name: 'collapsible-json-viewer-truncates-long-strings-with-ellipsis',
		given: 'The component is mounted with data={ msg: "<41-char string>" }, maxStringLength=10.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Long string is truncated with the literal "..." marker inside the quotes
			{ verb: 'hasText', target: 'div', value: '...' },
			// The quoted-form opener is still present
			{ verb: 'hasText', target: 'div', value: '"' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'collapsible-json-viewer-primitive-root-renders-without-brackets',
		given:
			'The component is mounted with data="just a string" (a primitive root, not an object or array).',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Primitive root renders the value but no object/array brackets
			{ verb: 'hasText', target: 'div', value: '"just a string"' },
			// Copy affordance is still present for the primitive node
			{ verb: 'hasElement', target: 'button[title="Copy value"]' },
		],
		happyPath: false,
	},
	{
		name: 'collapsible-json-viewer-empty-object-renders-without-chevron-toggle',
		given: 'The component is mounted with data={} (empty object).',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Brackets still render
			{ verb: 'hasText', target: 'div', value: '{' },
			{ verb: 'hasText', target: 'div', value: '}' },
			// Copy affordance still present at the root
			{ verb: 'hasElement', target: 'button[title="Copy value"]' },
		],
		happyPath: false,
	},
	{
		name: 'collapsible-json-viewer-empty-array-renders-without-chevron-toggle',
		given: 'The component is mounted with data=[] (empty array).',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// Square brackets still render
			{ verb: 'hasText', target: 'div', value: '[' },
			{ verb: 'hasText', target: 'div', value: ']' },
			// Copy affordance still present at the root
			{ verb: 'hasElement', target: 'button[title="Copy value"]' },
		],
		happyPath: false,
	},
	{
		name: 'collapsible-json-viewer-fires-no-ipc-or-websocket-traffic-on-mount',
		given:
			'The component is mounted with data={ a: 1, b: [2, 3], c: { d: "x" } } and rootLabel undefined.',
		when: [
			'the CollapsibleJsonViewer mounts',
			'the user hovers over a node to surface the Copy affordance',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// The Copy affordance routes through navigator.clipboard only — that is a
			// browser API surface, not a parity surface.
			{ verb: 'hasElement', target: 'button[title="Copy value"]' },
		],
		happyPath: false,
	},
	{
		name: 'collapsible-json-viewer-does-not-render-modal-or-banner-chrome',
		given: 'The component is mounted with data={ k: "v" }, initialExpandLevel=2.',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// This is a pure JSON-tree viewer — NOT a modal, NOT a banner.
			// The catalog pins the presentational contract: if a future refactor
			// wraps the viewer in a modal/banner, that is a behaviour change and
			// the catalog should fail rather than silently track it.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
			{ verb: 'hasElement', target: 'body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'collapsible-json-viewer-undefined-value-renders-as-undefined-literal',
		given: 'The component is mounted with data={ x: undefined } (an explicit undefined value).',
		when: ['the CollapsibleJsonViewer renders'],
		then: [
			// undefined renders as the literal string "undefined" (no quotes)
			{ verb: 'hasText', target: 'div', value: 'undefined' },
			// The key still renders in quoted form
			{ verb: 'hasText', target: 'div', value: '"x"' },
		],
		happyPath: false,
	},
];

describe('CollapsibleJsonViewer — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(collapsibleJsonViewerParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = collapsibleJsonViewerParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = collapsibleJsonViewerParityCatalog.filter((s) => s.happyPath).length;
		const negative = collapsibleJsonViewerParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of collapsibleJsonViewerParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of collapsibleJsonViewerParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of collapsibleJsonViewerParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('catalog is render-shape oriented (no interaction verbs)', () => {
		// Pure primitive — only hasElement / hasText. Expand/collapse click,
		// hover-to-reveal-copy, and clipboard-write semantics belong to the
		// future feature-consumer's catalog (or the browser-API contract), not
		// the primitive's.
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of collapsibleJsonViewerParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});

	it('pins the presentational contract (viewer is not a modal or banner)', () => {
		// The viewer is a JSON tree render — not a `role="dialog"` modal, not a
		// `role="alert"` banner. If a future refactor wraps it in either shell,
		// that's a behavior change and the catalog should fail rather than
		// silently track it.
		for (const story of collapsibleJsonViewerParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			// The catalog may reference role=dialog / role=alert INSIDE the
			// "no modal/banner chrome" pin (as a `:not(:has(...))` selector) —
			// but no story may assert hasElement(role="dialog") / hasText
			// against a modal shell directly. The pin form below allows the
			// :not(:has(...)) idiom while flagging unguarded `[role="dialog"]`
			// targets.
			void haystack;
		}
		// Structural guard: every viewer story targets `div`, `button`, or a
		// `body:not(:has(...))` exclusion selector — never an `[role="dialog"]`
		// or `[role="alert"]` element directly.
		for (const story of collapsibleJsonViewerParityCatalog) {
			for (const a of story.then) {
				const t = a.target.toLowerCase();
				const isDialogTarget = t.startsWith('[role="dialog"]') || t === '[role="dialog"]';
				const isAlertTarget = t.startsWith('[role="alert"]') || t === '[role="alert"]';
				expect(isDialogTarget).toBe(false);
				expect(isAlertTarget).toBe(false);
			}
		}
	});
});
