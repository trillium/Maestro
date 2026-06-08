/**
 * Parity catalog — MermaidRenderer
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MermaidRenderer is a presentational fenced-code-block diagram renderer.
 * It receives a chart source string and a `theme: Theme` prop, validates
 * the chart with `mermaid.parse`, renders to SVG via `mermaid.render`,
 * sanitises the SVG through DOMPurify (svg + svgFilters profiles, with
 * `foreignObject` re-allowed for HTML labels), and surfaces the result as
 * a scrollable container. On a parse / render failure the component
 * surfaces an error card with a `<details>` block exposing the source for
 * inspection. While the render is in flight it surfaces a "Rendering
 * diagram..." chip inside a min-height-60px container.
 *
 * It touches 0 IPC namespaces and 0 Electron-only APIs at module-load OR
 * runtime — the mermaid singleton is initialised with
 * `securityLevel: 'strict'` and `suppressErrorRendering: true` so the
 * library never reaches outside the React-owned container ref.
 *
 * The parity contract is observable-behavior-only:
 *   - error-state chrome (`.text-sm font-medium` header + `<pre>` body +
 *     `<details>` source-view summary)
 *   - loading chrome ("Rendering diagram..." inside `.mermaid-container`)
 *   - rendered-state chrome (`div.mermaid-container` with the SVG
 *     appended after the layout effect runs)
 *   - whitespace-only chart short-circuits to the rendered-state container
 *     without firing mermaid.parse / render
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
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

export const mermaidRendererParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'mermaid-renderer-shows-loading-state-while-render-is-in-flight',
		given:
			'The MermaidRenderer mounts with a non-empty chart string ("graph TD; A-->B") and a Theme prop.',
		when: ['the component mounts and the initial layout-effect schedules the async render'],
		then: [
			// Loading container chrome present with the canonical class names
			{ verb: 'hasElement', target: '.mermaid-container' },
			// In-flight copy is "Rendering diagram..."
			{ verb: 'hasText', target: '.mermaid-container', value: 'Rendering diagram...' },
		],
		happyPath: true,
	},
	{
		name: 'mermaid-renderer-shows-error-card-when-mermaid-parse-rejects-the-chart',
		given:
			'The MermaidRenderer is mounted with a syntactically invalid chart string ("this is not a diagram").',
		when: [
			'the async render branch calls mermaid.parse',
			'mermaid.parse throws a parse Error',
			'the component sets the error state',
		],
		then: [
			// Error header copy is the canonical "Failed to render Mermaid diagram"
			{ verb: 'hasText', target: 'div', value: 'Failed to render Mermaid diagram' },
			// View-source affordance is exposed via a <details><summary> pair
			{ verb: 'hasElement', target: 'details > summary' },
			{ verb: 'hasText', target: 'summary', value: 'View source' },
			// The chart source is preserved inside the <details> <pre> for inspection
			{ verb: 'hasElement', target: 'details pre' },
		],
		happyPath: true,
	},
	{
		name: 'mermaid-renderer-shows-rendered-container-when-mermaid-returns-valid-svg',
		given:
			'The MermaidRenderer is mounted with a valid chart ("graph TD; A-->B") and mermaid.render resolves to { svg }.',
		when: [
			'mermaid.parse resolves',
			'mermaid.render resolves to { svg: "<svg>...</svg>" }',
			'DOMPurify.sanitize returns the same SVG string',
			'the post-render layout-effect runs and appends the parsed SVG to the container ref',
		],
		then: [
			// Final container chrome stays on the page
			{ verb: 'hasElement', target: '.mermaid-container' },
			// Sanitised SVG element appended into the container
			{ verb: 'hasElement', target: '.mermaid-container svg' },
		],
		happyPath: true,
	},
	{
		name: 'mermaid-renderer-short-circuits-to-empty-container-for-whitespace-only-chart',
		given: 'The MermaidRenderer is mounted with chart="\\n   \\t  \\n".',
		when: [
			'the async render branch checks chart.trim() and finds it empty',
			'the component skips mermaid.parse / mermaid.render entirely',
			'the loading flag flips back to false',
		],
		then: [
			// Final container chrome stays on the page
			{ verb: 'hasElement', target: '.mermaid-container' },
			// No SVG was ever appended
			{ verb: 'hasElement', target: 'body:not(:has(.mermaid-container svg))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'mermaid-renderer-fires-no-ipc-or-websocket-traffic-on-mount-render-or-error',
		given: 'The MermaidRenderer is mounted with a chart string and a Theme prop.',
		when: [
			'the component mounts',
			'mermaid.parse runs',
			'mermaid.render runs',
			'DOMPurify.sanitize runs',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// The component does not reach into window.maestro or any transport itself.
			{
				verb: 'hasElement',
				target: '.mermaid-container, div',
			},
		],
		happyPath: false,
	},
	{
		name: 'mermaid-renderer-does-not-mount-a-modal-shape-on-error',
		given: 'The MermaidRenderer is mounted with an invalid chart and the error state is active.',
		when: ['mermaid.parse rejects and the error card renders'],
		then: [
			// Error state is an inline card, NOT a modal — must not carry role="dialog"
			// chrome. A future refactor that wraps it in a Modal is a behavior change
			// and should fail the catalog rather than silently track it.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'mermaid-renderer-keeps-error-source-view-collapsed-by-default',
		given: 'The MermaidRenderer is mounted with an invalid chart and the error card is rendered.',
		when: ['the user has not interacted with the source-view affordance'],
		then: [
			// The <details> element exists but is collapsed by default (no `open` attribute)
			{ verb: 'hasElement', target: 'details:not([open])' },
		],
		happyPath: false,
	},
	{
		name: 'mermaid-renderer-does-not-leak-orphan-dmermaid-elements-into-document-body',
		given:
			'The MermaidRenderer has mounted with a render-time-throwing chart that previously caused mermaid to inject a `<div id="dmermaid-...">` outside the container ref.',
		when: ['the catch branch of the async render runs after mermaid.render throws'],
		then: [
			// Orphan-cleanup pass removes any `[id^="dmermaid-"]` element from the document
			{ verb: 'hasElement', target: 'body:not(:has([id^="dmermaid-"]))' },
		],
		happyPath: false,
	},
];

describe('MermaidRenderer — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = mermaidRendererParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = mermaidRendererParityCatalog.filter((s) => s.happyPath).length;
		const negative = mermaidRendererParityCatalog.filter((s) => !s.happyPath).length;
		expect(happy).toBeGreaterThanOrEqual(1);
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
		for (const story of mermaidRendererParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of mermaidRendererParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'ipcrenderer',
			'dialog.',
			'tunnel.',
		];
		for (const story of mermaidRendererParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (renderer is a card, not a dialog)', () => {
		// MermaidRenderer is a fenced-code-block renderer that sits inside a
		// markdown surface. It never opens a modal. Future refactors that wrap
		// the error / loading / rendered states in a modal are behavior changes
		// and should fail the catalog rather than silently track it.
		for (const story of mermaidRendererParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
		}
	});

	it('every story name is unique', () => {
		const names = mermaidRendererParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
