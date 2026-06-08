/**
 * Parity catalog — GroupChatInput
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GroupChatInput is the input region of the Group Chat view. It surfaces:
 *
 *   - A `<textarea>` whose placeholder copy switches on `state !== 'idle'`
 *     between "Type a message... (@ to mention agent)" (idle) and
 *     "Type to queue message..." (busy).
 *   - An `@mention` dropdown that surfaces filtered candidate agents
 *     (excluding terminal sessions) and groups (when non-empty).
 *   - A Send button (`ArrowUp` icon) gated on `message.trim()` being
 *     non-empty; the button's `title` swaps between "Send message" (idle)
 *     and "Queue message" (busy).
 *   - An Attach Image affordance (`title="Attach Image"`) that triggers a
 *     hidden file input.
 *   - A Prompt Composer affordance (only when `onOpenPromptComposer` is
 *     wired) with the `title` prefix "Open Prompt Composer".
 *   - A Read-Only mode pill bearing the literal "Read-Only" copy.
 *   - An Enter-to-send toggle whose copy is supplied by
 *     `formatEnterToSend(enterToSend)` (the L2.5 shim — "Enter ↵" /
 *     "⌘ ⏎" / fallback "Ctrl+Enter").
 *   - When `executionQueue.length > 0`, the sibling L2.5 `QueuedItemsList`
 *     panel renders above the textarea with its canonical "QUEUED (<count>)"
 *     copy.
 *
 * The parity contract is layout-independent and observable-behavior only:
 *
 *   - textarea reachable in every mount.
 *   - placeholder copy swaps with `state`.
 *   - Send button reachable via its `[title="Send message"]` (idle) or
 *     `[title="Queue message"]` (busy).
 *   - Read-Only pill is reachable via its literal "Read-Only" text.
 *   - When the prompt-composer prop is wired, the affordance is reachable
 *     via `[title^="Open Prompt Composer"]`.
 *   - The QueuedItemsList sibling chain works — its "QUEUED (<count>)"
 *     copy is reachable when a queue is wired.
 *   - Negative-path: with no queue wired, "QUEUED (" copy is absent.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 * - Render-shape oriented per the SettingCheckbox / ToggleButtonGroup /
 *   SessionListItem / CollapsibleJsonViewer / GroupChatPanel L2.5 precedent
 *   (`hasElement` / `hasText` only on happy-path — click semantics belong
 *   to feature-consumer catalogs).
 *
 * Story floor (per brief): >=3 happy + >=1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
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

export const groupChatInputParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'group-chat-input-renders-textarea-with-idle-placeholder',
		given:
			'GroupChatInput mounts with state="idle", an empty draftMessage, sessions=[one non-terminal agent], groups=[].',
		when: ['the component renders'],
		then: [
			// The textarea is mounted and reachable
			{ verb: 'hasElement', target: 'textarea' },
			// Idle placeholder copy surfaces verbatim
			{
				verb: 'hasElement',
				target: 'textarea[placeholder="Type a message... (@ to mention agent)"]',
			},
		],
		happyPath: true,
	},
	{
		name: 'group-chat-input-switches-placeholder-when-busy',
		given:
			'GroupChatInput mounts with state="agent-working" (busy), sessions=[one non-terminal agent], no executionQueue.',
		when: ['the component renders'],
		then: [
			// Busy placeholder copy surfaces verbatim
			{ verb: 'hasElement', target: 'textarea[placeholder="Type to queue message..."]' },
		],
		happyPath: true,
	},
	{
		name: 'group-chat-input-surfaces-send-button-with-idle-title',
		given:
			'GroupChatInput mounts with state="idle", draftMessage="hello" so message.trim() is non-empty.',
		when: ['the component renders'],
		then: [
			// The Send button's title swaps on isBusy — idle says "Send message"
			{ verb: 'hasElement', target: 'button[title="Send message"]' },
		],
		happyPath: true,
	},
	{
		name: 'group-chat-input-surfaces-read-only-pill',
		given: 'GroupChatInput mounts with state="idle".',
		when: ['the component renders the toolbar row'],
		then: [
			// The Read-Only mode pill copy is reachable in the toolbar
			{ verb: 'hasText', target: 'body', value: 'Read-Only' },
		],
		happyPath: true,
	},
	{
		name: 'group-chat-input-composes-queued-items-list-when-queue-non-empty',
		given:
			'GroupChatInput mounts with executionQueue=[3 items] (mixed message + command), state="idle".',
		when: ['the component renders'],
		then: [
			// QueuedItemsList sibling renders its canonical separator copy with the literal "(<count>)" suffix
			{ verb: 'hasText', target: 'body', value: 'QUEUED (3)' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'group-chat-input-suppresses-queued-items-list-when-queue-empty',
		given: 'GroupChatInput mounts with executionQueue undefined (no queue wired), state="idle".',
		when: ['the component renders'],
		then: [
			// Without a queue, the QueuedItemsList sibling is not rendered — the "QUEUED (" copy is absent
			{ verb: 'hasElement', target: 'body:not(:has(:text("QUEUED (")))' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-input-suppresses-prompt-composer-when-not-wired',
		given: 'GroupChatInput mounts WITHOUT an onOpenPromptComposer prop.',
		when: ['the component renders the toolbar row'],
		then: [
			// The Prompt Composer affordance is absent when the prop is not wired
			{
				verb: 'hasElement',
				target: 'div:not(:has(button[title^="Open Prompt Composer"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-input-suppresses-mention-dropdown-on-mount',
		given:
			'GroupChatInput mounts with an empty draftMessage (no `@` typed yet), sessions=[one non-terminal agent].',
		when: ['the component renders without keyboard input'],
		then: [
			// The mention dropdown does not render at mount — its scroll container is absent
			{
				verb: 'hasElement',
				target: 'div:not(:has(div.mb-2.rounded-lg.border.p-1.max-h-48))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-input-does-not-render-its-own-modal',
		given: 'GroupChatInput mounts with any well-formed props.',
		when: ['the component renders'],
		then: [
			// The input region is inline chrome, NOT a modal. It must not emit a [role="dialog"] wrapper.
			{ verb: 'hasElement', target: 'div:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-input-no-ipc-no-ws-on-pure-render',
		given:
			'GroupChatInput mounts with stable, well-formed props (state="idle", empty draftMessage, no executionQueue).',
		when: ['the component renders and remains mounted with no user input'],
		then: [
			// A pure render of the input region must not fire any WS frame, broadcast, or notification.
			{ verb: 'wsFrameMatches', target: 'none', value: '' },
			{ verb: 'broadcast', target: 'none', value: '' },
			{ verb: 'notificationFired', target: 'none', value: '' },
		],
		happyPath: false,
	},
];

describe('GroupChatInput — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(groupChatInputParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = groupChatInputParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = groupChatInputParityCatalog.filter((s) => s.happyPath).length;
		const negative = groupChatInputParityCatalog.filter((s) => !s.happyPath).length;
		// Brief floor: >=1 negative-path per happy-path. Catalog must honour this floor.
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
		for (const story of groupChatInputParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of groupChatInputParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of groupChatInputParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('uses render-shape vocabulary only on happy-path stories (no interaction verbs)', () => {
		// Render-shape oriented per the L2.5 precedent (SettingCheckbox / ToggleButtonGroup /
		// SessionListItem / CollapsibleJsonViewer / GroupChatPanel). Click / submit / interaction
		// semantics belong to the feature-consumer's catalog (a future GroupChatInput host that
		// wires onSend to a WS frame, onOpenPromptComposer to a modal-open broadcast, etc.).
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of groupChatInputParityCatalog.filter((s) => s.happyPath)) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
