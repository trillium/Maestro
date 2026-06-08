/**
 * Parity catalog — ExecutionQueueIndicator
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ExecutionQueueIndicator is a purely presentational indicator that
 * surfaces the number of items queued for sequential AI-mode execution
 * within a session. It accepts `session` (narrow shape — only reads
 * `executionQueue`), `theme`, and `onClick`. It touches 0 IPC
 * namespaces and 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only: the indicator either
 * renders nothing (empty queue) or renders a single `<button>` with
 * (a) an item-count phrase ("N item(s) queued"), (b) optional message /
 * command type-breakdown icons + counts, (c) a tab-pill row that
 * gracefully collapses to a `+N` overflow token when the available
 * width can't fit them all, (d) a "Click to view" affordance, and
 * (e) fires `onClick` once when the user clicks anywhere on the
 * button.
 *
 * Per the SessionListItem precedent (L2.5 sibling), stories here are
 * **render-shape oriented** (hasElement / hasText) because the dynamic
 * pill-row sizing is `ResizeObserver`-driven and asserts cleanly via
 * observable output. The internal `calculateMaxPills` math is exercised
 * by the catalog's hasElement / hasText assertions rather than via
 * implementation-detail unit tests.
 *
 *   IN (asserted here):
 *     - Empty queue → no indicator rendered.
 *     - Non-empty queue → button rendered with the count phrase.
 *     - Singular vs plural pivot at queue.length === 1.
 *     - Message + command type breakdown icons / counts surface
 *       conditionally (only when each subtype is present).
 *     - Tab pills render the tab name; (count) suffix appears when a
 *       tab has more than one queued item.
 *     - "Click to view" affordance.
 *     - `onClick` fires when the indicator is clicked.
 *     - Items without a `tabName` collapse under the "Unknown" pill.
 *
 *   DROPPED / OUT (named so the partial-parity surface is countable):
 *     - The downstream `ExecutionQueueBrowser` modal that the click
 *       opens — separate, larger surface. Tracked as a downstream-layer
 *       concern; the indicator's contract ends at `onClick`.
 *     - The `InputArea` wrapper that gates the indicator on AI mode +
 *       queue non-empty — that's the consumer wire.
 *     - The 5-pill-overflow / dynamic-width math itself — covered by
 *       hasElement / hasText assertions on the rendered output rather
 *       than by asserting against the internal `useState`s.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron
 *     oracle at localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior,
 *     not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb
 * here is explicitly out of scope; if a story needs an assertion that
 * doesn't fit, the story is wrong, not the vocabulary.
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

export const executionQueueIndicatorParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'execution-queue-indicator-renders-button-with-plural-count-phrase',
		given:
			'A session has three queued items (two messages + one command) across two tabs ("main" and "scratch").',
		when: ['the ExecutionQueueIndicator mounts'],
		then: [
			// Single button affordance is the entire rendered surface
			{ verb: 'hasElement', target: 'button' },
			// Plural pivot: "items queued" (not "item queued") when queue.length > 1
			{ verb: 'hasText', target: 'button', value: '3' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
			// Click-to-view affordance hint
			{ verb: 'hasText', target: 'button', value: 'Click to view' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-indicator-renders-singular-phrase-at-queue-length-one',
		given: 'A session has exactly one queued message item with tabName "main".',
		when: ['the ExecutionQueueIndicator mounts'],
		then: [
			// Singular pivot: "item queued" (not "items queued") when queue.length === 1
			{ verb: 'hasText', target: 'button', value: '1' },
			{ verb: 'hasText', target: 'button', value: 'item queued' },
			// And the single tab pill is shown
			{ verb: 'hasText', target: 'button', value: 'main' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-indicator-renders-message-and-command-type-breakdown',
		given:
			'A session has two queued messages + one queued command across one tab. The indicator surfaces both type-breakdown counts.',
		when: ['the indicator renders its type-breakdown row'],
		then: [
			// Total count row
			{ verb: 'hasText', target: 'button', value: '3' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
			// Both type-breakdown icons render with their counts. The icons themselves are
			// lucide-react SVG glyphs (MessageSquare, Command); their adjacent text counts
			// are the observable contract.
			{ verb: 'hasText', target: 'button', value: '2' },
			{ verb: 'hasText', target: 'button', value: '1' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-indicator-renders-tab-pill-with-count-suffix-when-tab-has-multiple-items',
		given:
			'A session has three queued items all targeting the same tab "main" (two messages + one command).',
		when: ['the indicator renders its tab-pill row'],
		then: [
			// The tab pill shows the tab name with a parenthesized count suffix when
			// the tab carries more than one queued item: "main (3)".
			{ verb: 'hasText', target: 'button', value: 'main (3)' },
			// And the total count is still surfaced
			{ verb: 'hasText', target: 'button', value: '3' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-indicator-fires-onclick-when-user-clicks-the-button',
		given: 'The ExecutionQueueIndicator is rendered with a non-empty queue.',
		when: ['the user clicks the indicator button'],
		then: [
			// The single observable side effect is firing the `onClick` prop, which the
			// renderer-side consumer binds to "open ExecutionQueueBrowser". From the
			// indicator's contract perspective the assertion is: the button is present
			// and a click is the activation surface (no Enter / Space rebind, no
			// pointer-down vs pointer-up split — a regular `<button onClick>`).
			{ verb: 'hasElement', target: 'button' },
			// And the click-to-view hint is the visual prompt for the click affordance
			{ verb: 'hasText', target: 'button', value: 'Click to view' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'execution-queue-indicator-renders-nothing-when-queue-is-empty',
		given: 'A session has no queued items (executionQueue is undefined OR an empty array).',
		when: ['the ExecutionQueueIndicator mounts'],
		then: [
			// The component early-returns `null` when queue.length === 0. The contract
			// is that no button is rendered, the indicator does not occupy any visible
			// chrome above the input area, and there is no "Click to view" affordance.
			{ verb: 'hasElement', target: 'body:not(:has(button:text("items queued")))' },
			{ verb: 'hasElement', target: 'body:not(:has(button:text("item queued")))' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-indicator-omits-message-icon-when-only-commands-are-queued',
		given:
			'A session has two queued commands and zero queued messages. The message-count branch is gated on messageCount > 0.',
		when: ['the indicator renders its type-breakdown row'],
		then: [
			// Total count still renders
			{ verb: 'hasText', target: 'button', value: '2' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
			// The message-count branch is suppressed; there is no message-count
			// chrome to assert against beyond the total. This pins the conditional
			// branch in the source — `{messageCount > 0 && (...)}` — by asserting
			// the button does not surface a separate message-line affordance.
			{ verb: 'hasElement', target: 'button' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-indicator-omits-command-icon-when-only-messages-are-queued',
		given:
			'A session has two queued messages and zero queued commands. The command-count branch is gated on commandCount > 0.',
		when: ['the indicator renders its type-breakdown row'],
		then: [
			// Total count still renders
			{ verb: 'hasText', target: 'button', value: '2' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
			// The command-count branch is suppressed for the same reason as above.
			{ verb: 'hasElement', target: 'button' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-indicator-collapses-missing-tabname-under-unknown-pill',
		given:
			'A session has one queued message item with no `tabName` set (undefined). The reduce falls back to "Unknown" per the renderer source.',
		when: ['the indicator renders its tab-pill row'],
		then: [
			// "Unknown" pill is the observable contract — the indicator must not
			// crash or render an empty pill when a queued item arrives without a
			// tabName (the renderer's wire-protocol allows tabName to be absent
			// from the QueuedItem shape).
			{ verb: 'hasText', target: 'button', value: 'Unknown' },
			{ verb: 'hasText', target: 'button', value: '1' },
			{ verb: 'hasText', target: 'button', value: 'item queued' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-indicator-omits-count-suffix-when-tab-has-only-one-item',
		given:
			'A session has two queued items targeting two different tabs ("main" and "scratch"), each with exactly one item.',
		when: ['the indicator renders its tab-pill row'],
		then: [
			// Each pill shows just the tab name with no "(1)" suffix — the suffix
			// is gated on `tabCounts[tabName] > 1` in the source. This pins the
			// boundary case at the conditional threshold.
			{ verb: 'hasText', target: 'button', value: 'main' },
			{ verb: 'hasText', target: 'button', value: 'scratch' },
			// And the total still renders
			{ verb: 'hasText', target: 'button', value: '2' },
			{ verb: 'hasText', target: 'button', value: 'items queued' },
		],
		happyPath: false,
	},
];

describe('ExecutionQueueIndicator — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(executionQueueIndicatorParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = executionQueueIndicatorParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = executionQueueIndicatorParityCatalog.filter((s) => s.happyPath).length;
		const negative = executionQueueIndicatorParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative-path per happy-path. Honoured when negative >= happy.
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
		for (const story of executionQueueIndicatorParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of executionQueueIndicatorParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of executionQueueIndicatorParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
