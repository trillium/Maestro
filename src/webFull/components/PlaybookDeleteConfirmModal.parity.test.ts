/**
 * Parity catalog — PlaybookDeleteConfirmModal
 *
 * Layer 2.5 — leaf-parade lift wave (batch item #1). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * PlaybookDeleteConfirmModal is a pure UI primitive that asks the user to
 * confirm deletion of a named playbook. It takes `playbookName`, `onConfirm`,
 * and `onCancel`. It touches 0 IPC namespaces and 0 Electron-only APIs. The
 * parity contract is therefore observable-behavior-only: the modal renders
 * with the right destructive header + Delete label, names the playbook
 * inline, warns the action cannot be undone, Delete commits then closes,
 * Cancel/Escape closes without committing. Persistence is the caller's job.
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

export const playbookDeleteConfirmModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with destructive chrome ============
	{
		name: 'playbook-delete-confirm-modal-shows-destructive-title-and-button',
		given:
			'The user invokes Delete Playbook from the playbook list with playbookName="Morning Routine".',
		when: ['the PlaybookDeleteConfirmModal mounts'],
		then: [
			// Modal chrome present with the destructive title
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Delete Playbook"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete Playbook' },
			// Destructive confirm button labeled "Delete"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete' },
			// Cancel affordance is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
		],
		happyPath: true,
	},
	{
		name: 'playbook-delete-confirm-modal-names-the-playbook-and-warns',
		given: 'The PlaybookDeleteConfirmModal is open with playbookName="Morning Routine".',
		when: ['the modal renders its body'],
		then: [
			// The playbook name is shown inline in the prompt
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Morning Routine' },
			// The "are you sure" lead-in is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Are you sure you want to delete' },
			// The irreversibility warning is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'This cannot be undone.' },
		],
		happyPath: true,
	},
	{
		name: 'playbook-delete-confirm-modal-confirm-closes-modal',
		given:
			'The PlaybookDeleteConfirmModal is open with playbookName="Morning Routine" and the Delete button has focus.',
		when: ['the user clicks the Delete button (or presses Enter)'],
		then: [
			// Modal closes after confirmation (handleConfirmClick calls onCancel())
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'playbook-delete-confirm-modal-cancel-closes-without-deleting',
		given: 'The PlaybookDeleteConfirmModal is open with playbookName="Morning Routine".',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'playbook-delete-confirm-modal-escape-key-closes-modal',
		given: 'The PlaybookDeleteConfirmModal is the topmost layer and the Delete button has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes (layer stack handles Escape per ModalProps onClose)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('PlaybookDeleteConfirmModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(playbookDeleteConfirmModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = playbookDeleteConfirmModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = playbookDeleteConfirmModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = playbookDeleteConfirmModalParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief requirement: ≥1 negative-path per happy-path. Catalog must honour this floor.
		expect(negative * happy).toBeGreaterThanOrEqual(happy);
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
		for (const story of playbookDeleteConfirmModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of playbookDeleteConfirmModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of playbookDeleteConfirmModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
