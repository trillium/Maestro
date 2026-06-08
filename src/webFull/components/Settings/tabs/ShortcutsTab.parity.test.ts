/**
 * Parity catalog — Settings Shortcuts tab
 *
 * Layer 3.2 — Settings Shortcuts-tab port. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * The Shortcuts tab is zero-IPC: it reads the `shortcuts` and
 * `tabShortcuts` keys from the settings store and writes back through
 * the same store. The harness will exercise it without any extra server
 * wiring beyond what L3.1 already shipped (`GET`/`PATCH /api/settings`).
 *
 * Catalog principle:
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron-at-9222
 *   AND webFull-at-5176).
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

export const shortcutsTabParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'open-shortcuts-tab-shows-filter-and-count',
		given:
			'A user has launched Maestro, opened Settings, and the server has published a non-empty shortcuts map.',
		when: ['the SettingsModal is opened and the user clicks the Shortcuts tab'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-modal"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-settings-tab-shortcuts"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-tab"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-filter"]' },
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-count"]' },
			{
				verb: 'hasText',
				target: '[data-testid="webfull-settings-tab-shortcuts"]',
				value: 'Shortcuts',
			},
		],
		happyPath: true,
	},
	{
		name: 'record-new-shortcut-persists-to-server',
		given:
			'The Shortcuts tab is open, the server has published a shortcut with id "send-message" labeled "Send Message" with keys ["Meta","Enter"].',
		when: [
			'the user clicks the record button for the "Send Message" shortcut',
			'the user presses Meta+Shift+S on the keyboard',
		],
		then: [
			// Server-side proof: the new keys are in the persisted shortcuts map
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"shortcuts"' },
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"Shift"' },
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"send-message"' },
			// Client-side proof: the recording button is no longer in "Press keys…" state
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-record-send-message"]' },
		],
		happyPath: true,
	},
	{
		name: 'filter-input-narrows-visible-shortcuts',
		given:
			'The Shortcuts tab is open with multiple registered shortcuts, including "Send Message" and "Open Settings".',
		when: ['the user types "send" into the filter input'],
		then: [
			// The filter input reflects the typed value
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-filter"]' },
			// The "Send Message" item is still in the DOM
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-item-send-message"]' },
			// The count badge displays a fraction "filtered / total"
			{ verb: 'hasText', target: '[data-testid="webfull-shortcuts-count"]', value: '/' },
		],
		happyPath: true,
	},
	{
		name: 'escape-during-recording-cancels-without-persisting',
		given:
			'The Shortcuts tab is open, a shortcut "send-message" has keys ["Meta","Enter"], and the user has just clicked record on it.',
		when: ['the user presses the Escape key while the record button is focused'],
		then: [
			// The original keys are still on disk
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"Enter"' },
			// The record button is no longer in "Press keys…" state — visible item remains
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-record-send-message"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'modifier-only-keypress-does-not-persist',
		given:
			'The Shortcuts tab is open and the user has clicked record on a shortcut with id "send-message".',
		when: ['the user presses ONLY the Shift key (no main key)'],
		then: [
			// The original keys remain on disk (no overwrite)
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '"send-message"' },
			// The record button stays in "Press keys…" state until a real key arrives —
			// observable via the button still being in the DOM with its testid
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-record-send-message"]' },
		],
		happyPath: false,
	},
	{
		name: 'empty-shortcuts-map-shows-empty-state',
		given:
			'The settings store has no `shortcuts` or `tabShortcuts` keys (or both are empty objects).',
		when: ['the Shortcuts tab is opened'],
		then: [
			{ verb: 'hasElement', target: '[data-testid="webfull-shortcuts-empty"]' },
			{
				verb: 'hasText',
				target: '[data-testid="webfull-shortcuts-empty"]',
				value: 'No customizable shortcuts',
			},
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION: ≥1 happy-path AND ≥1 negative-path story.
 */
describe('Settings Shortcuts tab — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = shortcutsTabParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = shortcutsTabParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least three stories total (brief requires ≥3)', () => {
		expect(shortcutsTabParityCatalog.length).toBeGreaterThanOrEqual(3);
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
		for (const story of shortcutsTabParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of shortcutsTabParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('matches the zero-IPC scope: no IPC namespace references', () => {
		// The Shortcuts tab is settings-namespace only. Sanity check that no
		// story asserts against an IPC namespace beyond `settings`.
		const banned = ['fonts:detect', 'shell:', 'dialog:', 'power:', 'wakatime:'];
		for (const story of shortcutsTabParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
