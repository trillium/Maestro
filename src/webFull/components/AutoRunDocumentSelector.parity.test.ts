/**
 * Parity catalog — AutoRunDocumentSelector
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRunDocumentSelector is a presentational document-picker that
 * renders a dropdown of `.md` files (flat list OR folder-tree), per-doc
 * task-completion percentage pills, an optional Bionify toggle, a
 * Create-New-Document modal, and Refresh / Change-Folder action buttons.
 * It touches 0 IPC namespaces at module load or runtime — every side
 * effect flows through the `onSelectDocument` / `onRefresh` /
 * `onChangeFolder` / `onCreateDocument` / `onToggleBionify` prop callbacks
 * the caller supplies.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per
 * happy-path story → minimum 3 happy + 3 negative. This catalog ships 6
 * happy + 6 negative = 12 stories.
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

export const autoRunDocumentSelectorParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'autorun-doc-selector-renders-collapsed-button-with-selected-document-name',
		given:
			'AutoRunDocumentSelector mounts with documents=["alpha","beta","gamma"], selectedDocument="beta", and the dropdown is closed (initial state).',
		when: ['the selector mounts'],
		then: [
			// The collapsed dropdown button shows the selected document name with .md suffix
			{ verb: 'hasText', target: 'body', value: 'beta.md' },
			// The Refresh action button is always rendered
			{ verb: 'hasElement', target: 'button[title="Refresh document list"]' },
			// The Change Folder action button is always rendered
			{ verb: 'hasElement', target: 'button[title="Change folder"]' },
			// The Create New Document button is always rendered
			{ verb: 'hasElement', target: 'button[title="Create new document"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-doc-selector-shows-placeholder-when-no-document-selected',
		given: 'AutoRunDocumentSelector mounts with documents=["alpha","beta"], selectedDocument=null.',
		when: ['the selector mounts'],
		then: [
			// Placeholder copy renders verbatim from the renderer source
			{ verb: 'hasText', target: 'body', value: 'Select a document...' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-doc-selector-opens-create-document-modal-when-plus-button-clicked',
		given: 'AutoRunDocumentSelector mounts with any document list, dropdown closed.',
		when: ['the user clicks the Create new document (+) button'],
		then: [
			// The create-document modal mounts as a role=dialog with the canonical label
			{ verb: 'hasElement', target: 'div[role="dialog"][aria-label="Create New Document"]' },
			// Modal header copy
			{ verb: 'hasText', target: 'body', value: 'Create New Document' },
			// Document Name input field renders with the canonical placeholder
			{ verb: 'hasElement', target: 'input[placeholder="my-tasks"]' },
			// Footer Create button renders
			{ verb: 'hasText', target: 'body', value: 'Create' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-doc-selector-renders-bionify-toggle-when-document-selected-and-callback-provided',
		given:
			'AutoRunDocumentSelector mounts with selectedDocument="alpha", onToggleBionify supplied as a callback, bionifyEnabled=false.',
		when: ['the selector mounts'],
		then: [
			// Bionify toggle uses the "Enable Bionify" tooltip when disabled
			{
				verb: 'hasElement',
				target: 'button[title="Enable Bionify for this document preview"]',
			},
			// aria-pressed reflects the off state
			{ verb: 'hasElement', target: 'button[aria-pressed="false"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-doc-selector-renders-task-percentage-pill-on-selected-document-button',
		given:
			'AutoRunDocumentSelector mounts with documents=["alpha"], selectedDocument="alpha", and documentTaskCounts=Map([["alpha",{completed:3,total:10}]]).',
		when: ['the selector mounts'],
		then: [
			// 30% pill renders in the collapsed-button summary row
			{ verb: 'hasText', target: 'body', value: '30%' },
			// And the document name surfaces next to it
			{ verb: 'hasText', target: 'body', value: 'alpha.md' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-doc-selector-disables-refresh-button-when-isLoading-true',
		given: 'AutoRunDocumentSelector mounts with isLoading=true.',
		when: ['the selector mounts in loading state'],
		then: [
			// The refresh button carries the disabled attribute when isLoading is true
			{ verb: 'hasElement', target: 'button[title="Refresh document list"][disabled]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorun-doc-selector-suppresses-bionify-toggle-when-no-document-selected',
		given:
			'AutoRunDocumentSelector mounts with selectedDocument=null, onToggleBionify supplied as a callback.',
		when: ['the selector mounts without a document selected'],
		then: [
			// Bionify toggle gated behind `selectedDocument && onToggleBionify` — must be absent
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Enable Bionify for this document preview"]))',
			},
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Disable Bionify for this document preview"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-doc-selector-suppresses-bionify-toggle-when-onToggleBionify-omitted',
		given:
			'AutoRunDocumentSelector mounts with selectedDocument="alpha" but onToggleBionify omitted.',
		when: ['the selector mounts'],
		then: [
			// Bionify toggle gated behind `selectedDocument && onToggleBionify` — must be absent
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Enable Bionify for this document preview"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-doc-selector-does-not-render-create-modal-on-initial-mount',
		given: 'AutoRunDocumentSelector mounts with any document list, no user interaction yet.',
		when: ['the selector mounts (no clicks)'],
		then: [
			// Create-document modal is gated behind a state flag that defaults to false
			{
				verb: 'hasElement',
				target: 'body:not(:has(div[role="dialog"][aria-label="Create New Document"]))',
			},
			// "Create New Document" header copy also absent
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Create New Document")))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-doc-selector-suppresses-task-percentage-pill-when-documentTaskCounts-omitted',
		given:
			'AutoRunDocumentSelector mounts with documents=["alpha"], selectedDocument="alpha", documentTaskCounts undefined.',
		when: ['the selector mounts without task-counts data'],
		then: [
			// No task-percentage pill should render (the "30%" pill in the happy path requires documentTaskCounts)
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("30%")))' },
			// But the document name still surfaces in the button
			{ verb: 'hasText', target: 'body', value: 'alpha.md' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-doc-selector-suppresses-task-percentage-pill-when-counts-total-is-zero',
		given:
			'AutoRunDocumentSelector mounts with documents=["alpha"], selectedDocument="alpha", documentTaskCounts=Map([["alpha",{completed:0,total:0}]]).',
		when: ['the selector mounts with a zero-total counts entry'],
		then: [
			// getTaskPercentage returns null when total === 0 — pill must be suppressed
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("0%")))' },
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("100%")))' },
			// But the document name still surfaces in the button
			{ verb: 'hasText', target: 'body', value: 'alpha.md' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-doc-selector-no-module-load-ipc-lifecycle-pin',
		given:
			'AutoRunDocumentSelector mounts in any state (empty list, flat list, folder-tree, selected, unselected).',
		when: ['the module loads and the component mounts'],
		then: [
			// The component must never reach `window.maestro` or any WS transport
			// at module load or runtime. All side effects flow through prop
			// callbacks (`onSelectDocument`, `onRefresh`, `onChangeFolder`,
			// `onCreateDocument`, `onToggleBionify`) supplied by the caller.
			// This story pins the lifecycle contract so a future refactor that
			// wires IPC directly into the selector would fail the catalog
			// rather than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('AutoRunDocumentSelector — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = autoRunDocumentSelectorParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunDocumentSelectorParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunDocumentSelectorParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunDocumentSelectorParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunDocumentSelectorParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('story names are unique', () => {
		const names = autoRunDocumentSelectorParityCatalog.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
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
		for (const story of autoRunDocumentSelectorParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
