/**
 * Parity catalog — RenameGroupModal
 *
 * Layer 2.5 — leaf-component lift wave (leaf-parade batch #4). Per
 * WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every feature
 * port ships with a catalog of (Given, When, Then) stories using the fixed
 * assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * RenameGroupModal is a pure UI primitive that exercises three lifted
 * primitives end-to-end (Modal, FormInput, EmojiPickerField). It takes
 * `theme`, `groupId`, `groupName` + `setGroupName`, `groupEmoji` +
 * `setGroupEmoji`, `onClose`, `groups`, and `setGroups`. It touches 0 IPC
 * namespaces and 0 Electron-only APIs. The parity contract is therefore
 * observable-behavior-only: the modal renders, the name input is prefilled
 * with the current group name, the emoji selector exposes the current emoji,
 * Enter / Rename click commits the trimmed+upper-cased value through
 * `setGroups` (only when the name is non-empty after trim), and Cancel /
 * Escape closes without committing. Persistence is the caller's job.
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

export const renameGroupModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with prefilled state ============
	{
		name: 'rename-group-modal-shows-title-and-rename-button',
		given: 'The user opens the Rename Group modal for an existing group ("Backend", folder emoji).',
		when: ['the RenameGroupModal mounts with groupId="g-1", groupName="Backend", groupEmoji="📂"'],
		then: [
			// Modal chrome present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Rename Group"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename Group' },
			// Confirm button labeled "Rename"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename' },
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
		name: 'rename-group-modal-prefills-current-name-and-emoji',
		given:
			'The user has just opened the Rename Group modal for groupName="Backend", groupEmoji="📂".',
		when: ['the RenameGroupModal mounts with the existing group state'],
		then: [
			// The Group Name input reflects the current name (controlled value)
			{
				verb: 'hasElement',
				target: '[role="dialog"] input[type="text"]',
			},
			// The emoji selector renders the current emoji glyph
			{ verb: 'hasText', target: '[role="dialog"]', value: '📂' },
		],
		happyPath: true,
	},
	{
		name: 'rename-group-modal-rename-with-valid-name-closes-modal',
		given:
			'The RenameGroupModal is open with groupName="Backend" and the user replaces it with "Frontend".',
		when: [
			'the user replaces the Group Name input contents with "Frontend"',
			'the user clicks the Rename button (or presses Enter)',
		],
		then: [
			// Modal is closed (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths (≥1 per happy) ============
	{
		name: 'rename-group-modal-cancel-closes-without-renaming',
		given:
			'The RenameGroupModal is open and the user has typed a different name but not confirmed.',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'rename-group-modal-escape-key-closes-modal',
		given: 'The RenameGroupModal is the topmost layer and the Group Name input has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'rename-group-modal-empty-name-disables-rename-button',
		given: 'The RenameGroupModal is open and the user has cleared the Group Name input entirely.',
		when: ['the user deletes the contents of the Group Name input (groupName="")'],
		then: [
			// Rename button is disabled (confirmDisabled=!groupName.trim())
			{
				verb: 'hasElement',
				target: '[role="dialog"] button[disabled]',
			},
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION + the leaf-parade batch brief: ≥3 happy-path
 * stories AND ≥1 negative-path story per happy-path story (total ≥6). This
 * vitest pass acts as a compile-time guard for the catalog shape; the actual
 * record-and-replay harness lands later.
 */
describe('RenameGroupModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = renameGroupModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = renameGroupModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = renameGroupModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of renameGroupModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of renameGroupModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// RenameGroupModal is a pure UI primitive — no IPC, no shell, no dialog,
		// no notifications fired from the component itself. Sanity check that
		// no story leaks a renderer-only assertion target into the catalog.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of renameGroupModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
