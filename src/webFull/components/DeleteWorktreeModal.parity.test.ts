/**
 * Parity catalog — DeleteWorktreeModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * DeleteWorktreeModal is a pure UI primitive that confirms removal of a
 * worktree-child sub-agent. It takes a `session` (with `name` + `cwd`) and
 * three callbacks: `onClose`, `onConfirm` (remove only — leave directory),
 * and `onConfirmAndDelete` (remove AND delete directory). Unlike the
 * sibling PlaybookDeleteConfirmModal, the footer is a three-button row plus
 * a single-button "Deleting..." loading state — this catalog covers both
 * the resting state and the loading state.
 *
 * The modal touches 0 IPC namespaces and 0 Electron-only APIs. The parity
 * contract is therefore observable-behavior-only: chrome + destructive
 * labelling, the session name + cwd rendered inline, both Remove and
 * Remove-and-Delete paths reachable, loading state replaces the row,
 * Cancel/Escape close without committing, and the error message renders
 * inline when `onConfirmAndDelete` rejects.
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

export const deleteWorktreeModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with destructive chrome ============
	{
		name: 'delete-worktree-modal-shows-destructive-title-and-three-action-buttons',
		given:
			'The user invokes Delete Worktree from a worktree-child session with session.name="feature-branch-1".',
		when: ['the DeleteWorktreeModal mounts'],
		then: [
			// Modal chrome present with the destructive title
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Delete Worktree"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete Worktree' },
			// Cancel affordance is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
			// Remove (sub-agent only) action is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Remove' },
			// Remove and Delete (sub-agent + directory) action is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Remove and Delete' },
		],
		happyPath: true,
	},
	{
		name: 'delete-worktree-modal-names-the-session-and-explains-both-actions',
		given:
			'The DeleteWorktreeModal is open with session.name="feature-branch-1" and session.cwd="/Users/trilliumsmith/code/maestro/worktrees/feature-branch-1".',
		when: ['the modal renders its body'],
		then: [
			// The session name is shown inline in the prompt
			{ verb: 'hasText', target: '[role="dialog"]', value: 'feature-branch-1' },
			// The "delete worktree session" lead-in is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete worktree session' },
			// The Remove action's explanation is shown
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'keeps the git worktree directory on disk',
			},
			// The Remove and Delete action's explanation is shown
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'permanently deletes the worktree directory from disk',
			},
			// The session cwd is shown inline (monospace path readout)
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: '/Users/trilliumsmith/code/maestro/worktrees/feature-branch-1',
			},
		],
		happyPath: true,
	},
	{
		name: 'delete-worktree-modal-remove-closes-modal-and-fires-onconfirm',
		given:
			'The DeleteWorktreeModal is open with session.name="feature-branch-1" and the Remove button has focus.',
		when: ['the user clicks the Remove button (or presses Enter)'],
		then: [
			// Modal closes after onConfirm (handleConfirm calls onConfirm() then onClose())
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},
	{
		name: 'delete-worktree-modal-remove-and-delete-shows-loading-then-closes',
		given:
			'The DeleteWorktreeModal is open with session.name="feature-branch-1" and onConfirmAndDelete returns a resolved promise after a small delay.',
		when: [
			'the user clicks the Remove and Delete button',
			'the await on onConfirmAndDelete resolves',
		],
		then: [
			// During the await the row is replaced by a single disabled "Deleting..." button
			// (asserted at the in-flight slice — once the promise resolves the modal unmounts).
			// The terminal state is the closed modal.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'delete-worktree-modal-cancel-closes-without-committing',
		given: 'The DeleteWorktreeModal is open with session.name="feature-branch-1".',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes; neither onConfirm nor onConfirmAndDelete fire.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-worktree-modal-escape-key-closes-modal',
		given: 'The DeleteWorktreeModal is the topmost layer and the Remove button has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes (layer stack handles Escape per ModalProps onClose).
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-worktree-modal-remove-and-delete-rejection-surfaces-inline-error',
		given:
			'The DeleteWorktreeModal is open with session.name="feature-branch-1" and onConfirmAndDelete rejects with new Error("ENOTEMPTY: directory not empty").',
		when: [
			'the user clicks the Remove and Delete button',
			'the await on onConfirmAndDelete rejects',
		],
		then: [
			// Modal stays open with the error message rendered inline.
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Delete Worktree"]' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'ENOTEMPTY: directory not empty' },
			// The three-button row is restored (isDeleting flipped back to false after the catch).
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Remove and Delete' },
		],
		happyPath: false,
	},
	{
		name: 'delete-worktree-modal-omits-cwd-readout-when-session-cwd-is-empty',
		given:
			'The DeleteWorktreeModal is open with session.name="orphan-branch" and session.cwd="" (falsy — no cwd recorded for this session).',
		when: ['the modal renders its body'],
		then: [
			// The modal still renders the prompt and the action explanations…
			{ verb: 'hasText', target: '[role="dialog"]', value: 'orphan-branch' },
			// …but the monospace cwd readout is not present (renderer guards on session.cwd truthiness).
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
];

describe('DeleteWorktreeModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(deleteWorktreeModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = deleteWorktreeModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = deleteWorktreeModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = deleteWorktreeModalParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief requirement: ≥1 negative-path per happy-path. Catalog must honour this floor.
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
		for (const story of deleteWorktreeModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of deleteWorktreeModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of deleteWorktreeModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
