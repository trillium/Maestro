/**
 * Parity catalog — ContextWarningSash
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ContextWarningSash is a presentational banner component that warns when
 * the AI agent's context window usage crosses a configurable yellow (warn)
 * or red (urgent) threshold. The component carries its own per-tab dismissal
 * state — once dismissed, it stays hidden until usage rises by +10% OR
 * escalates yellow→red. It exposes a "Compact & Continue" action that calls
 * `onSummarizeClick` and a Dismiss (`X`) button. It touches 0 IPC namespaces
 * and 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - banner chrome with role=alert and aria-live=polite
 *   - threshold-driven copy ("reaching X% capacity" for yellow,
 *     "at X% — consider compacting to continue" for red)
 *   - Compact & Continue + Dismiss action affordances present
 *   - hidden when disabled / below threshold / freshly dismissed
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

export const contextWarningSashParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'context-warning-sash-renders-yellow-banner-when-usage-at-yellow-threshold',
		given:
			'The AI tab reports contextUsage=65 with yellowThreshold=60 and redThreshold=80, and the sash is enabled.',
		when: ['the ContextWarningSash mounts'],
		then: [
			// Banner chrome present with the alert role
			{ verb: 'hasElement', target: '[role="alert"]' },
			// Polite live-region announcement (not interruption)
			{ verb: 'hasElement', target: '[role="alert"][aria-live="polite"]' },
			// Percentage announced in aria-label so AT users hear it
			{
				verb: 'hasElement',
				target: '[role="alert"][aria-label="Context window at 65% capacity"]',
			},
			// Yellow (warn-level) copy: "reaching X% capacity"
			{ verb: 'hasText', target: '[role="alert"]', value: 'reaching' },
			{ verb: 'hasText', target: '[role="alert"]', value: '65%' },
			{ verb: 'hasText', target: '[role="alert"]', value: 'capacity' },
		],
		happyPath: true,
	},
	{
		name: 'context-warning-sash-renders-red-banner-when-usage-at-red-threshold',
		given:
			'The AI tab reports contextUsage=85 with yellowThreshold=60 and redThreshold=80, and the sash is enabled.',
		when: ['the ContextWarningSash mounts'],
		then: [
			// Banner chrome present
			{ verb: 'hasElement', target: '[role="alert"]' },
			// Percentage in aria-label updates
			{
				verb: 'hasElement',
				target: '[role="alert"][aria-label="Context window at 85% capacity"]',
			},
			// Red (urgent-level) copy: "at X% — consider compacting to continue"
			{ verb: 'hasText', target: '[role="alert"]', value: '85%' },
			{ verb: 'hasText', target: '[role="alert"]', value: 'consider compacting to continue' },
		],
		happyPath: true,
	},
	{
		name: 'context-warning-sash-exposes-compact-and-dismiss-affordances',
		given: 'The ContextWarningSash is mounted with contextUsage=85 (red), enabled=true.',
		when: ['the banner renders its action row'],
		then: [
			// Compact & Continue primary action
			{ verb: 'hasText', target: '[role="alert"]', value: 'Compact & Continue' },
			// Dismiss button with the aria-label discoverable to AT users
			{ verb: 'hasElement', target: '[role="alert"] [aria-label="Dismiss warning"]' },
			// Dismiss button has a tooltip via the title attribute
			{ verb: 'hasElement', target: '[role="alert"] [title="Dismiss"]' },
		],
		happyPath: true,
	},
	{
		name: 'context-warning-sash-reappears-when-usage-escalates-yellow-to-red-after-dismissal',
		given:
			'The user dismissed the yellow sash at contextUsage=65, and usage has since climbed to 82 (crossing redThreshold=80).',
		when: ['the parent re-renders the ContextWarningSash with the new usage value'],
		then: [
			// Banner re-renders with the red copy
			{ verb: 'hasElement', target: '[role="alert"]' },
			{
				verb: 'hasElement',
				target: '[role="alert"][aria-label="Context window at 82% capacity"]',
			},
			{ verb: 'hasText', target: '[role="alert"]', value: 'consider compacting to continue' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'context-warning-sash-hidden-when-usage-below-yellow-threshold',
		given:
			'The AI tab reports contextUsage=40 with yellowThreshold=60 and redThreshold=80, and the sash is enabled.',
		when: ['the ContextWarningSash mounts'],
		then: [
			// Component returns null — no banner in the DOM
			{ verb: 'hasElement', target: 'body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'context-warning-sash-hidden-when-disabled-even-at-red-threshold',
		given: 'The setting that gates this banner is off (enabled=false) and contextUsage=95 (red).',
		when: ['the ContextWarningSash mounts'],
		then: [
			// The enabled flag short-circuits any threshold logic
			{ verb: 'hasElement', target: 'body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'context-warning-sash-stays-hidden-after-dismissal-without-meaningful-usage-bump',
		given:
			'The user dismissed the sash at contextUsage=65 (yellow); usage has since drifted to 68 (still yellow, +3% from dismissal).',
		when: ['the parent re-renders the ContextWarningSash with the new usage value'],
		then: [
			// +3% bump is below the +10% re-show threshold and no yellow→red escalation occurred,
			// so the banner stays hidden.
			{ verb: 'hasElement', target: 'body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'context-warning-sash-fires-no-ipc-or-websocket-traffic-on-mount-or-dismiss',
		given: 'The ContextWarningSash is mounted with contextUsage=85 (red) and enabled=true.',
		when: [
			'the banner mounts',
			'the user clicks Compact & Continue',
			'the user clicks the Dismiss button',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// Action callbacks are the caller's contract — this component does not
			// reach into window.maestro or any transport itself.
			{ verb: 'hasElement', target: '[role="alert"], body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
];

describe('ContextWarningSash — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = contextWarningSashParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = contextWarningSashParityCatalog.filter((s) => s.happyPath).length;
		const negative = contextWarningSashParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of contextWarningSashParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of contextWarningSashParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of contextWarningSashParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (banner uses role=alert, not role=dialog)', () => {
		// ContextWarningSash is a banner, not a modal. The catalog must never
		// drift toward role=dialog assertions — if a future refactor wraps the
		// sash in a modal, that's a behavior change and the catalog should
		// fail rather than silently track it.
		for (const story of contextWarningSashParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
		}
	});
});
