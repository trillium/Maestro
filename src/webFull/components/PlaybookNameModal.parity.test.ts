/**
 * Parity catalog — PlaybookNameModal
 *
 * Layer 2.4 — leaf-component lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * PlaybookNameModal is a pure UI primitive that captures a playbook name from
 * the user. It takes `onSave`, `onCancel`, optional `initialName`, `title`,
 * and `saveButtonText`. It touches 0 IPC namespaces and 0 Electron-only APIs.
 * The parity contract is therefore observable-behavior-only: the modal
 * renders with the right header and button label, the input echoes
 * keystrokes, Save commits the trimmed value (only when non-empty), and
 * Cancel / Escape closes without committing. Persistence is the caller's
 * job.
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

export const playbookNameModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with default copy ============
	{
		name: 'playbook-name-modal-shows-default-title-and-button',
		given: 'The user invokes Save Playbook from the BatchRunner with no initialName provided.',
		when: ['the PlaybookNameModal mounts with default props'],
		then: [
			// Modal chrome present
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Save Playbook"]' },
			// Default title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Save Playbook' },
			// Default Save button labeled "Save"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Save' },
			// Input field is rendered with the labeled placeholder
			{
				verb: 'hasElement',
				target: '[role="dialog"] input[placeholder="Enter playbook name..."]',
			},
			// Helper text is shown
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Give your playbook a descriptive name',
			},
		],
		happyPath: true,
	},
	{
		name: 'playbook-name-modal-prefills-input-with-initial-name',
		given:
			'The user opens the modal in rename mode with initialName="Morning Routine", title="Rename Playbook", saveButtonText="Rename".',
		when: ['the PlaybookNameModal mounts with the rename props'],
		then: [
			// Custom title is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename Playbook' },
			// Custom button label is shown
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename' },
			// Input is prefilled with the initial value
			{
				verb: 'hasElement',
				target: '[role="dialog"] input[value="Morning Routine"]',
			},
		],
		happyPath: true,
	},
	{
		name: 'playbook-name-modal-save-with-valid-name-closes-modal',
		given: 'The PlaybookNameModal is open and the user has typed "New Playbook" in the input.',
		when: [
			'the user types "New Playbook" into the input',
			'the user clicks the Save button (or presses Enter)',
		],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'playbook-name-modal-cancel-closes-without-saving',
		given: 'The PlaybookNameModal is open with the user partway through typing a name.',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'playbook-name-modal-escape-key-closes-modal',
		given: 'The PlaybookNameModal is the topmost layer and the input has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('PlaybookNameModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(playbookNameModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = playbookNameModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = playbookNameModalParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of playbookNameModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of playbookNameModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of playbookNameModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
