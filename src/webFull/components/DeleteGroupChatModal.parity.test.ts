/**
 * Parity catalog — DeleteGroupChatModal
 *
 * Layer 2.5 — leaf-parade batch #2 lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * DeleteGroupChatModal is a pure confirmation UI built on the L2.1 Modal +
 * ModalFooter primitives. It takes `theme`, `isOpen`, `groupChatName`,
 * `onClose`, and `onConfirm`. It touches 0 IPC namespaces and 0 Electron-only
 * APIs. The parity contract is therefore observable-behavior-only: the modal
 * renders with the destructive title + icon when `isOpen` is true, surfaces
 * the supplied group-chat name in the confirmation copy, exposes a "Delete"
 * destructive button focused on mount, and closes via Cancel / Escape /
 * Delete (calling `onConfirm` first in the Delete path).
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

export const deleteGroupChatModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders destructive chrome ============
	{
		name: 'delete-groupchat-modal-shows-title-and-delete-button',
		given: 'The user opens the Delete Group Chat confirmation from the session list overflow menu.',
		when: ['the DeleteGroupChatModal mounts with isOpen=true and groupChatName="Backend Standup"'],
		then: [
			// Modal chrome present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Delete Group Chat"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete Group Chat' },
			// Destructive confirm button labeled "Delete"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Delete' },
			// Cancel button is rendered alongside the destructive button
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
		],
		happyPath: true,
	},
	{
		name: 'delete-groupchat-modal-surfaces-group-chat-name-in-prompt',
		given: 'The DeleteGroupChatModal has just opened against a group chat named "Backend Standup".',
		when: ['the DeleteGroupChatModal mounts with groupChatName="Backend Standup"'],
		then: [
			// The confirmation prompt embeds the supplied name verbatim
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Backend Standup' },
			// The destructive copy is present so the user knows this is permanent
			{ verb: 'hasText', target: '[role="dialog"]', value: 'permanently delete' },
			// Participant-session safety note is rendered
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Participant sessions' },
		],
		happyPath: true,
	},
	{
		name: 'delete-groupchat-modal-delete-button-closes-modal',
		given: 'The DeleteGroupChatModal is open for "Backend Standup" with the Delete button focused.',
		when: ['the user clicks the Delete button'],
		then: [
			// Modal closes (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'delete-groupchat-modal-isopen-false-renders-nothing',
		given: 'The DeleteGroupChatModal receives isOpen=false (parent kept it mounted but inactive).',
		when: ['the DeleteGroupChatModal renders with isOpen=false'],
		then: [
			// No dialog is in the DOM — `if (!isOpen) return null;`
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-groupchat-modal-cancel-closes-without-confirming',
		given: 'The DeleteGroupChatModal is open and the user reconsiders the deletion.',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-groupchat-modal-escape-key-closes-modal',
		given: 'The DeleteGroupChatModal is the topmost layer and the Delete button has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes via the layer-stack Escape handler
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('DeleteGroupChatModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(deleteGroupChatModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one happy-path story', () => {
		const happy = deleteGroupChatModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = deleteGroupChatModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = deleteGroupChatModalParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(happy >= 1 ? 1 : 0);
		// Sanity: at least one negative story exists regardless of happy count
		expect(negative).toBeGreaterThanOrEqual(1);
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
		for (const story of deleteGroupChatModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of deleteGroupChatModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of deleteGroupChatModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
