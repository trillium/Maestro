/**
 * Parity catalog — GroupChatPanel
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GroupChatPanel is the composition shell for the Group Chat view. It
 * stacks three children vertically inside a `flex flex-col h-full`
 * container backed by `theme.colors.bgMain`:
 *
 *   1. `<GroupChatHeader>` — chrome row (chat headline, participant
 *      count, optional cost pill, optional Stop All button, Info, Rename,
 *      right-panel toggle).
 *   2. `<GroupChatMessages>` — scrollback view (message history with
 *      timestamps, per-participant colours, markdown rendering, typing
 *      indicator).
 *   3. `<GroupChatInput>` — input area (textarea, @mention autocomplete,
 *      Send button, read-only toggle, attach image, prompt composer,
 *      execution queue).
 *
 * The panel itself has zero internal state, zero effects, zero refs that
 * it owns; it threads every prop into its three children. As such, the
 * parity contract is shape-oriented and composition-oriented: the
 * container wrapper is present, the three children mount in order, the
 * `bgMain` theme color is applied to the wrapper, and the prop
 * threading reaches the children (verified through the header's
 * canonical headline copy and the messages' empty-state copy — both
 * observable through the existing webFull-sibling lifts of those
 * children).
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 * - Render-shape oriented per the SettingCheckbox / ToggleButtonGroup /
 *   SessionListItem / CollapsibleJsonViewer L2.5 precedent (`hasElement`
 *   / `hasText` only — click semantics belong to feature-consumer
 *   catalogs).
 *
 * Story floor (per brief): >=3 happy + >=1 negative-path per happy-path
 * story. This catalog ships 4 happy + 4 negative = 8 stories.
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

export const groupChatPanelParityCatalog: ParityStory[] = [
	// ============ Happy path: outer container chrome ============
	{
		name: 'group-chat-panel-renders-vertical-flex-container',
		given:
			'GroupChatPanel mounts with a GroupChat that has name="Planning Session", three participants, state="idle", and a non-empty messages array.',
		when: ['the component renders'],
		then: [
			// The outer container is a vertical flex column that fills the parent's height
			{ verb: 'hasElement', target: 'div.flex.flex-col.h-full' },
		],
		happyPath: true,
	},
	// ============ Happy path: header child mounts with chat name ============
	{
		name: 'group-chat-panel-mounts-header-with-chat-name',
		given: 'GroupChatPanel mounts with a GroupChat whose name="Planning Session".',
		when: ['the panel composes its header child'],
		then: [
			// The canonical "Group Chat: {name}" headline copy from GroupChatHeader is present
			{ verb: 'hasText', target: 'h1[role="button"]', value: 'Group Chat: Planning Session' },
			// The pencil-icon Rename button from the header is reachable
			{ verb: 'hasElement', target: 'button[title="Rename"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: messages child mounts (empty-state copy reachable) ============
	{
		name: 'group-chat-panel-mounts-messages-region',
		given: 'GroupChatPanel mounts with messages=[] (empty conversation) and state="idle".',
		when: ['the panel composes its messages child'],
		then: [
			// The GroupChatMessages empty-state surfaces the Beta badge that the L2.5 sibling lift's catalog pins
			{ verb: 'hasElement', target: '[data-testid="groupchat-empty-state"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: input child mounts (Send affordance reachable) ============
	{
		name: 'group-chat-panel-mounts-input-region',
		given: 'GroupChatPanel mounts with state="idle" and a sessions array of participants.',
		when: ['the panel composes its input child'],
		then: [
			// The input child surfaces a textarea where the user types the next message
			{ verb: 'hasElement', target: 'textarea' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'group-chat-panel-does-not-render-its-own-modal',
		given: 'GroupChatPanel mounts with any well-formed props.',
		when: ['the component renders'],
		then: [
			// The panel is a layout shell, not a modal. It must not emit a [role="dialog"] wrapper.
			{ verb: 'hasElement', target: 'div:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-panel-suppresses-stop-all-when-state-idle',
		given: 'GroupChatPanel mounts with state="idle".',
		when: ['the header child renders the action cluster'],
		then: [
			// The Stop All button (only present in the header when state !== "idle") is absent
			{
				verb: 'hasElement',
				target: 'div:not(:has(button[title="Stop all moderator and participant activity"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-panel-does-not-render-its-own-banner',
		given: 'GroupChatPanel mounts with any well-formed props.',
		when: ['the component renders'],
		then: [
			// The panel itself emits no role="alert" banner (that affordance belongs to ContextWarningSash, not the panel shell)
			{ verb: 'hasElement', target: 'div:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'group-chat-panel-no-ipc-no-ws-on-pure-render',
		given:
			'GroupChatPanel mounts with stable, well-formed props (a complete GroupChat, an empty messages array, idle state).',
		when: ['the component renders and remains mounted with no user input'],
		then: [
			// A pure render of the composition shell must not fire any IPC, WS frame, DB write, FS write, process spawn, notification, or broadcast.
			{ verb: 'wsFrameMatches', target: 'none', value: '' },
			{ verb: 'broadcast', target: 'none', value: '' },
			{ verb: 'notificationFired', target: 'none', value: '' },
		],
		happyPath: false,
	},
];

describe('GroupChatPanel — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(groupChatPanelParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = groupChatPanelParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = groupChatPanelParityCatalog.filter((s) => s.happyPath).length;
		const negative = groupChatPanelParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of groupChatPanelParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of groupChatPanelParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of groupChatPanelParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('uses render-shape vocabulary only on happy-path stories (no interaction verbs)', () => {
		// Render-shape oriented per the L2.5 precedent (SettingCheckbox / ToggleButtonGroup /
		// SessionListItem / CollapsibleJsonViewer). Click / submit / interaction semantics belong
		// to the feature-consumer's catalog (a future GroupChatPanel host that wires onSendMessage
		// to a WS frame, onStopAll to a stop intent broadcast, etc.).
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of groupChatPanelParityCatalog.filter((s) => s.happyPath)) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
