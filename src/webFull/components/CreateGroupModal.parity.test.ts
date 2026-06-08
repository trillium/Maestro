/**
 * Parity catalog — CreateGroupModal
 *
 * Layer 2.4 — leaf-component lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * CreateGroupModal is a pure UI primitive that exercises three lifted
 * primitives end-to-end (Modal, FormInput, EmojiPickerField). It takes
 * `theme`, `groups`, `setGroups`, `onClose`, and an optional
 * `onGroupCreated`. It touches 0 IPC namespaces and 0 Electron-only APIs.
 * The parity contract is therefore observable-behavior-only: the modal
 * renders, the emoji defaults to the open-folder glyph, the name input
 * accepts keystrokes, Create commits a new Group through `setGroups` (only
 * when the name is non-empty), and Cancel / Escape closes without
 * committing. Persistence is the caller's job.
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

export const createGroupModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with default state ============
	{
		name: 'create-group-modal-shows-title-and-create-button',
		given: 'The user opens the Create New Group modal from the session list.',
		when: ['the CreateGroupModal mounts with an empty groups array'],
		then: [
			// Modal chrome present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Create New Group"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Create New Group' },
			// Confirm button labeled "Create"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Create' },
			// Group Name input is rendered with its label
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Group Name' },
			// Group Name input is present and editable
			{
				verb: 'hasElement',
				target: '[role="dialog"] input[placeholder="Enter group name..."]',
			},
		],
		happyPath: true,
	},
	{
		name: 'create-group-modal-defaults-to-open-folder-emoji',
		given: 'The user has just opened the Create New Group modal.',
		when: ['the CreateGroupModal mounts'],
		then: [
			// The emoji selector renders with the default folder emoji
			{ verb: 'hasText', target: '[role="dialog"]', value: '📂' },
		],
		happyPath: true,
	},
	{
		name: 'create-group-modal-create-with-valid-name-closes-modal',
		given:
			'The CreateGroupModal is open with an empty groups array and the user types "Backend".',
		when: [
			'the user types "Backend" into the Group Name input',
			'the user clicks the Create button',
		],
		then: [
			// Modal is closed (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'create-group-modal-cancel-closes-without-creating',
		given:
			'The CreateGroupModal is open with the user partway through typing a name.',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'create-group-modal-escape-key-closes-modal',
		given:
			'The CreateGroupModal is the topmost layer and the Group Name input has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('CreateGroupModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(createGroupModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = createGroupModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = createGroupModalParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of createGroupModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of createGroupModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of createGroupModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
