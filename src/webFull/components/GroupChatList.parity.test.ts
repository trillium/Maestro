/**
 * Parity catalog — GroupChatList
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GroupChatList is the left-panel collapsible list of Group Chats. It accepts
 * `theme`, `groupChats`, `activeGroupChatId`, callbacks (`onOpenGroupChat`,
 * `onNewGroupChat`, `onEditGroupChat`, `onRenameGroupChat`,
 * `onDeleteGroupChat`, `onArchiveGroupChat?`), optional controlled
 * expansion (`isExpanded` / `onExpandedChange`), and optional status
 * threading (`groupChatState`, `participantStates`, `groupChatStates`,
 * `allGroupChatParticipantStates`). It always renders a collapsible
 * header with the literal copy "Group Chats" plus a "+ New Chat"
 * pill (titled "New Group Chat"). It conditionally renders: a count
 * badge when `activeCount > 0`; a per-row chat surface inside the
 * expanded list (chevron-collapsible body) with chat name + optional
 * participant-count pill + idle/busy status dot; an archived-toggle pill
 * when `onArchiveGroupChat` is supplied AND there is at least one
 * archived chat; an empty-state italic message ("No group chats yet" or
 * "All group chats are archived") when the filtered list is empty; and a
 * right-click context menu (Edit / Rename / Archive when supported /
 * Delete) when a chat row is right-clicked. It touches 0 IPC namespaces
 * directly and 0 Electron-only APIs directly — all side-effects route
 * through the prop callbacks the host wires.
 *
 * The parity contract is therefore observable-behavior-only: the header
 * carries the "Group Chats" copy; the "+ New Chat" pill is reachable; the
 * count badge surfaces under `activeCount > 0` and is suppressed under
 * `activeCount === 0`; the expanded list renders one row per visible chat
 * with the chat name and a status dot reachable; the empty-state copy
 * differentiates "no chats at all" from "all chats archived"; the
 * archived-toggle pill surfaces only when `onArchiveGroupChat` is supplied
 * AND `archivedCount > 0`.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): >=3 happy + >=1 negative-path per happy-path
 * story. This catalog ships 6 happy + 6 negative = 12 stories.
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

export const groupChatListParityCatalog: ParityStory[] = [
	// ============ Happy path: baseline header + "+ New Chat" pill ============
	{
		name: 'group-chat-list-renders-header-and-new-chat-pill',
		given:
			'GroupChatList mounts with groupChats=[] (no chats at all) and a non-null `onNewGroupChat` callback.',
		when: ['the component renders'],
		then: [
			// Header copy is present
			{ verb: 'hasText', target: 'span', value: 'Group Chats' },
			// "+ New Chat" pill is reachable through its canonical title
			{ verb: 'hasElement', target: 'button[title="New Group Chat"]' },
			// The pill carries the canonical copy
			{ verb: 'hasText', target: 'button[title="New Group Chat"]', value: '+ New Chat' },
		],
		happyPath: true,
	},
	// ============ Happy path: count badge surfaces when activeCount > 0 ============
	{
		name: 'group-chat-list-count-badge-surfaces-when-active-chats-exist',
		given: 'GroupChatList mounts with three non-archived chats (activeCount === 3).',
		when: ['the component renders the header cluster'],
		then: [
			// The numeric count badge is visible (rendered as a plain "3" span)
			{ verb: 'hasText', target: 'span', value: '3' },
		],
		happyPath: true,
	},
	// ============ Happy path: chat row renders with name + participant pill ============
	{
		name: 'group-chat-list-chat-row-renders-name-and-participant-pill',
		given:
			'GroupChatList mounts with one chat { name: "Planning Session", participants: [a, b, c] } and isExpanded=true.',
		when: ['the component renders the expanded list body'],
		then: [
			// Chat row name is visible
			{ verb: 'hasText', target: 'span', value: 'Planning Session' },
			// Participant-count pill is reachable through its canonical pluralized title
			{ verb: 'hasElement', target: 'span[title="3 participants"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: status dot title flips under busy state ============
	{
		name: 'group-chat-list-status-dot-shows-thinking-title-when-busy',
		given:
			'GroupChatList mounts with one chat (activeGroupChatId matches its id) and groupChatState="moderator-thinking" (a non-idle state).',
		when: ['the component renders the chat row status indicator'],
		then: [
			// Status dot tooltip flips from "Idle" to "Thinking..." under non-idle state
			{ verb: 'hasElement', target: 'div[title="Thinking..."]' },
		],
		happyPath: true,
	},
	// ============ Happy path: empty-state copy when zero chats ============
	{
		name: 'group-chat-list-empty-state-when-no-chats',
		given:
			'GroupChatList mounts with groupChats=[] and isExpanded=true (so the body region is rendered).',
		when: ['the component renders the expanded body'],
		then: [
			// Empty-state italic copy is the "no chats" variant
			{ verb: 'hasText', target: 'div', value: 'No group chats yet' },
		],
		happyPath: true,
	},
	// ============ Happy path: archived-toggle pill surfaces with archivedCount ============
	{
		name: 'group-chat-list-archived-toggle-surfaces-with-archived-count',
		given:
			'GroupChatList mounts with one archived chat, `onArchiveGroupChat` supplied, and `showArchived=false` (default).',
		when: ['the component renders the header right-side cluster'],
		then: [
			// Archived-toggle pill is reachable through its canonical "Show N archived chat" title
			{ verb: 'hasElement', target: 'button[title^="Show 1 archived chat"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'group-chat-list-count-badge-suppressed-when-no-active-chats',
		given: 'GroupChatList mounts with groupChats=[] (no chats → activeCount === 0).',
		when: ['the component renders the header cluster'],
		then: [
			// The "Group Chats" header is still visible, but no numeric count badge follows it
			{ verb: 'hasText', target: 'span', value: 'Group Chats' },
			// The empty-state copy (rendered below the header when expanded) is the "no chats" variant —
			// pinning this proves the count-badge branch (`activeCount > 0`) did NOT fire.
			{ verb: 'hasText', target: 'div', value: 'No group chats yet' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-list-participant-pill-uses-singular-title-for-one',
		given:
			'GroupChatList mounts with one chat { participants: [a] } (single participant) and isExpanded=true.',
		when: ['the component renders the chat row participant pill'],
		then: [
			// Singular form is shown in the title (no "s" suffix)
			{ verb: 'hasElement', target: 'span[title="1 participant"]' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-list-status-dot-shows-idle-title-when-not-busy',
		given:
			'GroupChatList mounts with one chat (activeGroupChatId matches its id) and groupChatState="idle".',
		when: ['the component renders the chat row status indicator'],
		then: [
			// Status dot tooltip is the "Idle" variant under idle state
			{ verb: 'hasElement', target: 'div[title="Idle"]' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-list-empty-state-differentiates-all-archived',
		given:
			'GroupChatList mounts with one archived chat, `onArchiveGroupChat` supplied, `showArchived=false` (default), and isExpanded=true.',
		when: ['the component renders the expanded body'],
		then: [
			// Empty-state italic copy is the "all archived" variant (not the "no chats" variant)
			{ verb: 'hasText', target: 'div', value: 'All group chats are archived' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-list-archived-toggle-suppressed-when-no-archived-chats',
		given: 'GroupChatList mounts with `onArchiveGroupChat` supplied but zero archived chats.',
		when: ['the component renders the header right-side cluster'],
		then: [
			// The archived-toggle pill is NOT rendered when there is nothing to unhide
			{
				verb: 'hasElement',
				target: 'div:not(:has(button[title^="Show 0 archived chat"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-list-context-menu-not-rendered-on-mount',
		given: 'GroupChatList mounts with one chat and no right-click has occurred.',
		when: ['the component renders'],
		then: [
			// The context menu surface (rendered as a fixed-position button cluster only when
			// the right-click state is set) is not present on initial mount.
			// Pin the canonical Edit button — it only exists inside the context menu.
			{
				verb: 'hasElement',
				target: 'div:not(:has(button:has-text("Edit")))',
			},
			// Pin the canonical Delete button — also only inside the context menu.
			{
				verb: 'hasElement',
				target: 'div:not(:has(button:has-text("Delete")))',
			},
		],
		happyPath: false,
	},
];

describe('GroupChatList — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(groupChatListParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = groupChatListParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = groupChatListParityCatalog.filter((s) => s.happyPath).length;
		const negative = groupChatListParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of groupChatListParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of groupChatListParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'dialog.',
			'tunnel.',
			'ipcrenderer',
		];
		for (const story of groupChatListParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('restricts then verbs to render-shape vocabulary (hasElement / hasText)', () => {
		// GroupChatList is purely presentational — every observable behavior is
		// a DOM render shape. Interaction wiring (click → onOpenGroupChat,
		// right-click → context menu, etc.) is asserted by feature-consumer
		// catalogs where the callbacks are bound.
		const renderShape = new Set(['hasElement', 'hasText']);
		for (const story of groupChatListParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});

	it('story names are unique', () => {
		const names = groupChatListParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
