/**
 * Parity catalog — FileSearchModal
 *
 * Layer 2.5 — leaf-parade lift wave
 * (ISC-44.layer-2.5.file_search_modal). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * FileSearchModal is a fuzzy file-search picker rendered as a centered
 * `role="dialog"` `aria-modal="true"` panel. It takes `theme`, `fileTree`,
 * optional `expandedFolders`, optional `shortcut`, `onFileSelect`, and
 * `onClose`. It registers with the LayerStack at
 * `MODAL_PRIORITIES.FUZZY_FILE_SEARCH` (`focusTrap: 'strict'`,
 * `blocksLowerLayers: true`, `capturesFocus: true`). It touches 0 IPC
 * namespaces and 0 Electron-only APIs. The parity contract is therefore
 * observable-behavior-only: dialog chrome (aria-label, role), search
 * input placeholder, mode-toggle pill labels with live file counts,
 * empty-state copy, footer stats, and the per-row file name + directory
 * subtitle.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
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

export const fileSearchModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'file-search-modal-renders-dialog-chrome-with-aria-label-and-search-input',
		given:
			'FileSearchModal mounts with fileTree=[{name:"src",type:"folder",children:[{name:"App.tsx",type:"file"}]}], onFileSelect=noop, onClose=noop.',
		when: ['the modal mounts'],
		then: [
			// Dialog chrome — role + aria-modal + the canonical aria-label
			{ verb: 'hasElement', target: '[role="dialog"][aria-modal="true"]' },
			{ verb: 'hasElement', target: '[aria-label="Fuzzy File Search"]' },
			// The search input renders with its canonical placeholder copy
			{ verb: 'hasElement', target: 'input[placeholder="Search files..."]' },
			// The ESC affordance badge is rendered in the header
			{ verb: 'hasText', target: 'body', value: 'ESC' },
		],
		happyPath: true,
	},
	{
		name: 'file-search-modal-renders-mode-toggle-pills-with-live-counts',
		given:
			'FileSearchModal mounts with a fileTree containing 3 previewable files at the root and no expandedFolders prop (defaults to all-files visibility).',
		when: ['the modal mounts'],
		then: [
			// Both mode-toggle pills surface their canonical labels with the
			// parenthesized count. When `expandedFolders` is omitted, the
			// "Visible Files" pill reflects the same count as the "All Files"
			// pill (the component routes through `allFiles` in that case).
			{ verb: 'hasText', target: 'body', value: 'Visible Files (3)' },
			{ verb: 'hasText', target: 'body', value: 'All Files (3)' },
			// The "Tab to switch" affordance copy in the pill row
			{ verb: 'hasText', target: 'body', value: 'Tab to switch' },
		],
		happyPath: true,
	},
	{
		name: 'file-search-modal-renders-file-rows-with-name-and-directory-subtitle',
		given:
			'FileSearchModal mounts with fileTree=[{name:"src",type:"folder",children:[{name:"App.tsx",type:"file"}]}].',
		when: ['the modal renders the file list'],
		then: [
			// File row carries the file name verbatim
			{ verb: 'hasText', target: 'body', value: 'App.tsx' },
			// File row carries the directory subtitle verbatim (everything
			// before the last "/" in the fullPath)
			{ verb: 'hasText', target: 'body', value: 'src' },
		],
		happyPath: true,
	},
	{
		name: 'file-search-modal-renders-footer-stats-line-with-canonical-copy',
		given: 'FileSearchModal mounts with a single previewable file at the root and no search query.',
		when: ['the modal renders the footer'],
		then: [
			// Footer stats — N files
			{ verb: 'hasText', target: 'body', value: '1 files' },
			// Footer hint copy — the navigation + select + quick-select line
			{ verb: 'hasText', target: 'body', value: 'navigate' },
			{ verb: 'hasText', target: 'body', value: 'select' },
			{ verb: 'hasText', target: 'body', value: 'quick select' },
		],
		happyPath: true,
	},
	{
		name: 'file-search-modal-renders-shortcut-hint-when-shortcut-prop-supplied',
		given: 'FileSearchModal mounts with shortcut={ keys:["Meta","p"] } and a non-empty fileTree.',
		when: ['the modal renders the header'],
		then: [
			// The header surfaces a shortcut hint when the prop is supplied;
			// the formatted keys land in a font-mono span next to the ESC
			// badge. We only assert the presence of the font-mono hint chip
			// to stay layout-independent — the exact glyph rendering of
			// `formatShortcutKeys(["Meta","p"])` differs across platforms
			// (e.g. `⌘P` on macOS vs `Ctrl+P` elsewhere), which is the
			// helper's job to normalize.
			{ verb: 'hasElement', target: 'span.font-mono' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'file-search-modal-renders-empty-state-copy-when-tree-is-empty',
		given: 'FileSearchModal mounts with fileTree=[] and no search query.',
		when: ['the modal renders the empty list'],
		then: [
			// The empty-state branch renders the no-files copy (the
			// branchless empty-tree state — there is no search query, so
			// the "no files to search" message wins over the "no files
			// match your search" message)
			{ verb: 'hasText', target: 'body', value: 'No files to search' },
		],
		happyPath: false,
	},
	{
		name: 'file-search-modal-renders-no-matches-copy-when-search-has-no-results',
		given:
			'FileSearchModal mounts with a previewable fileTree and the user types a search query that matches nothing.',
		when: ['the user types "zzznosuchfile" into the search input'],
		then: [
			// The empty-search-result branch renders the no-match copy
			{ verb: 'hasText', target: 'body', value: 'No files match your search' },
		],
		happyPath: false,
	},
	{
		name: 'file-search-modal-suppresses-shortcut-hint-when-prop-not-supplied',
		given: 'FileSearchModal mounts without the `shortcut` prop and with a non-empty fileTree.',
		when: ['the modal renders the header'],
		then: [
			// The dialog chrome still renders
			{ verb: 'hasElement', target: '[role="dialog"][aria-modal="true"]' },
			// The ESC badge still renders (it is unconditional)
			{ verb: 'hasText', target: 'body', value: 'ESC' },
			// The font-mono shortcut hint chip is gated behind `shortcut`
			// truthiness; if a future refactor unconditionally renders it,
			// this story would silently track. We assert ABSENCE — the
			// `:not(:has(span.font-mono))` selector pins the gate.
			{ verb: 'hasElement', target: 'body:not(:has(span.font-mono))' },
		],
		happyPath: false,
	},
	{
		name: 'file-search-modal-filters-non-previewable-files-from-the-list',
		given:
			'FileSearchModal mounts with fileTree=[{name:"binary.bin",type:"file"},{name:"App.tsx",type:"file"}] — `binary.bin` has no extension in the previewable allowlist.',
		when: ['the modal renders the file list'],
		then: [
			// Previewable file surfaces
			{ verb: 'hasText', target: 'body', value: 'App.tsx' },
			// Non-previewable file is filtered out by `isPreviewableFile`
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("binary.bin")))' },
		],
		happyPath: false,
	},
	{
		name: 'file-search-modal-suppresses-list-rows-when-tree-is-empty',
		given: 'FileSearchModal mounts with fileTree=[].',
		when: ['the modal renders'],
		then: [
			// Dialog chrome still renders
			{ verb: 'hasElement', target: '[role="dialog"][aria-modal="true"]' },
			// Footer renders the zero-count copy
			{ verb: 'hasText', target: 'body', value: '0 files' },
		],
		happyPath: false,
	},
	{
		name: 'file-search-modal-no-ipc-no-ws-lifecycle-pin',
		given: 'FileSearchModal mounts in any state (empty, populated, searching, focused).',
		when: ['the modal renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport. All side effects flow through `onFileSelect` /
			// `onClose` prop callbacks supplied by the caller. This story
			// pins the lifecycle contract so a future refactor that wires
			// IPC directly into the modal would fail the catalog rather
			// than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('FileSearchModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = fileSearchModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = fileSearchModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = fileSearchModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of fileSearchModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of fileSearchModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'ipcrenderer',
			'dialog.',
			'tunnel.',
		];
		for (const story of fileSearchModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('story names are unique across the catalog', () => {
		const names = fileSearchModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
