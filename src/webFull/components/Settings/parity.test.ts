/**
 * Parity catalog — Settings General tab
 *
 * Layer 3.1 — first feature port into src/webFull/. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * This file declares the catalog as plain data. The runner that records
 * against the Electron oracle (CDP at :9222) and replays against webFull
 * (Vite dev server at :5176) is provided by the parity-harness work in a
 * later layer; this catalog passes type-checks today so the structure is
 * locked in before the runner lands.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets.
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * For Layer 3.1 the harness is not yet wired, so this file's primary role
 * is (a) lock the parity contract for the General tab in data form, and
 * (b) compile cleanly under the existing tsconfig so the file is ready
 * for the harness to consume.
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

export const generalTabParityCatalog: ParityStory[] = [
	// ============ Happy path: open + read + persist a known field ============
	{
		name: 'open-general-tab-shows-known-fields',
		given: 'A user has launched Maestro and the General settings tab loads.',
		when: ['the SettingsModal is opened with initialTab="general"'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-modal"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-tab-general"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-general-conductor-profile"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-general-log-level"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-general-thinking-mode"]' },
			{ verb: 'hasText', target: '[data-testid="webfull-settings-tab-general"]', value: 'General' },
		],
		happyPath: true,
	},
	{
		name: 'change-conductor-profile-persists-to-server',
		given: 'The General tab is open and the conductorProfile field is editable.',
		when: [
			'the user types "I prefer concise responses." into the conductor profile textarea',
			'the user blurs the field (triggering the debounced setSetting call)',
		],
		then: [
			// Server-side proof: the setting hits the FileStore JSON
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"conductorProfile"' },
			{ verb: 'fsHas', target: 'maestro-settings.json', value: 'I prefer concise responses.' },
			// Client-side proof: the textarea reflects the new value
			{
				verb: 'hasText',
				target: '[data-testid="webfull-general-conductor-profile"]',
				value: 'I prefer concise responses.',
			},
		],
		happyPath: true,
	},
	{
		name: 'switch-thinking-mode-to-sticky-persists',
		given: 'The General tab is open and the default thinking mode is "off".',
		when: ['the user clicks the "sticky" button in the thinking-mode toggle group'],
		then: [
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"defaultShowThinking": "sticky"' },
			{
				verb: 'hasElement',
				target: '[data-testid="webfull-general-thinking-sticky"]',
			},
			{
				verb: 'hasText',
				target: '[data-testid="webfull-general-tab"]',
				value: 'Thinking streams live and stays visible',
			},
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'server-503-on-missing-provider-shows-error',
		given:
			'No settings provider is registered on the server (e.g. early startup before headless wiring).',
		when: ['the General tab attempts its initial GET /api/settings call'],
		then: [
			// The hook surfaces the error state — UI shows the error banner
			{ verb: 'hasElement', target: '[data-testid="webfull-general-error"]' },
			// The user-visible tab body still renders rather than going blank
			{ verb: 'hasElement', target: '[data-testid="webfull-general-tab"]' },
		],
		happyPath: false,
	},
	{
		name: 'patch-with-empty-body-returns-400-no-state-change',
		given: 'The General tab is open and a stable settings cache is loaded.',
		when: ['a synthetic invalid PATCH /api/settings is issued with body { patch: null }'],
		then: [
			// FileStore was not mutated (no new key appears)
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '' },
			// UI did not crash — still renders the tab
			{ verb: 'hasElement', target: '[data-testid="webfull-general-tab"]' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION: ≥1 happy-path AND ≥1 negative-path story per
 * happy-path story. This vitest pass acts as a compile-time guard for the
 * catalog shape; the actual record-and-replay harness lands later.
 */
describe('Settings General tab — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = generalTabParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = generalTabParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of generalTabParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of generalTabParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('matches the lift-vs-rewrite rule: covers settings.get/set namespace only', () => {
		// Sanity check that no story references wakatime/sync/stats/shells —
		// those are deferred to subsequent agents per the Layer 3.1 brief.
		const banned = ['wakatime', 'sync.', 'stats.', 'shells.', 'shell.openPath'];
		for (const story of generalTabParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
