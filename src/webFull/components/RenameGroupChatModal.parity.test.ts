/**
 * Parity catalog — RenameGroupChatModal
 *
 * Layer 2.5 — leaf-component lift wave, leaf-parade batch #3. Per
 * WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every feature port
 * ships with a catalog of (Given, When, Then) stories using the fixed
 * assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * RenameGroupChatModal is a pure UI primitive — it accepts `currentName`,
 * `isOpen`, and two callbacks (`onClose`, `onRename`). It touches 0 IPC
 * namespaces and 0 Electron-only APIs. The parity contract is therefore
 * observable-behavior-only: the modal renders when `isOpen` is true, the input
 * pre-fills with the current name, Enter / Rename click commits the trimmed
 * value WHEN the value is non-empty AND differs from `currentName`, and
 * Cancel / Escape closes without committing. Persistence is the caller's job.
 *
 * Distinguishing feature vs RenameTabModal (L2.3 sibling): the Rename action
 * is disabled when the input is empty OR unchanged from `currentName`. The
 * negative-path stories cover both edge cases — empty input and unchanged
 * input both result in a no-op confirm.
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

export const renameGroupChatModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'rename-group-chat-shows-input-prefilled-with-current-name',
		given: 'The user has a group chat named "Squad Goals" and opens the Rename Group Chat modal.',
		when: ['the RenameGroupChatModal mounts with isOpen=true and currentName="Squad Goals"'],
		then: [
			// Modal chrome is present (uses the lifted Modal primitive).
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Rename Group Chat"]' },
			// The FormInput is rendered and visible.
			{ verb: 'hasElement', target: '[role="dialog"] input[type="text"]' },
			// Header reflects the modal purpose.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename Group Chat' },
			// Field label is rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Chat Name' },
			// Confirm button is labeled "Rename".
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename' },
		],
		happyPath: true,
	},
	{
		name: 'rename-group-chat-commits-trimmed-value-and-closes',
		given:
			'The RenameGroupChatModal is open with currentName="Squad Goals" and the user types "  Project Alpha  ".',
		when: [
			'the user replaces the input contents with "  Project Alpha  "',
			'the user clicks the "Rename" button (or presses Enter)',
		],
		then: [
			// Modal is closed (no dialog in the DOM).
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},
	{
		name: 'rename-group-chat-resets-input-when-reopened-with-different-current-name',
		given:
			'The RenameGroupChatModal was previously open for chat "Old Name", was closed, and is now re-opened for chat "New Chat".',
		when: ['the RenameGroupChatModal re-mounts (or re-opens) with currentName="New Chat"'],
		then: [
			// The input value reflects the NEW currentName, not stale state from the prior session.
			{ verb: 'hasElement', target: '[role="dialog"] input[value="New Chat"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'rename-group-chat-cancel-closes-without-committing',
		given:
			'The RenameGroupChatModal is open with currentName="Squad Goals" and the user has typed "Project Alpha" but not confirmed.',
		when: ['the user clicks the "Cancel" button'],
		then: [
			// Modal is closed.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'rename-group-chat-escape-key-closes-modal',
		given: 'The RenameGroupChatModal is the topmost layer and the input has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal is closed.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'rename-group-chat-confirm-disabled-when-input-is-empty',
		given:
			'The RenameGroupChatModal is open with currentName="Squad Goals" and the user has cleared the input to "".',
		when: ['the user clears the input contents to an empty string'],
		then: [
			// The Rename button is rendered in a disabled state — confirm is a no-op.
			{ verb: 'hasElement', target: '[role="dialog"] button[disabled]' },
			// Modal stays open (still has a dialog in the DOM).
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
	{
		name: 'rename-group-chat-confirm-disabled-when-input-matches-current-name',
		given:
			'The RenameGroupChatModal is open with currentName="Squad Goals" and the user has not edited the input.',
		when: ['the input value remains exactly "Squad Goals" (whitespace-trimmed)'],
		then: [
			// The Rename button is rendered in a disabled state — no-op confirm prevents redundant renames.
			{ verb: 'hasElement', target: '[role="dialog"] button[disabled]' },
			// Modal stays open.
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION + the brief's "≥3 happy + ≥1 negative-per-happy"
 * floor: 3 happy-path stories AND ≥3 negative-path stories. This vitest pass
 * acts as a compile-time guard for the catalog shape; the actual
 * record-and-replay harness lands later.
 */
describe('RenameGroupChatModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = renameGroupChatModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = renameGroupChatModalParityCatalog.filter((s) => s.happyPath);
		const negative = renameGroupChatModalParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(happy.length);
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
		for (const story of renameGroupChatModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of renameGroupChatModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('every story declares a unique name', () => {
		const names = renameGroupChatModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// RenameGroupChatModal is a pure UI primitive — no IPC, no shell, no
		// dialog, no notifications fired from the component itself. Sanity check
		// that no story leaks a renderer-only assertion target into the catalog.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of renameGroupChatModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
