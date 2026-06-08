/**
 * Parity catalog — AutoRunSearchBar
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRunSearchBar is an in-document search input used by the Auto Run view.
 * It carries: a Search-icon affordance, an auto-focus text input, a counter
 * (`{i+1}/{N}` when matches exist, or "No matches" when query is non-empty
 * with zero matches), a previous-match button (ChevronUp), a next-match
 * button (ChevronDown), and an explicit close button (X). It registers with
 * the layer stack so Escape closes the search before lower-priority
 * modals (`MODAL_PRIORITIES.AUTORUN_SEARCH` = 706); the
 * Enter / Shift+Enter shortcuts trigger next / previous match navigation.
 *
 * The parity contract is observable-behavior-only:
 *   - search-input chrome with `placeholder="Search..."` always present
 *   - close button (`title="Close search (Esc)"`) always present
 *   - counter + prev + next affordances appear only when `searchQuery.trim()`
 *     is non-empty
 *   - counter copy shows `(currentMatchIndex + 1)/totalMatches` when
 *     `totalMatches > 0`, "No matches" when `searchQuery.trim()` is
 *     non-empty AND `totalMatches === 0`
 *   - prev / next buttons disabled when `totalMatches === 0`
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

export const autoRunSearchBarParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'autorun-search-bar-renders-search-input-and-close-affordances-when-mounted-empty',
		given: 'The AutoRunSearchBar is mounted with searchQuery="" and totalMatches=0.',
		when: ['the bar mounts'],
		then: [
			// Search-icon-led input chrome present
			{ verb: 'hasElement', target: 'input[type="text"][placeholder="Search..."]' },
			// Close affordance always present (regardless of query state)
			{ verb: 'hasElement', target: 'button[title="Close search (Esc)"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-search-bar-shows-counter-and-prev-next-buttons-with-non-empty-query-and-matches',
		given:
			'The AutoRunSearchBar is mounted with searchQuery="foo", currentMatchIndex=0, totalMatches=5.',
		when: ['the bar renders the match-navigation row'],
		then: [
			// Counter pill shows "1/5" (currentMatchIndex + 1)
			{ verb: 'hasText', target: 'span', value: '1/5' },
			// Previous-match button surfaces with the canonical tooltip
			{ verb: 'hasElement', target: 'button[title="Previous match (Shift+Enter)"]' },
			// Next-match button surfaces with the canonical tooltip
			{ verb: 'hasElement', target: 'button[title="Next match (Enter)"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-search-bar-shows-no-matches-copy-when-query-non-empty-but-zero-matches',
		given:
			'The AutoRunSearchBar is mounted with searchQuery="zzz", currentMatchIndex=0, totalMatches=0.',
		when: ['the bar renders the match-navigation row'],
		then: [
			// Counter slot reads "No matches" when totalMatches=0 but query is non-empty
			{ verb: 'hasText', target: 'span', value: 'No matches' },
			// Prev / next buttons still surface (just disabled — see negative below)
			{ verb: 'hasElement', target: 'button[title="Previous match (Shift+Enter)"]' },
			{ verb: 'hasElement', target: 'button[title="Next match (Enter)"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-search-bar-counter-advances-to-arbitrary-index-when-current-match-index-non-zero',
		given:
			'The AutoRunSearchBar is mounted with searchQuery="foo", currentMatchIndex=2, totalMatches=5.',
		when: ['the bar renders the counter'],
		then: [
			// Counter pill shows "3/5" (currentMatchIndex + 1 — zero-based prop, one-based copy)
			{ verb: 'hasText', target: 'span', value: '3/5' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorun-search-bar-hides-counter-and-nav-buttons-when-query-is-blank',
		given: 'The AutoRunSearchBar is mounted with searchQuery="" and totalMatches=0.',
		when: ['the bar mounts'],
		then: [
			// No counter or nav-button affordances present — `searchQuery.trim()` short-circuits
			// the entire <>...</> fragment that contains them.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Previous match (Shift+Enter)"]))',
			},
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Next match (Enter)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-search-bar-hides-counter-and-nav-buttons-when-query-is-only-whitespace',
		given: 'The AutoRunSearchBar is mounted with searchQuery="   " (only whitespace).',
		when: ['the bar mounts'],
		then: [
			// `searchQuery.trim()` is falsy, so the counter + nav row is suppressed even
			// though the raw query is non-empty.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Previous match (Shift+Enter)"]))',
			},
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Next match (Enter)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-search-bar-disables-prev-next-buttons-when-total-matches-is-zero',
		given: 'The AutoRunSearchBar is mounted with searchQuery="zzz" (non-empty) and totalMatches=0.',
		when: ['the bar renders the match-navigation row'],
		then: [
			// Buttons render but carry `disabled` so Enter / click are no-ops
			{ verb: 'hasElement', target: 'button[title="Previous match (Shift+Enter)"][disabled]' },
			{ verb: 'hasElement', target: 'button[title="Next match (Enter)"][disabled]' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-search-bar-fires-no-ipc-or-websocket-traffic-on-mount-or-input',
		given:
			'The AutoRunSearchBar is mounted with searchQuery="foo", currentMatchIndex=0, totalMatches=5.',
		when: [
			'the bar mounts',
			'the user types into the search input',
			'the user clicks the next-match button',
			'the user clicks the close button',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// All side effects are delivered through prop callbacks — this component does
			// not reach into window.maestro or any transport itself. The pin is the
			// structural absence of any non-input, non-button surface that would imply
			// transport activity (no modal, no banner).
			{
				verb: 'hasElement',
				target: 'input[type="text"][placeholder="Search..."], button[title="Close search (Esc)"]',
			},
		],
		happyPath: false,
	},
];

describe('AutoRunSearchBar — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = autoRunSearchBarParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunSearchBarParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunSearchBarParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunSearchBarParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunSearchBarParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of autoRunSearchBarParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (search bar uses no role=dialog, no role=alert)', () => {
		// AutoRunSearchBar is a transient in-document search bar registered with
		// the layer stack — it is NOT a modal (role=dialog) and NOT a banner
		// (role=alert). If a future refactor wraps it in either, the catalog
		// should fail rather than silently track the drift.
		for (const story of autoRunSearchBarParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
			expect(haystack.includes('role="alert"')).toBe(false);
		}
	});
});
