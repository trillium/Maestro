/**
 * Parity catalog — RenameTabModal
 *
 * Layer 2.3 — leaf-component lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a catalog
 * of (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * RenameTabModal is a pure UI primitive — it accepts `initialName`, an
 * optional `agentSessionId`, and two callbacks (`onClose`, `onRename`). It
 * touches 0 IPC namespaces and 0 Electron-only APIs. The parity contract is
 * therefore observable-behavior-only: the modal renders, the input echoes
 * keystrokes, Enter / Rename click commits the trimmed value, and Cancel /
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

export const renameTabModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal opens, user types new name, Rename commits ============
	{
		name: 'rename-tab-shows-input-prefilled-with-current-name',
		given:
			'The active tab has the name "Untitled" and the user opens the Rename Tab modal.',
		when: ['the RenameTabModal mounts with initialName="Untitled"'],
		then: [
			// Modal chrome is present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Rename Tab"]' },
			// The FormInput is rendered and visible
			{ verb: 'hasElement', target: '[role="dialog"] input[type="text"]' },
			// Header reflects the modal purpose
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename Tab' },
			// Confirm button is labeled "Rename"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Rename' },
		],
		happyPath: true,
	},
	{
		name: 'rename-tab-commits-trimmed-value-and-closes',
		given:
			'The RenameTabModal is open with initialName="Untitled" and the user types "  My Tab  ".',
		when: [
			'the user replaces the input contents with "  My Tab  "',
			'the user clicks the "Rename" button (or presses Enter)',
		],
		then: [
			// Modal is closed (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},
	{
		name: 'rename-tab-with-agent-session-id-shows-uuid-octet-placeholder',
		given:
			'The active tab is bound to agentSessionId="a1b2c3d4-...-deadbeef" and the modal opens with initialName="".',
		when: ['the RenameTabModal mounts with the agentSessionId set'],
		then: [
			// Placeholder reflects the upper-cased first UUID octet
			{
				verb: 'hasElement',
				target: '[role="dialog"] input[placeholder="Rename A1B2C3D4..."]',
			},
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'rename-tab-cancel-closes-without-committing',
		given:
			'The RenameTabModal is open with initialName="Untitled" and the user has typed "New Name" but not confirmed.',
		when: ['the user clicks the "Cancel" button'],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'rename-tab-escape-key-closes-modal',
		given:
			'The RenameTabModal is the topmost layer and the input has focus.',
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
describe('RenameTabModal — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = renameTabModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = renameTabModalParityCatalog.filter((s) => !s.happyPath);
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
		for (const story of renameTabModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of renameTabModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// RenameTabModal is a pure UI primitive — no IPC, no shell, no dialog,
		// no notifications fired from the component itself. Sanity check that
		// no story leaks a renderer-only assertion target into the catalog.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of renameTabModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
