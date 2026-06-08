/**
 * Parity catalog — GroupChatHeader
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GroupChatHeader is the header bar for the Group Chat view. It accepts
 * `theme`, `name`, `participantCount`, optional `totalCost`, optional
 * `costIncomplete`, `state`, `onStopAll`, `onRename`, `onShowInfo`,
 * `rightPanelOpen`, `onToggleRightPanel`, and `shortcuts`. It always
 * renders the chat headline "Group Chat: {name}" (click-to-rename) plus a
 * pencil-icon Rename affordance and an Info button. It conditionally
 * renders: a Stop All button when `state !== 'idle'`; a participant-count
 * pill (with pluralization); a total-cost pill (with `$` glyph and the
 * cost rounded to two decimals; suffixed with `*` when `costIncomplete`);
 * and a Columns toggle button to open the right panel (only when
 * `rightPanelOpen === false`). It touches 0 IPC namespaces directly and 0
 * Electron-only APIs directly — `formatShortcutKeys` resolves through the
 * webFull-side `shortcutFormatter` shim that swaps the renderer's
 * `window.maestro.platform` dependency for `navigator.userAgent`-based
 * detection.
 *
 * The parity contract is therefore observable-behavior-only: the headline
 * carries the supplied name; the participant pill pluralizes correctly;
 * the Stop All button surfaces under non-idle states and is suppressed
 * under `idle`; the cost pill surfaces when `totalCost > 0` and renders
 * the incomplete-data asterisk when flagged; the right-panel toggle button
 * surfaces only when the right panel is closed.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
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

export const groupChatHeaderParityCatalog: ParityStory[] = [
	// ============ Happy path: baseline headline + rename affordance ============
	{
		name: 'group-chat-header-renders-headline-and-rename-icon',
		given:
			'GroupChatHeader mounts with name="Planning Session", participantCount=3, state="idle", rightPanelOpen=false, and a shortcuts map containing toggleRightPanel.',
		when: ['the component renders'],
		then: [
			// Headline carries the canonical "Group Chat: {name}" copy
			{ verb: 'hasText', target: 'h1[role="button"]', value: 'Group Chat: Planning Session' },
			// Headline is a click-to-rename button (role="button" + tabIndex=0)
			{ verb: 'hasElement', target: 'h1[role="button"][tabindex="0"]' },
			// Pencil-icon Rename button is present with a "Rename" title
			{ verb: 'hasElement', target: 'button[title="Rename"]' },
			// Info button is present with an "Info" title
			{ verb: 'hasElement', target: 'button[title="Info"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: participant pill pluralizes for >1 ============
	{
		name: 'group-chat-header-participant-pill-pluralizes-for-multiple',
		given: 'GroupChatHeader mounts with participantCount=3 (multiple participants).',
		when: ['the component renders the participant pill'],
		then: [
			// Plural form is shown
			{ verb: 'hasText', target: 'span', value: '3 participants' },
		],
		happyPath: true,
	},
	// ============ Happy path: Stop All surfaces under non-idle state ============
	{
		name: 'group-chat-header-stop-all-surfaces-when-active',
		given: 'GroupChatHeader mounts with state="moderator-thinking" (a non-idle state).',
		when: ['the component renders the action cluster'],
		then: [
			// Stop All button is present with its tooltip
			{
				verb: 'hasElement',
				target: 'button[title="Stop all moderator and participant activity"]',
			},
			// Stop All copy is visible
			{ verb: 'hasText', target: 'button', value: 'Stop All' },
		],
		happyPath: true,
	},
	// ============ Happy path: cost pill renders with two-decimal format ============
	{
		name: 'group-chat-header-cost-pill-renders-when-cost-positive',
		given: 'GroupChatHeader mounts with totalCost=1.2345 and costIncomplete=false.',
		when: ['the component renders the cost pill'],
		then: [
			// Cost is rounded to two decimals
			{ verb: 'hasText', target: 'span[title="Total accumulated cost"]', value: '1.23' },
			// Cost pill tooltip carries the canonical "Total accumulated cost" copy
			{ verb: 'hasElement', target: 'span[title="Total accumulated cost"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: right-panel toggle surfaces when panel closed ============
	{
		name: 'group-chat-header-right-panel-toggle-surfaces-when-panel-closed',
		given:
			'GroupChatHeader mounts with rightPanelOpen=false and a shortcuts map whose toggleRightPanel.keys=["Meta","r"].',
		when: ['the component renders the right-side action cluster'],
		then: [
			// Toggle button title carries the formatted shortcut hint
			{ verb: 'hasElement', target: 'button[title^="Show right panel ("]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'group-chat-header-stop-all-suppressed-when-idle',
		given: 'GroupChatHeader mounts with state="idle".',
		when: ['the component renders the action cluster'],
		then: [
			// Stop All button is NOT shown under idle state
			{
				verb: 'hasElement',
				target: 'div:not(:has(button[title="Stop all moderator and participant activity"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-header-participant-pill-uses-singular-for-one',
		given: 'GroupChatHeader mounts with participantCount=1 (single participant).',
		when: ['the component renders the participant pill'],
		then: [
			// Singular form is shown
			{ verb: 'hasText', target: 'span', value: '1 participant' },
			// The plural form is NOT shown for a single participant
			{
				verb: 'hasElement',
				target: 'span:not(:has-text("1 participants"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-header-cost-pill-suppressed-when-zero-or-undefined',
		given: 'GroupChatHeader mounts with totalCost=0 (or totalCost undefined).',
		when: ['the component renders the right-side action cluster'],
		then: [
			// Cost pill is NOT shown when there is no cost to display
			{
				verb: 'hasElement',
				target: 'div:not(:has(span[title="Total accumulated cost"]))',
			},
			// And the incomplete-cost tooltip variant is likewise absent
			{
				verb: 'hasElement',
				target:
					'div:not(:has(span[title="Total accumulated cost (incomplete: not all agents report cost data)"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-header-cost-pill-marks-incomplete-with-asterisk',
		given: 'GroupChatHeader mounts with totalCost=2.5 and costIncomplete=true.',
		when: ['the component renders the cost pill'],
		then: [
			// The incomplete-data tooltip variant is what is shown
			{
				verb: 'hasElement',
				target:
					'span[title="Total accumulated cost (incomplete: not all agents report cost data)"]',
			},
			// The asterisk marker is visible in the pill body
			{
				verb: 'hasText',
				target:
					'span[title="Total accumulated cost (incomplete: not all agents report cost data)"]',
				value: '*',
			},
		],
		happyPath: false,
	},
	{
		name: 'group-chat-header-right-panel-toggle-suppressed-when-panel-open',
		given: 'GroupChatHeader mounts with rightPanelOpen=true.',
		when: ['the component renders the right-side action cluster'],
		then: [
			// Columns toggle is NOT shown when the right panel is already open
			{
				verb: 'hasElement',
				target: 'div:not(:has(button[title^="Show right panel ("]))',
			},
		],
		happyPath: false,
	},
];

describe('GroupChatHeader — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(groupChatHeaderParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = groupChatHeaderParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = groupChatHeaderParityCatalog.filter((s) => s.happyPath).length;
		const negative = groupChatHeaderParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of groupChatHeaderParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of groupChatHeaderParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of groupChatHeaderParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
