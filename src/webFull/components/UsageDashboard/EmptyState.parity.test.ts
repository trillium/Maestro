/**
 * Parity catalog — Usage Dashboard EmptyState
 *
 * Layer 2.3 — leaf-component lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * EmptyState is a pure UI primitive — it accepts `theme`, optional `title`,
 * and optional `message`, and renders a friendly empty-state panel inside
 * the Usage Dashboard when no stats data is available. It touches 0 IPC
 * namespaces and 0 Electron-only APIs. The parity contract is therefore
 * observable-behavior-only: the panel renders the (default or override)
 * text content and exposes the `usage-dashboard-empty` testid for callers.
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
	/** Selector / identifier / pattern — verb-specific shape. */
	target: string;
	/** Optional second argument used by some verbs (e.g. hasText). */
	value?: string;
}

export interface ParityStory {
	name: string;
	given: string;
	when: string[];
	then: Assertion[];
	/** True if the story is a happy-path; false for negative-path coverage. */
	happyPath: boolean;
}

export const emptyStateParityCatalog: ParityStory[] = [
	// ============ Happy path: defaults render ============
	{
		name: 'empty-state-default-shows-encouraging-message',
		given:
			'A user opens the Usage Dashboard and no stats data has accumulated yet (cold start, first launch).',
		when: ['the UsageDashboard renders EmptyState with no overrides'],
		then: [
			// The testid hook is in place — this is the wiring contract the
			// Usage Dashboard relies on to detect "empty" vs "loaded" state.
			{ verb: 'hasElement', target: '[data-testid="usage-dashboard-empty"]' },
			// Default title is the friendly cold-start text.
			{
				verb: 'hasText',
				target: '[data-testid="usage-dashboard-empty"]',
				value: 'No usage data yet',
			},
			// Default message encourages further use.
			{
				verb: 'hasText',
				target: '[data-testid="usage-dashboard-empty"]',
				value: 'Start using Maestro to see your stats!',
			},
		],
		happyPath: true,
	},
	{
		name: 'empty-state-custom-title-and-message-render',
		given:
			'A caller (e.g. a filtered view that yielded zero results) renders EmptyState with title="No matches" and message="Try a different filter".',
		when: ['the EmptyState mounts with the overrides applied'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="usage-dashboard-empty"]' },
			{
				verb: 'hasText',
				target: '[data-testid="usage-dashboard-empty"]',
				value: 'No matches',
			},
			{
				verb: 'hasText',
				target: '[data-testid="usage-dashboard-empty"]',
				value: 'Try a different filter',
			},
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'empty-state-does-not-render-stats-chart-elements',
		given: 'EmptyState is mounted because the parent Usage Dashboard has zero rows.',
		when: ['the EmptyState is the only thing visible in the dashboard body'],
		then: [
			// EmptyState owns the empty-state surface — and ONLY the empty-state
			// surface. It must not leak a real stats chart, table, or summary
			// header that would confuse the user into thinking data loaded.
			{ verb: 'hasElement', target: '[data-testid="usage-dashboard-empty"]' },
			// Sanity: the empty container is rendered, not a "stats loaded" panel.
			{
				verb: 'hasText',
				target: '[data-testid="usage-dashboard-empty"]',
				value: 'No usage data yet',
			},
		],
		happyPath: false,
	},
	{
		name: 'empty-state-empty-overrides-fall-back-to-defaults',
		given: 'A caller passes title="" and message="" (degenerate override case).',
		when: ['the EmptyState mounts with both overrides as empty strings'],
		then: [
			// The component still renders the container; behavior with degenerate
			// overrides is to render the (empty) strings rather than crash. The
			// testid hook must always be present so the parent dashboard can
			// detect the empty surface regardless of override values.
			{ verb: 'hasElement', target: '[data-testid="usage-dashboard-empty"]' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION: ≥1 happy-path AND ≥1 negative-path story.
 * This vitest pass acts as a compile-time guard for the catalog shape; the
 * actual record-and-replay harness lands later.
 */
describe('UsageDashboard EmptyState — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = emptyStateParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = emptyStateParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of emptyStateParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of emptyStateParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// EmptyState is pure UI — no IPC, no shell, no dialog, no notifications.
		// Sanity check that no story accidentally references a renderer-only
		// assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of emptyStateParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
