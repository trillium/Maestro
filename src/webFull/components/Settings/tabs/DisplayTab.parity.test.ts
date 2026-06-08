/**
 * Parity catalog — Settings Display tab
 *
 * Layer 3.2 — second feature port into src/webFull/Settings (after L3.1
 * General). Per WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x),
 * every feature port ships with a catalog of (Given, When, Then) stories
 * using the fixed assertion vocabulary:
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

export const displayTabParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'open-display-tab-shows-known-fields',
		given: 'A user has launched Maestro and the Display settings tab loads.',
		when: ['the SettingsModal is opened and the user clicks the Display tab'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-modal"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-tab-display"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-tab"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-font-size"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-terminal-width"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-bionify-algorithm"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-ignore-patterns"]' },
			{ verb: 'hasText', target: '[data-testid="webfull-settings-tab-display"]', value: 'Display' },
		],
		happyPath: true,
	},
	{
		name: 'change-font-size-to-large-persists-to-server',
		given: 'The Display tab is open and the fontSize field is editable.',
		when: ['the user clicks the "Large" font-size button (value=16)'],
		then: [
			// Server-side proof: the setting hits the FileStore JSON
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"fontSize": 16' },
			// Client-side proof: the Large button is now pressed
			{
				verb: 'hasElement',
				target: '[data-testid="webfull-display-font-size-16"][aria-pressed="true"]',
			},
		],
		happyPath: true,
	},
	{
		name: 'toggle-context-warnings-persists-nested-object',
		given:
			'The Display tab is open and contextManagementSettings.contextWarningsEnabled is false.',
		when: ['the user clicks the "Show context consumption warnings" switch'],
		then: [
			// The nested object is written as a whole, so the key is the parent object
			{
				verb: 'fsHas',
				target: 'maestro-settings.json',
				value: '"contextWarningsEnabled": true',
			},
			// Thresholds become live (not pointer-events-none)
			{ verb: 'hasElement', target: '[data-testid="webfull-display-ctx-yellow"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-ctx-red"]' },
		],
		happyPath: true,
	},
	{
		name: 'edit-ignore-patterns-textarea-persists-array',
		given: 'The Display tab is open and the localIgnorePatterns field has defaults.',
		when: [
			'the user replaces the textarea contents with ".git\\nnode_modules\\ndist"',
			'the user blurs the textarea (commits the draft)',
		],
		then: [
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"localIgnorePatterns"' },
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"dist"' },
			{ verb: 'hasElement', target: '[data-testid="webfull-display-ignore-patterns"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'invalid-bionify-algorithm-does-not-persist',
		given: 'The Display tab is open and bionifyAlgorithm has a valid default "- 0 1 1 2 0.4".',
		when: [
			'the user replaces the input with "garbage" (does not match the pattern)',
			'the user blurs the input',
		],
		then: [
			// The input visibly shows the warning border state — testable via the
			// warning text appearing for invalid input
			{ verb: 'hasElement', target: '[data-testid="webfull-display-bionify-algorithm"]' },
			// FileStore did NOT receive the invalid value
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"bionifyAlgorithm": "- 0 1 1 2 0.4"' },
		],
		happyPath: false,
	},
	{
		name: 'server-error-on-fetch-shows-error-banner',
		given:
			'The settings provider is unavailable or returns 500 (e.g. disk full on initial GET).',
		when: ['the Display tab attempts its initial GET /api/settings call'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="webfull-display-error"]' },
			// The tab body still renders rather than going blank
			{ verb: 'hasElement', target: '[data-testid="webfull-display-tab"]' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION: ≥1 happy-path AND ≥1 negative-path story.
 * This vitest pass acts as a compile-time guard for the catalog shape;
 * the actual record-and-replay harness lands later.
 */
describe('Settings Display tab — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = displayTabParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = displayTabParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least three stories total (brief requires ≥3)', () => {
		expect(displayTabParityCatalog.length).toBeGreaterThanOrEqual(3);
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
		for (const story of displayTabParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of displayTabParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('matches the rewrite-with-primitives scope: no Electron-only IPC references', () => {
		// The Display tab defers font enumeration (fonts:detect) and Window
		// Chrome side effects (BrowserWindow). Sanity check that no story
		// asserts against those deferred surfaces.
		const banned = ['fonts:detect', 'usenativetitlebar', 'autohidemenubar'];
		for (const story of displayTabParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
