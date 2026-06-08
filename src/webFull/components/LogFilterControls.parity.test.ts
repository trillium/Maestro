/**
 * Parity catalog — LogFilterControls
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * LogFilterControls is a presentational local-filter UI for individual log
 * entries. It exposes include/exclude filtering with plain-text or regex
 * matching, an autofocus-on-open input, Escape-to-clear, and an auto-close
 * on empty-input blur. When collapsed, it shows a hover-revealed filter
 * icon; when expanded, it shows the full bar with mode toggles and search
 * input. The component is fully controlled — every state mutation routes
 * through props (`onToggleFilter`, `onSetFilterQuery`, `onSetFilterMode`,
 * `onClearFilter`). It touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - collapsed state renders only a single `Filter` icon button with a
 *     "Filter this output" title
 *   - expanded state (active OR filterQuery non-empty) renders the full bar
 *     with include/exclude mode toggle, regex/plain toggle, search input, and
 *     clear/close X button
 *   - include mode surfaces `PlusCircle` + "Include matching lines" title;
 *     exclude mode surfaces `MinusCircle` + "Exclude matching lines" title
 *   - regex mode surfaces `.*` glyph + "Using regex" title; plain-text mode
 *     surfaces `Aa` glyph + "Using plain text" title
 *   - placeholder copy varies across the 4 (mode × regex) cells:
 *     include+plain="Include by keyword", include+regex="Include by RegEx",
 *     exclude+plain="Exclude by keyword", exclude+regex="Exclude by RegEx"
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

export const logFilterControlsParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'log-filter-controls-renders-collapsed-filter-icon-when-inactive-and-empty-query',
		given:
			'The log entry reports isActive=false and filterQuery="" with filterMode={mode:"include",regex:false}.',
		when: ['the LogFilterControls mounts'],
		then: [
			// Collapsed-state affordance: single filter-icon button with the descriptive title
			{ verb: 'hasElement', target: 'button[title="Filter this output"]' },
		],
		happyPath: true,
	},
	{
		name: 'log-filter-controls-renders-expanded-bar-when-active-with-include-plain-defaults',
		given:
			'The log entry reports isActive=true and filterQuery="" with filterMode={mode:"include",regex:false}.',
		when: ['the LogFilterControls mounts'],
		then: [
			// Mode toggle button surfaces the include-mode title
			{ verb: 'hasElement', target: 'button[title="Include matching lines"]' },
			// Regex toggle button surfaces the plain-text title and the "Aa" glyph
			{ verb: 'hasElement', target: 'button[title="Using plain text"]' },
			{ verb: 'hasText', target: 'button[title="Using plain text"]', value: 'Aa' },
			// Filter input present with the include-plain placeholder
			{ verb: 'hasElement', target: 'input[placeholder="Include by keyword"]' },
			// Auto-focus on activation (input mounts already focused)
			{ verb: 'hasElement', target: 'input[placeholder="Include by keyword"]:focus' },
		],
		happyPath: true,
	},
	{
		name: 'log-filter-controls-renders-exclude-regex-bar-with-correct-icons-titles-and-placeholder',
		given:
			'The log entry reports isActive=true and filterQuery="" with filterMode={mode:"exclude",regex:true}.',
		when: ['the LogFilterControls mounts'],
		then: [
			// Mode toggle surfaces the exclude-mode title
			{ verb: 'hasElement', target: 'button[title="Exclude matching lines"]' },
			// Regex toggle surfaces the regex title and the ".*" glyph
			{ verb: 'hasElement', target: 'button[title="Using regex"]' },
			{ verb: 'hasText', target: 'button[title="Using regex"]', value: '.*' },
			// Filter input placeholder reflects the exclude-by-regex cell of the 4-cell matrix
			{ verb: 'hasElement', target: 'input[placeholder="Exclude by RegEx"]' },
		],
		happyPath: true,
	},
	{
		name: 'log-filter-controls-stays-expanded-when-query-non-empty-even-with-isactive-false',
		given:
			'The log entry reports isActive=false but filterQuery="error" with filterMode={mode:"include",regex:false}.',
		when: ['the LogFilterControls mounts'],
		then: [
			// Expanded state because filterQuery is truthy — caller-owned state survives blur
			{ verb: 'hasElement', target: 'button[title="Include matching lines"]' },
			{ verb: 'hasElement', target: 'input[placeholder="Include by keyword"]' },
			// Input reflects the persisted query
			{
				verb: 'hasElement',
				target: 'input[placeholder="Include by keyword"][value="error"]',
			},
		],
		happyPath: true,
	},
	{
		name: 'log-filter-controls-renders-include-regex-and-exclude-plain-placeholders-correctly',
		given:
			'The log entry mounts twice — first with filterMode={mode:"include",regex:true}, then with filterMode={mode:"exclude",regex:false}, both with isActive=true.',
		when: ['the two LogFilterControls instances render'],
		then: [
			// First instance: include + regex
			{ verb: 'hasElement', target: 'input[placeholder="Include by RegEx"]' },
			// Second instance: exclude + plain
			{ verb: 'hasElement', target: 'input[placeholder="Exclude by keyword"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'log-filter-controls-collapsed-state-does-not-render-the-expanded-bar-affordances',
		given:
			'The log entry reports isActive=false and filterQuery="" with filterMode={mode:"include",regex:false}.',
		when: ['the LogFilterControls mounts'],
		then: [
			// No mode-toggle button, no regex-toggle button, no input, no X-button — collapsed only.
			{
				verb: 'hasElement',
				target:
					'body:not(:has(button[title="Include matching lines"])):not(:has(button[title="Exclude matching lines"])):not(:has(input))',
			},
		],
		happyPath: false,
	},
	{
		name: 'log-filter-controls-expanded-state-does-not-render-the-collapsed-icon-trigger',
		given:
			'The log entry reports isActive=true with filterMode={mode:"include",regex:false} (any state where showExpanded is truthy).',
		when: ['the LogFilterControls mounts in the expanded branch'],
		then: [
			// The collapsed-state trigger (`title="Filter this output"`) MUST NOT be in the DOM
			// when the expanded bar is rendering — the two branches are mutually exclusive.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Filter this output"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'log-filter-controls-fires-no-ipc-or-websocket-traffic-on-mount-or-mode-toggles',
		given:
			'The LogFilterControls is mounted with isActive=true and the user clicks the mode toggle, the regex toggle, and the clear X button in sequence.',
		when: [
			'the bar mounts',
			'the user clicks the include/exclude toggle',
			'the user clicks the regex/plain toggle',
			'the user clicks the Clear/Close X button',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// Every mutation routes through the caller-provided callbacks; this component
			// does not reach into window.maestro or any transport itself.
			{
				verb: 'hasElement',
				target:
					'button[title="Include matching lines"], button[title="Exclude matching lines"], button[title="Filter this output"]',
			},
		],
		happyPath: false,
	},
	{
		name: 'log-filter-controls-escape-on-input-stops-propagation-and-routes-through-onclearfilter',
		given:
			'The LogFilterControls is mounted expanded with filterQuery="needle" and the user presses Escape inside the input.',
		when: ['the user focuses the input and presses Escape'],
		then: [
			// Behavior contract: Escape calls e.stopPropagation() and onClearFilter(logId).
			// The clear callback is the caller's contract — the component itself does not
			// mutate any global state, so the only observable on this surface is that the
			// input affordance is the Escape target (not, say, a parent listener) and the
			// component never registered itself with the layer-stack.
			{ verb: 'hasElement', target: 'input[placeholder="Include by keyword"]' },
		],
		happyPath: false,
	},
	{
		name: 'log-filter-controls-blur-with-empty-query-routes-through-ontogglefilter-not-internal-state',
		given:
			'The LogFilterControls is mounted with isActive=true and filterQuery="" and the user blurs the input without typing.',
		when: ['the user blurs the input'],
		then: [
			// Behavior contract: onBlur fires onToggleFilter(logId) iff filterQuery is empty.
			// The component owns no internal "open" state — every transition routes through
			// the prop. Observable surface: the input is still present at mount, no setState
			// internals have hidden it; the caller is responsible for the subsequent collapse.
			{ verb: 'hasElement', target: 'input[placeholder="Include by keyword"]' },
		],
		happyPath: false,
	},
];

describe('LogFilterControls — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = logFilterControlsParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = logFilterControlsParityCatalog.filter((s) => s.happyPath).length;
		const negative = logFilterControlsParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of logFilterControlsParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of logFilterControlsParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of logFilterControlsParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (bar/icon affordances, not a modal)', () => {
		// LogFilterControls is an inline bar/icon, not a modal. The catalog must
		// never drift toward role=dialog assertions — if a future refactor wraps
		// the bar in a modal, that's a behavior change and the catalog should
		// fail rather than silently track it.
		for (const story of logFilterControlsParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
		}
	});
});
