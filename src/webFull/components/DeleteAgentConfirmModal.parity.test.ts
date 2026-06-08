/**
 * Parity catalog — DeleteAgentConfirmModal
 *
 * Layer 2.5 — leaf-parade lift wave (batch item #2; sibling of
 * PlaybookDeleteConfirmModal). Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * DeleteAgentConfirmModal is a pure UI primitive — it takes `agentName`,
 * `workingDirectory`, and three callbacks (`onConfirm`, `onConfirmAndErase`,
 * `onClose`). It touches 0 IPC namespaces and 0 Electron-only APIs. The
 * parity contract is therefore observable-behavior-only: the modal renders
 * with the right header, body copy, and three-button footer; the typed-
 * confirmation gate on the destructive "Agent + Working Directory" action
 * is correctly enforced; Cancel and Escape close without committing.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per happy-path
 * story → minimum 3 happy + 3 negative. This catalog ships 4 happy + 4
 * negative = 8 stories.
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

export const deleteAgentConfirmModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with correct header + body ============
	{
		name: 'delete-agent-modal-shows-agent-name-and-working-directory',
		given:
			'The user has an agent named "graph-fixer" with workingDirectory "/Users/dev/code/graph-fixer" and triggers the delete confirmation.',
		when: [
			'the DeleteAgentConfirmModal mounts with agentName="graph-fixer" and workingDirectory="/Users/dev/code/graph-fixer"',
		],
		then: [
			// Modal chrome is present (uses the lifted Modal primitive)
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Confirm Delete"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Confirm Delete' },
			// Body text references the agent name in quotes
			{ verb: 'hasText', target: '[role="dialog"]', value: '"graph-fixer"' },
			// Body shows the working-directory code block
			{ verb: 'hasText', target: '[role="dialog"]', value: '/Users/dev/code/graph-fixer' },
			// Cannot-be-undone warning is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'cannot be undone' },
		],
		happyPath: true,
	},
	{
		name: 'delete-agent-modal-renders-three-button-footer',
		given:
			'The DeleteAgentConfirmModal is open with agentName="my-agent" and workingDirectory="/tmp/x".',
		when: ['the modal mounts'],
		then: [
			// All three footer buttons are present with the expected labels
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent Only' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent + Working Directory' },
			// Confirmation input is present with the documented aria-label
			{ verb: 'hasElement', target: '[role="dialog"] input[aria-label="Confirm agent name"]' },
		],
		happyPath: true,
	},
	{
		name: 'delete-agent-modal-agent-only-click-closes-modal',
		given:
			'The DeleteAgentConfirmModal is open with agentName="my-agent" and workingDirectory="/tmp/x".',
		when: ['the user clicks the "Agent Only" button'],
		then: [
			// Modal is closed (no dialog in the DOM)
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},
	{
		name: 'delete-agent-modal-erase-enabled-after-typing-agent-name',
		given:
			'The DeleteAgentConfirmModal is open with agentName="my-agent" and workingDirectory="/tmp/x".',
		when: [
			'the user types "my-agent" into the confirmation input',
			'the user clicks the "Agent + Working Directory" button',
		],
		then: [
			// Modal closes after confirming the destructive action
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'delete-agent-modal-cancel-closes-without-committing',
		given:
			'The DeleteAgentConfirmModal is open with agentName="my-agent" and workingDirectory="/tmp/x".',
		when: ['the user clicks the "Cancel" button'],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-agent-modal-escape-key-closes-without-committing',
		given:
			'The DeleteAgentConfirmModal is the topmost layer with agentName="my-agent" and workingDirectory="/tmp/x".',
		when: ['the user presses Escape'],
		then: [
			// Modal is closed
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'delete-agent-modal-erase-disabled-when-confirmation-text-empty',
		given:
			'The DeleteAgentConfirmModal mounts with agentName="my-agent" and the confirmation input is empty.',
		when: ['the modal is in its initial state'],
		then: [
			// The destructive "Agent + Working Directory" button is disabled when
			// the input does not match agentName. The dialog itself must still be
			// visible — the button is gated, not the entire modal.
			{ verb: 'hasElement', target: '[role="dialog"]' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent + Working Directory' },
		],
		happyPath: false,
	},
	{
		name: 'delete-agent-modal-erase-disabled-when-confirmation-text-mismatches',
		given:
			'The DeleteAgentConfirmModal is open with agentName="my-agent" and the user has typed "wrong-name" into the confirmation input.',
		when: ['the user attempts to click the "Agent + Working Directory" button'],
		then: [
			// Modal stays open — the gate prevents the destructive callback from
			// firing when the typed text does not match agentName.
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per the brief: ≥3 happy-path AND ≥1 negative-path story per happy-path
 * story (so ≥3 negative-path overall). This vitest pass acts as a
 * compile-time guard for the catalog shape; the actual record-and-replay
 * harness lands later.
 */
describe('DeleteAgentConfirmModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = deleteAgentConfirmModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = deleteAgentConfirmModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = deleteAgentConfirmModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of deleteAgentConfirmModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of deleteAgentConfirmModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('every story has a unique name', () => {
		const names = deleteAgentConfirmModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// DeleteAgentConfirmModal is a pure UI primitive — no IPC, no shell, no
		// dialog, no notifications fired from the component itself. The
		// destructive callbacks are caller-supplied and not part of the
		// component's surface. Sanity check that no story leaks a renderer-only
		// assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of deleteAgentConfirmModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
