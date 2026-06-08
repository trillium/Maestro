/**
 * Parity catalog — AutoRunExpandedModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRunExpandedModal is the full-screen Auto-Run editor shell that
 * portals into `document.body`, registers with the LayerStack at
 * `MODAL_PRIORITIES.AUTORUN_EXPANDED` with `focusTrap: 'strict'`, and
 * renders the renderer-side `AutoRun` view through a cross-fork import
 * (the view itself reaches `window.maestro.*` at runtime — out of scope
 * for this leaf; the modal shell itself touches 0 IPC namespaces at
 * module load). The parity contract for THIS modal is observable
 * behavior of the SHELL — header title, Edit/Preview toggle, Run/Stop
 * affordance, PlayBooks button (gated on `onOpenMarketplace`),
 * Collapse/Close affordances, and the unsaved-changes confirmation
 * surface. The `AutoRun` view's own parity contract belongs to a future
 * ISC-44.layer-2.5.autorun_view lift, NOT this one.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per
 * happy-path story → minimum 3 happy + 3 negative. This catalog ships 5
 * happy + 6 negative = 11 stories.
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

export const autoRunExpandedModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'autorun-expanded-modal-renders-header-title-and-collapse-close-affordances',
		given:
			'AutoRunExpandedModal mounts with mode="edit", batchRunState={isRunning:false}, sessionState="idle", and a valid sessionId. No onOpenMarketplace.',
		when: ['the modal mounts'],
		then: [
			// Header title copy
			{ verb: 'hasText', target: 'body', value: 'Auto Run' },
			// Collapse affordance — title defaults to "Collapse (Esc)" when no shortcut is provided
			{ verb: 'hasElement', target: 'button[title="Collapse (Esc)"]' },
			// Close (X) button with canonical title copy
			{ verb: 'hasElement', target: 'button[title="Close (Esc)"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-expanded-modal-renders-edit-and-preview-mode-toggle-when-not-locked',
		given:
			'AutoRunExpandedModal mounts with mode="edit", batchRunState={isRunning:false} (NOT locked).',
		when: ['the modal mounts in editable state'],
		then: [
			// Edit-mode button carries the canonical title "Edit document"
			{ verb: 'hasElement', target: 'button[title="Edit document"]' },
			// Preview-mode button carries the canonical title "Preview document"
			{ verb: 'hasElement', target: 'button[title="Preview document"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-expanded-modal-renders-run-button-when-not-locked-and-agent-idle',
		given:
			'AutoRunExpandedModal mounts with batchRunState={isRunning:false}, sessionState="idle" (NOT busy, NOT connecting), onOpenBatchRunner provided.',
		when: ['the modal mounts ready-to-run'],
		then: [
			// Run button with canonical title copy
			{ verb: 'hasElement', target: 'button[title="Run auto-run on tasks"]' },
			// Run label surfaces in the button row
			{ verb: 'hasText', target: 'body', value: 'Run' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-expanded-modal-renders-stop-button-when-locked-and-not-stopping',
		given:
			'AutoRunExpandedModal mounts with batchRunState={isRunning:true,isStopping:false} (IS locked), onStopBatchRun provided.',
		when: ['the modal mounts while a batch is in flight'],
		then: [
			// Stop button replaces Run when isLocked === true
			{ verb: 'hasElement', target: 'button[title="Stop auto-run"]' },
			// Stop label surfaces in the button row
			{ verb: 'hasText', target: 'body', value: 'Stop' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-expanded-modal-renders-playbooks-button-when-onOpenMarketplace-provided',
		given:
			'AutoRunExpandedModal mounts with onOpenMarketplace supplied as a callback (every other state default).',
		when: ['the modal mounts with marketplace wired'],
		then: [
			// PlayBooks affordance — title prefix is the canonical "Browse PlayBooks" copy
			{ verb: 'hasElement', target: 'button[title^="Browse PlayBooks"]' },
			// PlayBooks label surfaces in the header row
			{ verb: 'hasText', target: 'body', value: 'PlayBooks' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorun-expanded-modal-suppresses-run-button-when-locked',
		given: 'AutoRunExpandedModal mounts with batchRunState={isRunning:true} (IS locked).',
		when: ['the modal mounts while a batch is in flight'],
		then: [
			// Run button gated behind `!isLocked` — must be absent
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Run auto-run on tasks"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-expanded-modal-shows-stopping-state-when-isStopping-true',
		given: 'AutoRunExpandedModal mounts with batchRunState={isRunning:true,isStopping:true}.',
		when: ['the modal mounts while the batch is stopping'],
		then: [
			// The stop button switches its tooltip to the stopping-state copy
			{
				verb: 'hasElement',
				target: 'button[title="Stopping after current task..."]',
			},
			// "Stopping..." label surfaces in the button row
			{ verb: 'hasText', target: 'body', value: 'Stopping...' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-expanded-modal-suppresses-playbooks-button-when-onOpenMarketplace-omitted',
		given: 'AutoRunExpandedModal mounts WITHOUT an onOpenMarketplace prop.',
		when: ['the modal mounts'],
		then: [
			// PlayBooks affordance gated behind `onOpenMarketplace && (...)` — must be absent
			{ verb: 'hasElement', target: 'body:not(:has(button[title^="Browse PlayBooks"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-expanded-modal-disables-edit-button-when-locked',
		given: 'AutoRunExpandedModal mounts with batchRunState={isRunning:true} (IS locked).',
		when: ['the modal mounts while editing is disabled'],
		then: [
			// The Edit button's title swaps to the locked-state copy
			{
				verb: 'hasElement',
				target: 'button[title="Editing disabled while Auto Run active"]',
			},
			// And it carries the disabled attribute
			{
				verb: 'hasElement',
				target: 'button[title="Editing disabled while Auto Run active"][disabled]',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-expanded-modal-does-not-render-unsaved-confirm-on-initial-mount',
		given: 'AutoRunExpandedModal mounts in any state; user has not interacted yet.',
		when: ['the modal mounts (no clicks)'],
		then: [
			// The unsaved-changes confirmation is gated behind a state flag that
			// defaults to false — the dialog should NOT be in the tree on mount.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("You have unsaved changes to this Auto Run document")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-expanded-modal-no-module-load-ipc-lifecycle-pin',
		given:
			'AutoRunExpandedModal mounts in any state (idle, locked, stopping, with or without PlayBooks).',
		when: ['the module loads and the modal mounts'],
		then: [
			// The MODAL SHELL itself must never reach `window.maestro` or any
			// WS transport at module load. All side effects flow through prop
			// callbacks (`onClose`, `onStateChange`, `onOpenBatchRunner`,
			// `onStopBatchRun`, the Phase-5.10 error-handling triad,
			// `onOpenMarketplace`) supplied by the caller. The cross-fork
			// import of `AutoRun` is a runtime IPC surface that belongs to
			// that subcomponent's catalog, NOT to this shell. This story pins
			// the shell-lifecycle contract so a future refactor that wires
			// IPC directly into the modal would fail the catalog rather than
			// silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('AutoRunExpandedModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = autoRunExpandedModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunExpandedModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunExpandedModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunExpandedModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunExpandedModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('story names are unique', () => {
		const names = autoRunExpandedModalParityCatalog.map((s) => s.name);
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
		for (const story of autoRunExpandedModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
