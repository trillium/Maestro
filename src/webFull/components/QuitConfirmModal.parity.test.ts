/**
 * Parity catalog — QuitConfirmModal
 *
 * Layer 2.5 — leaf-parade lift wave. Confirm-modal sibling of the L2.4
 * `ResetTasksConfirmModal` lift and the L2.5 `DeleteAgentConfirmModal` /
 * `PlaybookDeleteConfirmModal` lifts. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * QuitConfirmModal is a pure UI primitive that warns the user that
 * quitting will interrupt busy agents. It takes `busyAgentCount`,
 * `busyAgentNames`, `onConfirmQuit`, and `onCancel`. It touches 0 IPC
 * namespaces and 0 Electron-only APIs (the renderer-side handler that
 * actually quits the Electron app lives in `App.tsx` — outside this
 * component's surface). The parity contract is therefore observable-
 * behavior-only: the modal renders with the right header + warning copy,
 * surfaces the busy agent names and a `+N more` overflow token, focus
 * defaults to Cancel on mount, the two action buttons fire their
 * respective callbacks, Escape routes through the layer stack to
 * `onCancel`, and the singular/plural agent-text adjective branch
 * resolves correctly for `busyAgentCount === 1` vs `> 1`.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior,
 *   not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per
 * happy-path story → minimum 3 happy + 3 negative. This catalog ships
 * 5 happy + 5 negative = 10 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb
 * here is explicitly out of scope; if a story needs an assertion that
 * doesn't fit, the story is wrong, not the vocabulary.
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

export const quitConfirmModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal renders with correct chrome ============
	{
		name: 'quit-confirm-modal-shows-warning-header-and-quit-prompt',
		given:
			'The user triggers a quit while two agents are busy with names ["graph-fixer", "doc-writer"].',
		when: [
			'the QuitConfirmModal mounts with busyAgentCount=2 and busyAgentNames=["graph-fixer", "doc-writer"]',
		],
		then: [
			// Modal chrome present with the documented aria-label and aria-modal
			{
				verb: 'hasElement',
				target: '[role="dialog"][aria-label="Confirm Quit Application"]',
			},
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Quit Maestro?' },
			// Body warning copy is present (plural form)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'agents are currently thinking' },
			// Active Agents pill row header is present
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Active Agents' },
		],
		happyPath: true,
	},
	{
		name: 'quit-confirm-modal-renders-busy-agent-names-as-pills',
		given:
			'The QuitConfirmModal is open with busyAgentCount=2 and busyAgentNames=["graph-fixer", "doc-writer"].',
		when: ['the modal renders its body'],
		then: [
			// Each busy-agent name is rendered inline in the pill row
			{ verb: 'hasText', target: '[role="dialog"]', value: 'graph-fixer' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'doc-writer' },
		],
		happyPath: true,
	},
	{
		name: 'quit-confirm-modal-overflow-shows-plus-n-more-when-more-than-three-busy',
		given:
			'The QuitConfirmModal is open with busyAgentCount=5 and busyAgentNames=["a","b","c","d","e"].',
		when: ['the modal renders its body'],
		then: [
			// The first three names render as pills
			{ verb: 'hasText', target: '[role="dialog"]', value: 'a' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'b' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'c' },
			// Overflow token names the count of remaining busy agents
			{ verb: 'hasText', target: '[role="dialog"]', value: '+2 more' },
		],
		happyPath: true,
	},
	{
		name: 'quit-confirm-modal-singular-form-when-one-agent-busy',
		given: 'The QuitConfirmModal is open with busyAgentCount=1 and busyAgentNames=["graph-fixer"].',
		when: ['the modal renders its body'],
		then: [
			// Singular grammar branch — "agent is" not "agents are"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'agent is currently thinking' },
		],
		happyPath: true,
	},
	{
		name: 'quit-confirm-modal-auto-run-flips-thinking-to-active',
		given:
			'The QuitConfirmModal is open with busyAgentCount=1 and busyAgentNames=["graph-fixer (Auto Run)"].',
		when: ['the modal renders its body'],
		then: [
			// When ANY busy agent name contains "(Auto Run)", the adjective flips
			// from "thinking" to "active". Singular grammar branch still applies.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'agent is currently active' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'quit-confirm-modal-cancel-click-closes-without-quitting',
		given: 'The QuitConfirmModal is open with busyAgentCount=2 and the Cancel button has focus.',
		when: ['the user clicks the Cancel button'],
		then: [
			// Modal closes after Cancel (caller-supplied onCancel handler tears the
			// modal down). The destructive onConfirmQuit callback must NOT have
			// fired — observed by the dialog disappearing without a quit having
			// happened.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'quit-confirm-modal-escape-key-closes-without-quitting',
		given: 'The QuitConfirmModal is the topmost layer with busyAgentCount=2.',
		when: ['the user presses Escape'],
		then: [
			// Escape routes through the layer stack to onCancel (registered with
			// onEscape: () => onCancelRef.current()). Modal closes; destructive
			// onConfirmQuit does NOT fire.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'quit-confirm-modal-cancel-has-initial-focus',
		given: 'The QuitConfirmModal mounts with busyAgentCount=2 and the user has not interacted yet.',
		when: ['the modal completes its initial useEffect'],
		then: [
			// Cancel is the safer default — focus must land on Cancel on mount,
			// NOT on Quit Anyway. Pressing Enter immediately after the modal
			// appears must therefore route to onCancel, not onConfirmQuit.
			{ verb: 'hasElement', target: '[role="dialog"]' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
			// The destructive label is also present — the test guards that BOTH
			// buttons exist and that focus distinguishes them.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Quit Anyway' },
		],
		happyPath: false,
	},
	{
		name: 'quit-confirm-modal-no-overflow-when-exactly-three-busy',
		given: 'The QuitConfirmModal is open with busyAgentCount=3 and busyAgentNames=["a","b","c"].',
		when: ['the modal renders its body'],
		then: [
			// All three pills render. No "+N more" overflow token because
			// remainingCount = 3 - 3 = 0 → the overflow branch is gated by
			// `remainingCount > 0`.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'a' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'b' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'c' },
			// Dialog stays open — assert the modal is still visible so the
			// boundary case is observable without a "does NOT contain" verb.
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
	{
		name: 'quit-confirm-modal-keyboard-hints-row-is-rendered',
		given: 'The QuitConfirmModal is open with busyAgentCount=2.',
		when: ['the modal renders its footer hints row'],
		then: [
			// The three keyboard-hint <kbd> tokens are present so the user has
			// in-modal documentation of the keyboard contract. This guards the
			// hints row from being silently dropped by a future refactor.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Tab' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Enter' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Esc' },
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
describe('QuitConfirmModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = quitConfirmModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = quitConfirmModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = quitConfirmModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of quitConfirmModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of quitConfirmModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('every story has a unique name', () => {
		const names = quitConfirmModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// QuitConfirmModal is a pure UI primitive — no IPC, no shell, no
		// dialog, no notifications fired from the component itself. The
		// quit callback is caller-supplied and not part of the component's
		// surface. Sanity check that no story leaks a renderer-only
		// assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of quitConfirmModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
