/**
 * Parity catalog — ResetTasksConfirmModal
 *
 * Layer 2.4 — leaf-component lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ResetTasksConfirmModal is a pure UI primitive — it takes `documentName`,
 * `completedTaskCount`, and two callbacks (`onConfirm`, `onClose`). It touches
 * 0 IPC namespaces and 0 Electron-only APIs. The parity contract is
 * therefore observable-behavior-only: the modal renders with the right header
 * and body copy, the confirm action invokes both callbacks, and Cancel /
 * Escape closes without committing. Persistence (the actual task reset) is
 * the caller's job.
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

export const resetTasksConfirmModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with correct copy ============
	{
		name: 'reset-tasks-modal-shows-document-name-and-task-count',
		given:
			'The user has 7 completed tasks in a document named "Sprint Planning" and triggers the reset confirmation.',
		when: [
			'the ResetTasksConfirmModal mounts with documentName="Sprint Planning" and completedTaskCount=7',
		],
		then: [
			// Modal chrome is present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Reset Completed Tasks"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Reset Completed Tasks' },
			// Body text references the document name
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Sprint Planning' },
			// Body text references the count and uses plural form
			{ verb: 'hasText', target: '[role="dialog"]', value: '7 completed tasks' },
			// Confirm button labeled "Reset Tasks"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Reset Tasks' },
		],
		happyPath: true,
	},
	{
		name: 'reset-tasks-modal-singularizes-task-noun-when-count-is-one',
		given:
			'The user has exactly 1 completed task in a document named "Daily Notes" and triggers the reset confirmation.',
		when: [
			'the ResetTasksConfirmModal mounts with documentName="Daily Notes" and completedTaskCount=1',
		],
		then: [
			// Body text uses singular "task" not "tasks"
			{ verb: 'hasText', target: '[role="dialog"]', value: '1 completed task' },
			// Document name is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Daily Notes' },
		],
		happyPath: true,
	},
	{
		name: 'reset-tasks-modal-confirm-closes-modal',
		given:
			'The ResetTasksConfirmModal is open with documentName="Sprint Planning" and completedTaskCount=3.',
		when: ['the user clicks the "Reset Tasks" button'],
		then: [
			// Modal is closed (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'reset-tasks-modal-cancel-closes-without-committing',
		given:
			'The ResetTasksConfirmModal is open with documentName="Sprint Planning" and completedTaskCount=3.',
		when: ['the user clicks the "Cancel" button'],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'reset-tasks-modal-escape-key-closes-without-committing',
		given:
			'The ResetTasksConfirmModal is the topmost layer with documentName="Sprint Planning" and completedTaskCount=3.',
		when: ['the user presses Escape'],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
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
describe('ResetTasksConfirmModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(resetTasksConfirmModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = resetTasksConfirmModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = resetTasksConfirmModalParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of resetTasksConfirmModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of resetTasksConfirmModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// ResetTasksConfirmModal is a pure UI primitive — no IPC, no shell, no
		// dialog, no notifications fired from the component itself. Sanity
		// check that no story leaks a renderer-only assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of resetTasksConfirmModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
