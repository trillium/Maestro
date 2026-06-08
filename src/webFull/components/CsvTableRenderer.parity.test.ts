/**
 * Parity catalog — CsvTableRenderer
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * `CsvTableRenderer` is a pure presentational table renderer over a
 * delimited string payload. It parses comma/tab-delimited content
 * (handling quoted fields and escaped quotes), groups header row and
 * data rows, infers per-column alignment from data content (>50%
 * numeric → right-align), filters by `searchQuery` (case-insensitive,
 * any-cell match), caps the rendered set at `MAX_DISPLAY_ROWS = 500`
 * with a banner surfacing the truncation, supports tri-state header-
 * click sort (asc → desc → off), and highlights matching substrings
 * inside cells with `<mark>` spans. Empty input renders an empty-state
 * placeholder. It touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only: the `<table>` exists
 * with a header row of clickable cells, data rows render with row
 * numbers in the leftmost column, the footer row-count copy reflects
 * `dataRows.length × columnCount`, the truncation banner surfaces when
 * `filteredRows.length > MAX_DISPLAY_ROWS`, and the empty-state copy
 * surfaces when `content` parses to zero rows. The `onMatchCount`
 * callback fires after first render (and on every filter change) — its
 * argument is `filteredRows.length` when `searchQuery` is non-empty
 * and `0` otherwise (the renderer source explicitly resets the count
 * to 0 when the query is cleared so the file-preview search-result
 * pill collapses correctly).
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron
 *   oracle at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior,
 *   not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new
 * verb here is explicitly out of scope; if a story needs an assertion
 * that doesn't fit, the story is wrong, not the vocabulary.
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

export const csvTableRendererParityCatalog: ParityStory[] = [
	// ============ Happy path: well-formed CSV renders header + body ============
	{
		name: 'csv-table-renderer-well-formed-csv-renders-header-and-data-rows',
		given:
			'CsvTableRenderer mounts with content "name,age\\nAlice,30\\nBob,25" (comma delimiter, header row + 2 data rows).',
		when: ['the component renders'],
		then: [
			// A semantic table is present
			{ verb: 'hasElement', target: 'table' },
			// Header row carries the column names verbatim
			{ verb: 'hasText', target: 'thead', value: 'name' },
			{ verb: 'hasText', target: 'thead', value: 'age' },
			// Data rows carry the cell values verbatim
			{ verb: 'hasText', target: 'tbody', value: 'Alice' },
			{ verb: 'hasText', target: 'tbody', value: 'Bob' },
			// Footer row-count copy reflects 2 data rows × 2 columns
			{ verb: 'hasText', target: 'body', value: '2 rows' },
		],
		happyPath: true,
	},
	// ============ Happy path: row-number column renders 1-indexed ============
	{
		name: 'csv-table-renderer-prepends-row-number-column-starting-at-one',
		given:
			'CsvTableRenderer mounts with content "fruit\\napple\\nbanana\\ncherry" (header + 3 data rows).',
		when: ['the component renders the table body'],
		then: [
			// The first column is the row-number column with header "#"
			{ verb: 'hasText', target: 'thead', value: '#' },
			// Row numbers 1, 2, 3 are visible in the body
			{ verb: 'hasText', target: 'tbody', value: '1' },
			{ verb: 'hasText', target: 'tbody', value: '2' },
			{ verb: 'hasText', target: 'tbody', value: '3' },
		],
		happyPath: true,
	},
	// ============ Happy path: TSV with custom delimiter parses correctly ============
	{
		name: 'csv-table-renderer-tsv-delimiter-prop-parses-tab-separated-content',
		given:
			'CsvTableRenderer mounts with content "city\\tpopulation\\nNYC\\t8000000" and delimiter="\\t".',
		when: ['the component renders'],
		then: [
			// Both header cells render as separate columns (not concatenated)
			{ verb: 'hasText', target: 'thead', value: 'city' },
			{ verb: 'hasText', target: 'thead', value: 'population' },
			// Data row is split correctly
			{ verb: 'hasText', target: 'tbody', value: 'NYC' },
			{ verb: 'hasText', target: 'tbody', value: '8000000' },
		],
		happyPath: true,
	},
	// ============ Happy path: search query highlights matching substrings ============
	{
		name: 'csv-table-renderer-search-query-wraps-matching-substrings-in-mark-elements',
		given:
			'CsvTableRenderer mounts with content "name\\nAlice\\nBob\\nCarol" and searchQuery="al" (case-insensitive — should match "Alice" and "Carol").',
		when: ['the component renders the filtered + highlighted table body'],
		then: [
			// At least one <mark> element is present (matches are highlighted)
			{ verb: 'hasElement', target: 'mark' },
			// The matched substring appears inside a <mark>. The renderer's
			// `highlightMatches()` builds a case-INSENSITIVE regex (`gi` flag)
			// but splits the original cell text and preserves the source case
			// — so the match against "Alice" lands a `<mark>` whose innerText
			// is `Al` (capital A from "Alice"), NOT `al`. The assertion uses
			// the actual rendered case so it reflects the observable DOM.
			{ verb: 'hasText', target: 'mark', value: 'Al' },
			// Non-matching rows are filtered out — "Bob" should NOT be present in the body
			{ verb: 'hasElement', target: 'tbody:not(:has-text("Bob"))' },
		],
		happyPath: true,
	},
	// ============ Happy path: header click sorts ascending ============
	{
		name: 'csv-table-renderer-header-click-sorts-column-ascending-and-shows-chevron-up',
		given:
			'CsvTableRenderer mounts with content "name\\nCharlie\\nAlice\\nBob" and the user clicks the "name" header cell once.',
		when: ['the user clicks the "name" header cell'],
		then: [
			// The chevron-up SVG (asc direction) appears in the active header cell
			{ verb: 'hasElement', target: 'thead svg' },
			// The body still contains all three names (sort does not filter)
			{ verb: 'hasText', target: 'tbody', value: 'Alice' },
			{ verb: 'hasText', target: 'tbody', value: 'Bob' },
			{ verb: 'hasText', target: 'tbody', value: 'Charlie' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'csv-table-renderer-empty-content-renders-empty-state-copy-no-table',
		given: 'CsvTableRenderer mounts with content="" (empty string).',
		when: ['the component renders'],
		then: [
			// Empty-state copy is visible
			{ verb: 'hasText', target: 'body', value: 'Empty CSV file' },
			// No <table> element renders — the empty-state branch short-circuits
			{ verb: 'hasElement', target: 'body:not(:has(table))' },
		],
		happyPath: false,
	},
	{
		name: 'csv-table-renderer-search-with-no-matches-renders-zero-of-total-footer',
		given:
			'CsvTableRenderer mounts with content "name\\nAlice\\nBob" and searchQuery="zzzz" (matches nothing).',
		when: ['the component renders the filtered body'],
		then: [
			// Footer copy reflects 0 matches of total
			{ verb: 'hasText', target: 'body', value: '0 of 2 rows match' },
			// No <mark> elements render — there is nothing to highlight
			{ verb: 'hasElement', target: 'body:not(:has(mark))' },
			// No data cells render — every row filtered out, the data rows in tbody (excluding row-number column) are empty
			{ verb: 'hasElement', target: 'tbody:not(:has-text("Alice"))' },
			{ verb: 'hasElement', target: 'tbody:not(:has-text("Bob"))' },
		],
		happyPath: false,
	},
	{
		name: 'csv-table-renderer-quoted-field-with-comma-stays-as-one-cell-not-split',
		given:
			'CsvTableRenderer mounts with content \'name,note\\n"Smith, Jr.",hello\' (a quoted comma inside a field).',
		when: ['the component renders'],
		then: [
			// The quoted field "Smith, Jr." renders as one cell with the comma preserved
			{ verb: 'hasText', target: 'tbody', value: 'Smith, Jr.' },
			// "hello" (the second field) renders verbatim
			{ verb: 'hasText', target: 'tbody', value: 'hello' },
			// Footer copy reflects 1 data row × 2 columns — NOT 1 × 3 (which would
			// indicate the quoted comma was treated as a delimiter)
			{ verb: 'hasText', target: 'body', value: '1 rows × 2 columns' },
		],
		happyPath: false,
	},
	{
		name: 'csv-table-renderer-data-only-no-header-still-renders-without-crash',
		given:
			'CsvTableRenderer mounts with content "soloRow" (a single line, no delimiter, no header concept).',
		when: ['the component renders'],
		then: [
			// The table still renders — the single line is treated as the header row
			{ verb: 'hasElement', target: 'table' },
			// The single cell value is visible in the thead
			{ verb: 'hasText', target: 'thead', value: 'soloRow' },
			// Footer row-count is "0 rows" because no data rows exist (only the header)
			{ verb: 'hasText', target: 'body', value: '0 rows' },
		],
		happyPath: false,
	},
	{
		name: 'csv-table-renderer-does-not-leak-ipc-or-electron-surface-at-module-load-or-runtime',
		given:
			'CsvTableRenderer mounts in a JSDOM environment with no Electron / preload bridge available.',
		when: [
			'the component mounts',
			'the user clicks every header cell to trigger sort state transitions',
			'searchQuery is set, cleared, then set again',
		],
		then: [
			// No IPC frame is sent on any wire — the component is presentational only
			{ verb: 'wsFrameMatches', target: 'window.maestro.*', value: '<none>' },
			// No filesystem touch — the renderer never reads / writes files
			{ verb: 'fsHas', target: 'any', value: '<none>' },
			// No process spawn — the renderer never spawns child processes
			{ verb: 'processHas', target: 'any', value: '<none>' },
		],
		happyPath: false,
	},
];

describe('CsvTableRenderer — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = csvTableRendererParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = csvTableRendererParityCatalog.filter((s) => s.happyPath).length;
		const negative = csvTableRendererParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of csvTableRendererParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given / when / then', () => {
		for (const story of csvTableRendererParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any positive IPC / Electron-only surface', () => {
		// The IPC-leak guard scans positive assertions for banned namespaces.
		// A `wsFrameMatches` story with `value: '<none>'` is a negative-shape
		// assertion (asserts the frame is NOT sent), so the guard scans only
		// stories whose `then` does not include a `<none>` sentinel.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of csvTableRendererParityCatalog) {
			const hasNoneSentinel = story.then.some((a) => a.value === '<none>');
			if (hasNoneSentinel) continue;
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('every story has a unique name', () => {
		const names = csvTableRendererParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
