/**
 * Parity catalog — ShortcutsHelpModal
 *
 * Layer 2.5 — leaf-parade lift wave (audit item #5). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ShortcutsHelpModal is a pure presentational primitive (216 LOC, 0 IPC,
 * 0 Electron-only APIs per the audit). It takes:
 *   - `shortcuts`           : Record<string, Shortcut>  (caller-supplied)
 *   - `tabShortcuts`        : Record<string, Shortcut>  (caller-supplied)
 *   - `onClose`             : () => void                (modal lifecycle)
 *   - `hasNoAgents?`        : boolean                   (banner trigger)
 *   - `keyboardMasteryStats?`: KeyboardMasteryStats     (mastery surface)
 *
 * and merges `FIXED_SHORTCUTS` (renderer constant) into the rendered list.
 * The parity contract is therefore observable-behavior-only: the modal
 * renders the header / search / list / footer chrome, surfaces the
 * "no agents" banner when flagged, filters via fuzzy match against label
 * and keys, shows the mastery progress bar and level name when stats are
 * provided, and closes via the close button / Escape (layer-stack handled
 * by the underlying Modal primitive).
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

export const shortcutsHelpModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'shortcuts-help-modal-renders-with-header-chrome',
		given:
			'The user invokes the Keyboard Shortcuts help modal with non-empty `shortcuts` and `tabShortcuts` maps.',
		when: ['the ShortcutsHelpModal mounts'],
		then: [
			// Modal chrome is present with the title from the underlying Modal primitive
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Keyboard Shortcuts"]' },
			// Custom header shows the "Keyboard Shortcuts" h2 label
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Keyboard Shortcuts' },
			// Search input is rendered with the documented placeholder
			{ verb: 'hasElement', target: '[role="dialog"] input[placeholder="Search shortcuts..."]' },
			// Footer hint about Settings customization is visible
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Many shortcuts can be customized from Settings',
			},
		],
		happyPath: true,
	},
	{
		name: 'shortcuts-help-modal-lists-supplied-shortcuts-with-formatted-keys',
		given:
			'The modal is open with `shortcuts={{ help: { id: "help", label: "Show Shortcuts", keys: ["Meta", "/"] } }}`.',
		when: ['the modal renders its list body'],
		then: [
			// The supplied shortcut label is rendered in the list
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Show Shortcuts' },
			// A <kbd> element is rendered for the formatted key combination
			{ verb: 'hasElement', target: '[role="dialog"] kbd' },
			// The formatted key string includes the "/" character (platform-agnostic — both ⌘/Ctrl maps preserve "/")
			{ verb: 'hasText', target: '[role="dialog"] kbd', value: '/' },
		],
		happyPath: true,
	},
	{
		name: 'shortcuts-help-modal-shows-no-agents-banner-when-flagged',
		given: 'The modal is open with `hasNoAgents={true}`.',
		when: ['the modal renders its custom header'],
		then: [
			// The informational banner is shown
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: "Most functionality is unavailable until you've created your first agent.",
			},
		],
		happyPath: true,
	},
	{
		name: 'shortcuts-help-modal-shows-mastery-progress-when-stats-supplied',
		given:
			'The modal is open with `keyboardMasteryStats={ usedShortcuts: ["help"], currentLevel: 0, lastLevelUpTimestamp: 0, lastAcknowledgedLevel: 0 }`.',
		when: ['the modal renders its footer'],
		then: [
			// The "mastered" progress text is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'mastered' },
			// A "%" sign appears in the mastery counter
			{ verb: 'hasText', target: '[role="dialog"]', value: '%' },
		],
		happyPath: true,
	},
	{
		name: 'shortcuts-help-modal-search-filters-the-list',
		given:
			'The modal is open with `shortcuts={{ help: { id: "help", label: "Show Shortcuts", keys: ["Meta", "/"] }, settings: { id: "settings", label: "Open Settings", keys: ["Meta", ","] } }}`.',
		when: ['the user types "Show" into the search input'],
		then: [
			// Matching entry stays visible
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Show Shortcuts' },
			// The count badge updates to "filteredCount / totalShortcuts" form (contains "/")
			{ verb: 'hasText', target: '[role="dialog"]', value: '/' },
		],
		happyPath: true,
	},
	{
		name: 'shortcuts-help-modal-close-button-fires-onClose',
		given: 'The modal is open with `onClose` wired to dismiss the layer.',
		when: ['the user clicks the X close button in the custom header'],
		then: [
			// Modal closes — no dialog remains in the DOM
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'shortcuts-help-modal-empty-search-shows-no-results-message',
		given: 'The modal is open with non-empty `shortcuts`.',
		when: ['the user types a query that matches nothing (e.g., "zzznomatch")'],
		then: [
			// The empty-state message is rendered
			{ verb: 'hasText', target: '[role="dialog"]', value: 'No shortcuts found' },
		],
		happyPath: false,
	},
	{
		name: 'shortcuts-help-modal-omits-mastery-footer-without-stats',
		given: 'The modal is open with `keyboardMasteryStats` undefined.',
		when: ['the modal renders'],
		then: [
			// No "mastered" progress text appears anywhere in the dialog
			{ verb: 'hasElement', target: '[role="dialog"]:not(:has-text("mastered"))' },
		],
		happyPath: false,
	},
	{
		name: 'shortcuts-help-modal-omits-no-agents-banner-when-flag-absent',
		given: 'The modal is open with `hasNoAgents` undefined or false.',
		when: ['the modal renders its custom header'],
		then: [
			// The "no agents" banner copy is absent
			{
				verb: 'hasElement',
				target:
					'[role="dialog"]:not(:has-text("Most functionality is unavailable until you\'ve created your first agent."))',
			},
		],
		happyPath: false,
	},
	{
		name: 'shortcuts-help-modal-escape-key-closes-modal',
		given: 'The modal is the topmost layer with focus inside the search input.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes — no dialog remains in the DOM (layer stack handles Escape via the Modal primitive)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'shortcuts-help-modal-hides-100pct-trophy-when-not-fully-mastered',
		given:
			'The modal is open with `keyboardMasteryStats={ usedShortcuts: [], currentLevel: 0, lastLevelUpTimestamp: 0, lastAcknowledgedLevel: 0 }`.',
		when: ['the modal renders its footer'],
		then: [
			// The 100% completion celebration text does NOT appear when masteryPercentage < 100
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has-text("Keyboard Maestro - Complete Mastery!"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'shortcuts-help-modal-empty-shortcut-maps-still-render-fixed-shortcuts',
		given: 'The modal is open with `shortcuts={}` and `tabShortcuts={}` (FIXED_SHORTCUTS only).',
		when: ['the modal renders its list body'],
		then: [
			// At least one <kbd> element renders for FIXED_SHORTCUTS contents (the modal must not show "No shortcuts found")
			{ verb: 'hasElement', target: '[role="dialog"] kbd' },
		],
		happyPath: false,
	},
];

describe('ShortcutsHelpModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = shortcutsHelpModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = shortcutsHelpModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = shortcutsHelpModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of shortcutsHelpModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of shortcutsHelpModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of shortcutsHelpModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
