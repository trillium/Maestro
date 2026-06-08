/**
 * Parity catalog — GroupChatMessages
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GroupChatMessages is the message-history scrollback view for a Group Chat.
 * It accepts `theme`, `messages`, `participants`, `state`, optional
 * `markdownEditMode` / `onToggleMarkdownEditMode`, optional `maxOutputLines`,
 * and optional pre-computed `participantColors`. It renders an empty-state
 * Beta callout when there are no messages; otherwise it renders each message
 * as a bubble with the timestamp outside the bubble (AI-Terminal pattern),
 * a sender label for non-user messages (Moderator / System / agent name),
 * markdown content (or raw text in `markdownEditMode` and for user messages),
 * collapse/expand affordance for non-user / non-system messages over
 * `maxOutputLines` lines, copy-to-clipboard and markdown-mode toggle buttons
 * on hover, and a typing indicator when `state !== 'idle'`. It also exposes
 * a `scrollToMessage(timestamp)` imperative handle via ref. It touches 0 IPC
 * namespaces directly and 0 Electron-only APIs directly — clipboard writes
 * route through the renderer's `safeClipboardWrite` (text-only, browser
 * `navigator.clipboard.writeText` path; the image variant is not invoked
 * from this view), markdown rendering routes through the renderer's
 * `MarkdownRenderer` (image-IPC and link-open-external paths are not
 * exercised by chat text content), and `formatShortcutKeys` resolves
 * through the webFull-side `shortcutFormatter` shim that already swaps
 * `window.maestro.platform` for `navigator.userAgent`-based detection.
 *
 * The parity contract is therefore observable-behavior-only: the empty state
 * shows the Beta badge and the two explanatory paragraphs; non-empty state
 * renders timestamps + sender labels + content; the typing indicator shows
 * the right copy for `moderator-thinking` vs `agent-working`; and the
 * action-button affordances (copy, markdown toggle) are visible for non-user
 * messages but suppressed for user messages.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
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

export const groupChatMessagesParityCatalog: ParityStory[] = [
	// ============ Happy path: empty state ============
	{
		name: 'group-chat-messages-empty-state-shows-beta-badge-and-explanation',
		given:
			'GroupChatMessages mounts with messages=[] and participants=[] (a brand-new Group Chat).',
		when: ['the component renders'],
		then: [
			// The scrollback container is present so the empty-state copy can sit inside it
			{ verb: 'hasElement', target: '.group-chat-messages' },
			// Beta badge surfaces the experimental nature of the feature
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Beta' },
			// The explanatory copy about Moderator orchestration is visible
			{
				verb: 'hasText',
				target: '.group-chat-messages',
				value: 'Messages you send go directly to the',
			},
			{ verb: 'hasText', target: '.group-chat-messages', value: 'moderator' },
			// The @agent tip is visible
			{
				verb: 'hasText',
				target: '.group-chat-messages',
				value: 'to message a specific agent directly',
			},
		],
		happyPath: true,
	},
	// ============ Happy path: user message renders without sender label ============
	{
		name: 'group-chat-messages-renders-user-message-content-without-sender-label',
		given:
			'GroupChatMessages mounts with a single user message {from:"user", content:"Hi team", timestamp:<recent ISO>}.',
		when: ['the component renders the messages list'],
		then: [
			// The user's message content is visible
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Hi team' },
			// The bubble carries the data-message-timestamp attribute used by scrollToMessage
			{ verb: 'hasElement', target: '.group-chat-messages [data-message-timestamp]' },
		],
		happyPath: true,
	},
	// ============ Happy path: moderator message labels + markdown rendering ============
	{
		name: 'group-chat-messages-renders-moderator-message-with-moderator-label',
		given:
			'GroupChatMessages mounts with a moderator message {from:"moderator", content:"Routing to Alice", timestamp:<recent ISO>}.',
		when: ['the component renders the messages list'],
		then: [
			// Sender label says "Moderator" (capitalized — matches color-map key)
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Moderator' },
			// Routed-to content is visible
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Routing to Alice' },
		],
		happyPath: true,
	},
	// ============ Happy path: system message uses System label ============
	{
		name: 'group-chat-messages-renders-system-message-with-system-label',
		given:
			'GroupChatMessages mounts with a system message {from:"system", content:"Connection lost", timestamp:<recent ISO>}.',
		when: ['the component renders the messages list'],
		then: [
			// Sender label says "System"
			{ verb: 'hasText', target: '.group-chat-messages', value: 'System' },
			// System message content is visible
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Connection lost' },
		],
		happyPath: true,
	},
	// ============ Happy path: typing indicator surfaces moderator-thinking copy ============
	{
		name: 'group-chat-messages-shows-moderator-thinking-typing-indicator',
		given: 'GroupChatMessages mounts with at least one message and state="moderator-thinking".',
		when: ['the component renders the typing indicator row'],
		then: [
			// The moderator-thinking copy is visible
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Moderator is thinking...' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'group-chat-messages-empty-state-suppresses-typing-indicator-when-idle',
		given: 'GroupChatMessages mounts with messages=[] and state="idle".',
		when: ['the component renders'],
		then: [
			// No typing indicator copy is shown when idle
			{
				verb: 'hasElement',
				target: '.group-chat-messages:not(:has-text("Moderator is thinking..."))',
			},
			{
				verb: 'hasElement',
				target: '.group-chat-messages:not(:has-text("Agent is working..."))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-messages-user-message-does-not-render-sender-label',
		given:
			'GroupChatMessages mounts with a single user message {from:"user", content:"Hi team"} and at least one participant named "Alice".',
		when: ['the component renders the user message bubble'],
		then: [
			// The literal "Alice" sender label is NOT shown for the user's own message
			// (user messages render without the sender-label row)
			{
				verb: 'hasElement',
				target: '.group-chat-messages [data-message-timestamp]:not(:has-text("Alice"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-messages-user-message-does-not-show-copy-or-markdown-toggle-buttons',
		given:
			'GroupChatMessages mounts with a single user message {from:"user", content:"Hi team"} and onToggleMarkdownEditMode is provided.',
		when: ['the user hovers the user message bubble'],
		then: [
			// User messages don't get the action button cluster — only non-user messages do
			{
				verb: 'hasElement',
				target:
					'.group-chat-messages [data-message-timestamp]:not(:has([title="Copy to clipboard"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-messages-state-agent-working-does-not-show-moderator-thinking-copy',
		given: 'GroupChatMessages mounts with at least one message and state="agent-working".',
		when: ['the component renders the typing indicator row'],
		then: [
			// The agent-working copy is the one shown
			{ verb: 'hasText', target: '.group-chat-messages', value: 'Agent is working...' },
			// The moderator-thinking copy is NOT shown in this state
			{
				verb: 'hasElement',
				target: '.group-chat-messages:not(:has-text("Moderator is thinking..."))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-messages-short-message-does-not-show-show-all-collapse-affordance',
		given:
			'GroupChatMessages mounts with a single moderator message whose content is 5 lines long and maxOutputLines=30 (the default).',
		when: ['the component renders the messages list'],
		then: [
			// Below-threshold messages render in full without the "Show all" collapse button
			{
				verb: 'hasElement',
				target: '.group-chat-messages:not(:has-text("Show all"))',
			},
			{
				verb: 'hasElement',
				target: '.group-chat-messages:not(:has-text("Show less"))',
			},
		],
		happyPath: false,
	},
];

describe('GroupChatMessages — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(groupChatMessagesParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = groupChatMessagesParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = groupChatMessagesParityCatalog.filter((s) => s.happyPath).length;
		const negative = groupChatMessagesParityCatalog.filter((s) => !s.happyPath).length;
		// Brief floor: ≥1 negative-path per happy-path. Catalog must honour this floor.
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
		for (const story of groupChatMessagesParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of groupChatMessagesParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of groupChatMessagesParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
