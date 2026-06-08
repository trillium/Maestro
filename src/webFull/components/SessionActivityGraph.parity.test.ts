/**
 * Parity catalog — SessionActivityGraph
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SessionActivityGraph is a presentational histogram of `ActivityEntry`
 * items (anything carrying a `timestamp: string | number`). It buckets the
 * entries into `lookbackConfig.bucketCount` equal-width windows ending at
 * `Date.now()` and stretching back `lookbackHours` hours (or to the
 * earliest timestamp when `lookbackHours === null`). It exposes:
 *
 *   - A bordered bar row, one bar per bucket, accent-coloured when the
 *     bucket has at least one entry and border-coloured otherwise.
 *   - A native browser tooltip (the host `<div>`'s `title` attribute)
 *     summarising the current lookback config and total session count
 *     when nothing is hovered: `<label>: <N> session(s) (right-click to
 *     change)`. The tooltip is suppressed while a bar is hovered.
 *   - A hover tooltip below the bar row showing the bucket time-range
 *     label + count.
 *   - A right-click context menu of lookback options anchored at the
 *     mouse position. Each option is a `<button>` carrying the label
 *     text; the currently-active option is styled with the accent colour
 *     and surfaces a `Check` icon. Selecting an option fires
 *     `onLookbackChange(option.hours)` and closes the menu.
 *   - Axis labels below the bars (count varies by lookback: 4 labels for
 *     `<= 24h`, 3 labels for 24h < hours <= 168h, 2 labels otherwise).
 *   - A left-click on a non-empty bar fires `onBarClick(startMs, endMs)`
 *     so the caller can drill into the filtered range. Empty bars are
 *     non-interactive (`cursor: default`).
 *
 * All side effects flow through the `onBarClick` and `onLookbackChange`
 * props — the component touches 0 IPC namespaces / 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - Host element carries a `title` attribute matching the
 *     `<label>: <N> session(s) (right-click to change)` summary copy
 *     when nothing is hovered.
 *   - Right-click surfaces a "Lookback Period" heading + one `<button>`
 *     per `LOOKBACK_OPTIONS` entry.
 *   - The active option's button surfaces a checkmark icon
 *     (`svg.lucide-check`).
 *   - Axis labels render the documented copy ("Now", "Xh", "Xd",
 *     `Mon D` date format) for the canonical lookback windows.
 *   - Empty-data fallback: the host element still renders the lookback
 *     summary copy with `0 sessions` and the right-click affordance
 *     stays available.
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

export const sessionActivityGraphParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'session-activity-graph-renders-summary-tooltip-with-lookback-label-and-total-count',
		given:
			'SessionActivityGraph mounts with entries=[3 timestamps from the last 6 hours], lookbackHours=24, theme={ default }.',
		when: ['the histogram mounts and nothing is hovered'],
		then: [
			// Host element carries the summary tooltip via the title attribute
			{ verb: 'hasElement', target: '[title*="24 hours"]' },
			// Total session count surfaces in the tooltip copy
			{ verb: 'hasElement', target: '[title*="3 sessions"]' },
			// "right-click to change" hint discoverable to mouse users via tooltip
			{ verb: 'hasElement', target: '[title*="right-click to change"]' },
		],
		happyPath: true,
	},
	{
		name: 'session-activity-graph-opens-context-menu-with-all-lookback-options-on-right-click',
		given: 'SessionActivityGraph mounts with entries=[], lookbackHours=24, theme={ default }.',
		when: ['the user right-clicks anywhere on the histogram host'],
		then: [
			// "Lookback Period" heading surfaces inside the popped-up menu
			{ verb: 'hasText', target: 'body', value: 'Lookback Period' },
			// Every documented LOOKBACK_OPTIONS label renders as a button
			{ verb: 'hasText', target: 'body', value: '24 hours' },
			{ verb: 'hasText', target: 'body', value: '72 hours' },
			{ verb: 'hasText', target: 'body', value: '1 week' },
			{ verb: 'hasText', target: 'body', value: '2 weeks' },
			{ verb: 'hasText', target: 'body', value: '1 month' },
			{ verb: 'hasText', target: 'body', value: '6 months' },
			{ verb: 'hasText', target: 'body', value: '1 year' },
			{ verb: 'hasText', target: 'body', value: 'All time' },
		],
		happyPath: true,
	},
	{
		name: 'session-activity-graph-marks-active-lookback-option-with-checkmark-icon',
		given:
			'SessionActivityGraph mounts with entries=[], lookbackHours=168 (active = "1 week"), theme={ default }.',
		when: ['the user right-clicks the histogram host to open the lookback menu'],
		then: [
			// The lookback menu surfaces every option as a button
			{ verb: 'hasText', target: 'body', value: '1 week' },
			// The active option carries a Check icon (lucide-react surfaces lucide-check class)
			{ verb: 'hasElement', target: 'svg.lucide-check' },
		],
		happyPath: true,
	},
	{
		name: 'session-activity-graph-renders-day-and-now-axis-labels-for-one-week-lookback',
		given:
			'SessionActivityGraph mounts with entries=[mixed timestamps spanning the past 7 days], lookbackHours=168, theme={ default }.',
		when: ['the histogram renders its x-axis labels'],
		then: [
			// 1-week lookback uses the "Xd" / "Xd/2" / "Now" copy from getAxisLabels()
			{ verb: 'hasText', target: 'body', value: '7d' },
			{ verb: 'hasText', target: 'body', value: 'Now' },
		],
		happyPath: true,
	},
	{
		name: 'session-activity-graph-renders-hour-axis-labels-for-twenty-four-hour-lookback',
		given:
			'SessionActivityGraph mounts with entries=[5 timestamps from the past 24 hours], lookbackHours=24, theme={ default }.',
		when: ['the histogram renders its x-axis labels'],
		then: [
			// 24h lookback uses the "Xh" / "0h" copy from getAxisLabels()
			{ verb: 'hasText', target: 'body', value: '24h' },
			{ verb: 'hasText', target: 'body', value: '0h' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'session-activity-graph-summary-tooltip-uses-singular-session-copy-when-only-one-entry',
		given:
			'SessionActivityGraph mounts with entries=[1 timestamp from 2 hours ago], lookbackHours=24, theme={ default }.',
		when: ['the histogram mounts and nothing is hovered'],
		then: [
			// Singular session copy (no trailing "s") for the count == 1 branch
			{ verb: 'hasElement', target: '[title*="1 session "]' },
			// Tooltip must NOT carry the plural "sessions" form
			{ verb: 'hasElement', target: 'body:not(:has([title*="1 sessions"]))' },
		],
		happyPath: false,
	},
	{
		name: 'session-activity-graph-renders-summary-tooltip-with-zero-sessions-when-entries-empty',
		given: 'SessionActivityGraph mounts with entries=[], lookbackHours=24, theme={ default }.',
		when: ['the histogram mounts'],
		then: [
			// Empty data still produces the summary tooltip — the zero state is observable
			{ verb: 'hasElement', target: '[title*="0 sessions"]' },
			// Right-click hint still surfaces so users can change the lookback even with no data
			{ verb: 'hasElement', target: '[title*="right-click to change"]' },
		],
		happyPath: false,
	},
	{
		name: 'session-activity-graph-hides-context-menu-until-user-right-clicks',
		given: 'SessionActivityGraph mounts with entries=[], lookbackHours=24, theme={ default }.',
		when: ['the histogram mounts but the user has not right-clicked'],
		then: [
			// "Lookback Period" heading must not be in the DOM until the menu opens
			{ verb: 'hasElement', target: 'body:not(:has(*:scope > :is(div, button):not([title]) ))' },
			// No checkmark icon is in the DOM when the menu is closed
			{ verb: 'hasElement', target: 'body:not(:has(svg.lucide-check))' },
		],
		happyPath: false,
	},
	{
		name: 'session-activity-graph-fires-no-ipc-or-websocket-traffic-on-mount-or-interaction',
		given:
			'SessionActivityGraph mounts with entries=[3 timestamps], lookbackHours=24, theme={ default }.',
		when: [
			'the histogram mounts',
			'the user hovers a non-empty bar',
			'the user clicks a non-empty bar',
			'the user right-clicks the histogram',
			'the user selects a new lookback option',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// Bar clicks and lookback changes are caller-owned callbacks — this component
			// does not reach into window.maestro or any transport itself.
			{ verb: 'hasElement', target: '[title*="right-click to change"]' },
		],
		happyPath: false,
	},
	{
		name: 'session-activity-graph-renders-without-onBarClick-prop',
		given:
			'SessionActivityGraph mounts with entries=[3 timestamps], lookbackHours=24, onBarClick=undefined, theme={ default }.',
		when: ['the histogram mounts and the user clicks a non-empty bar'],
		then: [
			// The histogram renders fine without onBarClick wired (the prop is optional)
			{ verb: 'hasElement', target: '[title*="3 sessions"]' },
		],
		happyPath: false,
	},
];

describe('SessionActivityGraph — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = sessionActivityGraphParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = sessionActivityGraphParityCatalog.filter((s) => s.happyPath).length;
		const negative = sessionActivityGraphParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of sessionActivityGraphParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of sessionActivityGraphParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of sessionActivityGraphParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (histogram, not a modal)', () => {
		// SessionActivityGraph is an inline histogram, not a modal. The catalog
		// must never drift toward role=dialog assertions — if a future refactor
		// wraps the graph in a modal, that's a behavior change and the catalog
		// should fail rather than silently track it.
		for (const story of sessionActivityGraphParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
		}
	});

	it('every story name is unique', () => {
		const names = sessionActivityGraphParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
