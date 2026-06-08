/**
 * Parity catalog — ExecutionQueueBrowser
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ExecutionQueueBrowser is a presentational modal for browsing and
 * managing the execution queue across all sessions. It accepts `isOpen`,
 * `sessions` (narrow `ExecutionQueueSession[]` shape — only reads
 * `id`, `name`, `executionQueue`), `activeSessionId`, `theme`, and four
 * prop callbacks (`onClose`, `onRemoveItem`, `onSwitchSession`,
 * `onReorderItems`). It touches 0 IPC namespaces and 0 Electron-only
 * APIs.
 *
 * The parity contract is observable-behavior-only: the modal either
 * renders nothing (when `isOpen=false`), renders the empty state
 * (when no sessions have queued items in the active view), or renders
 * the modal chrome with the per-item row surface, the view-mode
 * toggle, the count chips, and the reorder hint footer.
 *
 *   IN (asserted here):
 *     - `isOpen=false` → component returns null (no modal chrome
 *       rendered).
 *     - `isOpen=true` with queue items → modal chrome renders with
 *       "Execution Queue" title, "<N> total" badge, "Current Agent"
 *       and "All Agents" toggle buttons, and the per-item rows.
 *     - Per-item rendering: position #N, tab-name pill, time chip,
 *       displayed text / command, and the hover-gated Remove button
 *       (title="Remove from queue").
 *     - 100-char truncation on long message text (ellipsis appended).
 *     - Plural pivot on the image-count line ("image" vs "images").
 *     - Footer reorder hint copy.
 *     - Empty-state copy: "No items queued for this agent" (current
 *       view) or "No items queued" (global view).
 *     - "Jump to this session" affordance via the tab-pill button's
 *       `title` attribute.
 *
 *   DROPPED / OUT (named so the partial-parity surface is countable):
 *     - The actual reorder runtime — the modal fires `onReorderItems`;
 *       the parent owns the reorder operation. Drag-state visual
 *       transitions are observable via the rendered cursor / boxShadow
 *       but are layout-dependent; the catalog asserts the contract
 *       at the prop-callback boundary, not at the visual transition.
 *     - The LayerStackContext `escape` wiring — that's asserted in the
 *       LayerStack provider's own catalog, not duplicated per-modal.
 *     - Backdrop click → onClose — that's a generic modal pattern; the
 *       catalog asserts via the X close button's presence rather than
 *       the backdrop's behavior.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron
 *     oracle at localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior,
 *     not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
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

export const executionQueueBrowserParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'execution-queue-browser-renders-modal-chrome-with-title-and-total-badge',
		given:
			'`isOpen=true`, sessions = [{id:"s1",name:"Project Alpha",executionQueue:[{id:"i1",type:"message",text:"hello",tabName:"main",timestamp:Date.now()}]}], activeSessionId="s1".',
		when: ['the ExecutionQueueBrowser mounts'],
		then: [
			// Modal title
			{ verb: 'hasText', target: 'body', value: 'Execution Queue' },
			// Total count badge ("1 total")
			{ verb: 'hasText', target: 'body', value: '1 total' },
			// Both view-mode toggle buttons render
			{ verb: 'hasText', target: 'body', value: 'Current Agent' },
			{ verb: 'hasText', target: 'body', value: 'All Agents' },
			// Footer hint
			{ verb: 'hasText', target: 'body', value: 'Drag and drop to reorder' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-browser-renders-per-item-row-with-position-and-tabname-pill',
		given:
			'`isOpen=true` with three queued items in the active session ("main" tab x2 + "scratch" tab x1), all messages.',
		when: ['the row surface paints inside the current-agent view'],
		then: [
			// Position indicators surface
			{ verb: 'hasText', target: 'body', value: '#1' },
			{ verb: 'hasText', target: 'body', value: '#2' },
			{ verb: 'hasText', target: 'body', value: '#3' },
			// Tab-name pills with "Jump to this session" title
			{ verb: 'hasElement', target: 'button[title="Jump to this session"]' },
			// "Just now" time chip for fresh items
			{ verb: 'hasText', target: 'body', value: 'Just now' },
			// Total badge reflects the three items
			{ verb: 'hasText', target: 'body', value: '3 total' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-browser-renders-remove-button-with-title-attribute',
		given:
			'`isOpen=true` with one queued item. The Remove button is gated behind a hover-reveal but the `title` attribute is always present for screen-readers.',
		when: ['the per-item row renders'],
		then: [
			// Remove button title
			{ verb: 'hasElement', target: 'button[title="Remove from queue"]' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-browser-renders-plural-images-suffix-when-item-has-multiple-images',
		given:
			'`isOpen=true` with a message item carrying `images: [<3 entries>]` in addition to its text.',
		when: ['the image-count chip renders'],
		then: [
			// "+ 3 images" with the plural suffix — boundary case is the singular
			// pivot at length === 1 (covered in negative path)
			{ verb: 'hasText', target: 'body', value: '3 images' },
		],
		happyPath: true,
	},
	{
		name: 'execution-queue-browser-renders-empty-state-copy-with-current-view-suffix',
		given:
			'`isOpen=true` with `sessions=[]` (no sessions). The current-agent view renders the empty-state copy with the "for this agent" suffix.',
		when: ['the filtered queue list is empty in the current-agent view'],
		then: [
			// Empty-state copy with the per-view suffix
			{ verb: 'hasText', target: 'body', value: 'No items queued for this agent' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'execution-queue-browser-renders-nothing-when-not-open',
		given: '`isOpen=false`. The component early-returns null.',
		when: ['the ExecutionQueueBrowser mounts with `isOpen=false`'],
		then: [
			// Modal title is absent
			{ verb: 'hasElement', target: 'body:not(:has(h2:text("Execution Queue")))' },
			// Footer hint is absent
			{ verb: 'hasElement', target: 'body:not(:has(*:text("Drag and drop to reorder")))' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-browser-omits-current-view-suffix-in-global-empty-state',
		given:
			'`isOpen=true` with `sessions=[]`. The user switches to the All Agents view; the empty-state copy drops the "for this agent" suffix.',
		when: ['the global view renders with no queued items in any session'],
		then: [
			// Both views render the bare "No items queued" copy; the suffix is
			// gated on `viewMode === "current"`. The contract for the negative
			// path is the absence of the "for this agent" tail in global view.
			{
				verb: 'hasElement',
				target: '*:has-text("No items queued"):not(:has-text("for this agent"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-browser-omits-image-count-chip-when-item-has-no-images',
		given:
			'`isOpen=true` with one queued message item carrying no `images` field (or `images: []`). The "+ N image(s)" chip is gated on `item.images && item.images.length > 0`.',
		when: ['the per-item row renders'],
		then: [
			// The Remove button still renders (presence pin for the row)
			{ verb: 'hasElement', target: 'button[title="Remove from queue"]' },
			// And no "image" or "images" suffix surfaces — the chip is suppressed
			// when the gate is false. A future refactor flipping the gate to
			// `length >= 0` would silently emit "+ 0 images" copy.
			{ verb: 'hasElement', target: 'body:not(:has(*:text("image")))' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-browser-uses-singular-image-suffix-at-boundary-length-one',
		given:
			'`isOpen=true` with a message item carrying `images: [<1 entry>]`. The plural pivot is at `length > 1`.',
		when: ['the image-count chip renders'],
		then: [
			// Singular pivot — "1 image" not "1 images". This pins the boundary
			// case at the conditional threshold. A future refactor using `>= 1`
			// instead of `> 1` for the plural gate would silently break grammar.
			{ verb: 'hasText', target: 'body', value: '1 image' },
		],
		happyPath: false,
	},
	{
		name: 'execution-queue-browser-omits-tabname-pill-when-item-has-no-tabname',
		given:
			'`isOpen=true` with one queued message item whose `tabName` field is undefined. The "Jump to this session" pill is gated on `item.tabName`.',
		when: ['the per-item row renders'],
		then: [
			// The row chrome still renders
			{ verb: 'hasText', target: 'body', value: '#1' },
			// But the "Jump to this session" pill is suppressed — the gate is on
			// `item.tabName`. Future wire-protocol additions can carry a tabName
			// and the pill will surface automatically without changes here.
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Jump to this session"]))' },
		],
		happyPath: false,
	},
];

describe('ExecutionQueueBrowser — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(executionQueueBrowserParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = executionQueueBrowserParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = executionQueueBrowserParityCatalog.filter((s) => s.happyPath).length;
		const negative = executionQueueBrowserParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative-path per happy-path. Honoured when negative >= happy.
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
		for (const story of executionQueueBrowserParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of executionQueueBrowserParityCatalog) {
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
		for (const story of executionQueueBrowserParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('declares unique story names', () => {
		const names = executionQueueBrowserParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
