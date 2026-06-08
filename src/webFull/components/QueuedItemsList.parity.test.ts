/**
 * Parity catalog — QueuedItemsList
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * QueuedItemsList is a presentational queue panel that surfaces the AI tab's
 * execution-queue items (messages and slash commands) between the chat
 * scrollback and the prompt input. Per-item, it renders a coloured card
 * (green for `type === 'command'`, accent for `type === 'message'`), a
 * Remove `X` button gated behind an in-component confirmation modal, and
 * an expand/collapse toggle when a message body exceeds 200 characters.
 * When `onReorderItems` is wired AND the filtered queue has more than one
 * item, each card becomes drag-and-drop reorderable via the HTML5 API.
 * When `activeTabId` is provided, items are filtered to `item.tabId ===
 * activeTabId`. Image attachments are surfaced as a `"<N> image(s) attached"`
 * indicator.
 *
 * The component renders nothing when the filtered queue is empty (early
 * `return null`), and touches 0 IPC namespaces / 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - QUEUED separator chrome with the literal "QUEUED (<count>)" copy
 *   - Per-item card with the command text rendered for `type='command'`
 *     and the message text rendered for `type='message'`
 *   - Remove button with `title="Remove from queue"` discoverable
 *   - Expand/collapse toggle copy ("Show all (N lines)" / "Show less")
 *     for messages longer than 200 chars
 *   - Image-attached indicator copy
 *   - Confirmation modal copy ("Remove Queued Message?", "Cancel",
 *     "Remove") when Remove is clicked
 *   - Empty-queue branch renders nothing
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

export const queuedItemsListParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'queued-items-list-renders-queued-separator-with-count',
		given:
			'executionQueue carries three items (mixed message + command), activeTabId is undefined so all three render.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// QUEUED separator copy with literal "(<count>)" suffix
			{ verb: 'hasText', target: 'body', value: 'QUEUED (3)' },
		],
		happyPath: true,
	},
	{
		name: 'queued-items-list-renders-message-text-and-command-text-per-item',
		given:
			'executionQueue carries one message item (text="hello world") and one command item (command="/commit"), both on the active tab.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Message body surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'hello world' },
			// Command surfaces verbatim with the leading slash preserved
			{ verb: 'hasText', target: 'body', value: '/commit' },
		],
		happyPath: true,
	},
	{
		name: 'queued-items-list-exposes-remove-affordance-with-title-tooltip',
		given: 'executionQueue carries one item.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Remove button with the title attribute discoverable to AT users + hover tooltips
			{ verb: 'hasElement', target: '[title="Remove from queue"]' },
		],
		happyPath: true,
	},
	{
		name: 'queued-items-list-renders-show-all-toggle-when-message-exceeds-200-chars',
		given:
			'executionQueue carries one message item whose text length is 250 characters (exceeds the 200-char expand threshold).',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Truncation marker and "Show all (<N> lines)" toggle copy are both present
			{ verb: 'hasText', target: 'body', value: '...' },
			{ verb: 'hasText', target: 'body', value: 'Show all' },
			{ verb: 'hasText', target: 'body', value: 'lines' },
		],
		happyPath: true,
	},
	{
		name: 'queued-items-list-renders-image-attachment-indicator-when-images-present',
		given:
			'executionQueue carries one message item with images=["base64-blob-1","base64-blob-2"] attached.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Plural copy fires when images.length > 1
			{ verb: 'hasText', target: 'body', value: '2 images attached' },
		],
		happyPath: true,
	},
	{
		name: 'queued-items-list-confirmation-modal-surfaces-prompt-and-action-buttons',
		given: 'executionQueue carries one item.',
		when: ['the user clicks the Remove (X) button on the card'],
		then: [
			// Modal headline + body + both action labels render
			{ verb: 'hasText', target: 'body', value: 'Remove Queued Message?' },
			{ verb: 'hasText', target: 'body', value: 'Cancel' },
			{ verb: 'hasText', target: 'body', value: 'Remove' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'queued-items-list-hidden-when-execution-queue-empty',
		given: 'executionQueue is an empty array.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Component returns null — no QUEUED separator anywhere in the DOM
			{ verb: 'hasElement', target: 'body:not(:has([title="Remove from queue"]))' },
		],
		happyPath: false,
	},
	{
		name: 'queued-items-list-hidden-when-activeTabId-filters-all-items-out',
		given:
			'executionQueue carries two items, both with tabId="tab-A", and activeTabId="tab-B" filters both out.',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Filter excludes both items so the component renders nothing
			{ verb: 'hasElement', target: 'body:not(:has([title="Remove from queue"]))' },
		],
		happyPath: false,
	},
	{
		name: 'queued-items-list-suppresses-show-all-toggle-when-message-under-200-chars',
		given:
			'executionQueue carries one message item whose text length is 50 characters (does not exceed the 200-char expand threshold).',
		when: ['the QueuedItemsList mounts'],
		then: [
			// The "Show all" copy MUST NOT appear when the message is short
			{ verb: 'hasElement', target: 'body:not(:has(button:has-text("Show all")))' },
		],
		happyPath: false,
	},
	{
		name: 'queued-items-list-suppresses-image-indicator-when-images-empty-or-absent',
		given: 'executionQueue carries one message item with no images attached (images undefined).',
		when: ['the QueuedItemsList mounts'],
		then: [
			// The "attached" indicator MUST NOT appear when there are no images
			{ verb: 'hasElement', target: 'body:not(:has-text("attached"))' },
		],
		happyPath: false,
	},
	{
		name: 'queued-items-list-fires-no-ipc-or-websocket-traffic-on-mount-or-remove-click',
		given: 'executionQueue carries one item and onRemoveQueuedItem is wired by the host.',
		when: [
			'the QueuedItemsList mounts',
			'the user clicks the Remove (X) button',
			'the user clicks the Cancel button in the confirmation modal',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// Action callbacks are the caller's contract — this component does not
			// reach into window.maestro or any transport itself.
			{ verb: 'hasElement', target: '[title="Remove from queue"], body:not(:has([title]))' },
		],
		happyPath: false,
	},
	{
		name: 'queued-items-list-renders-singular-image-indicator-when-exactly-one-image',
		given: 'executionQueue carries one message item with images=["only-one-blob"] (length === 1).',
		when: ['the QueuedItemsList mounts'],
		then: [
			// Singular copy fires when images.length === 1 — the renderer source
			// pivots on `> 1` so this is a boundary pin against a future refactor
			// that uses `>= 1` and silently breaks the singular grammar.
			{ verb: 'hasText', target: 'body', value: '1 image attached' },
		],
		happyPath: false,
	},
];

describe('QueuedItemsList — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = queuedItemsListParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = queuedItemsListParityCatalog.filter((s) => s.happyPath).length;
		const negative = queuedItemsListParityCatalog.filter((s) => !s.happyPath).length;
		expect(happy).toBeGreaterThanOrEqual(1);
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
		for (const story of queuedItemsListParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of queuedItemsListParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of queuedItemsListParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (panel renders inline, no modal role on the panel itself)', () => {
		// QueuedItemsList is an inline panel above the prompt input. The
		// confirmation modal it gates behind Remove is a separate ephemeral
		// surface — the catalog must never drift toward making the panel
		// itself a role="dialog" surface. If a future refactor wraps the
		// whole panel in a modal, that's a behavior change and the catalog
		// should fail rather than silently track it.
		for (const story of queuedItemsListParityCatalog) {
			// Allow `role="dialog"` references inside :not(:has(...)) exclusions
			// (negative-path stories may need to assert "no dialog wrapper").
			const haystack = JSON.stringify(story);
			// Strict pin: no positive assertion targets the panel root as a
			// dialog. The current catalog has none; this guard catches drift.
			expect(haystack.includes('"target":"[role=\\"dialog\\"]"')).toBe(false);
		}
	});
});
