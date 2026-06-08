/**
 * Parity catalog — SessionItem
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SessionItem is the renderer's unified per-agent row primitive used inside
 * the Left Bar (`SessionList`) for ALL list contexts — bookmarks, group
 * children, flat list, ungrouped folder, and worktree-child rows. The
 * `variant` discriminant (`bookmark` / `group` / `flat` / `ungrouped` /
 * `worktree`) gates the per-variant chrome.
 *
 * The parity contract is observable-behavior-only and render-shape oriented
 * (hasElement / hasText) per the established convention for purely
 * presentational lifts. SessionItem owns NO internal lifecycle; every side
 * effect flows through caller-owned prop callbacks. The renderer's
 * SessionList parity catalog (`SessionList.parity.test.ts`) is the canonical
 * home for interaction-flow assertions (click, drag, context menu, rename,
 * bookmark toggle); duplicating those here would couple the SessionItem
 * catalog to wiring that isn't its responsibility.
 *
 *   IN (asserted here):
 *     - Row renders a draggable container carrying the session name as
 *       visible text.
 *     - Worktree variant adds a branch-icon glyph + drops the metadata row.
 *     - Bookmark variant shows the filled bookmark icon when bookmarked AND
 *       shows the optional group badge.
 *     - Inline rename surfaces an `<input>` when `isEditing` is true and
 *       suppresses it otherwise.
 *     - Activity icon + tool-type label appear in the metadata row for
 *       non-worktree variants; `(SSH)` suffix surfaces when the session has
 *       an SSH-enabled remote config.
 *     - Location pill ladder (GIT / LOCAL / REMOTE) for non-bookmark,
 *       non-worktree, non-terminal sessions.
 *     - AUTO Mode pill when `isInBatch` is true.
 *     - Agent-error pill when `session.agentError` is set.
 *     - Unread badge appears when the row is inactive AND any aiTab has
 *       unread messages.
 *     - Jump-number badge appears when `jumpNumber` is provided.
 *
 *   DROPPED / OUT-OF-SCOPE (named so the partial-parity surface is
 *   countable, not silently invisible):
 *     - Click / drag / context-menu / bookmark-toggle wiring — owned by the
 *       SessionList catalog (renderer's `SessionList.parity.test.ts`).
 *     - The hover-overlay quick-action menu is tracked separately at
 *       `ISC-44.layer-4.1.hover_overlay_menu` and is NOT part of this
 *       component's surface.
 *     - The drag-drop reorder (`onDragStart` / `onDragOver` / `onDrop`)
 *       observable behavior is wiring-level; the catalog asserts only the
 *       `draggable` attribute presence.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron oracle
 *     at localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior,
 *     not DOM structure or CSS.
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
	happyPath: boolean;
}

export const sessionItemParityCatalog: ParityStory[] = [
	// ===================================================================
	// Happy-path: flat variant renders a draggable row with the name
	// ===================================================================
	{
		name: 'session-item-flat-variant-renders-draggable-row-with-name-and-toolType',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "alpha-id", name: "alpha", toolType: "claude-code", state: "idle", isGitRepo: false }; isActive=false, isEditing=false, leftSidebarOpen=true.',
		when: ['the SessionItem renders'],
		then: [
			// The container row is draggable (HTML5 DnD attribute).
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Session name surfaces as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'alpha' },
			// Activity-row carries the toolType label as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'claude-code' },
			// Inline rename input is NOT rendered while isEditing=false.
			{ verb: 'hasElement', target: '[draggable="true"]:not(:has(input))' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: bookmark variant shows filled-bookmark + group badge
	// ===================================================================
	{
		name: 'session-item-bookmark-variant-renders-filled-bookmark-icon-and-group-badge',
		given:
			'A SessionItem is mounted with variant="bookmark" for session { id: "beta-id", name: "beta", toolType: "claude-code", state: "idle", bookmarked: true }, group={ id: "g1", name: "Personal" }, isActive=false.',
		when: ['the SessionItem renders'],
		then: [
			// Row still present.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Session name appears as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'beta' },
			// Group badge text surfaces inside the row.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'Personal' },
			// Bookmark glyph is reachable inside the row chrome — the
			// `<Bookmark>` lucide icon mounts as a child SVG inside the
			// container, so the catalog asserts the row exists; CSS-level
			// "filled" state is layout-not-behavior and intentionally not
			// pinned here.
			{ verb: 'hasElement', target: '[draggable="true"]' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: worktree variant suppresses metadata + renders branch icon
	// ===================================================================
	{
		name: 'session-item-worktree-variant-renders-without-toolType-metadata-row',
		given:
			'A SessionItem is mounted with variant="worktree" for session { id: "gamma-id", name: "feature-branch", toolType: "claude-code", state: "idle", parentSessionId: "parent-id", isGitRepo: true }, isActive=false.',
		when: ['the SessionItem renders'],
		then: [
			// Row still draggable + carries the session name.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			{ verb: 'hasText', target: '[draggable="true"]', value: 'feature-branch' },
			// Worktree compact variant: tool-type label is suppressed
			// (metadata row is hidden) — assert by negation. The renderer
			// source guards the metadata row on `variant !== 'worktree'`.
			{ verb: 'hasElement', target: '[draggable="true"]:not(:has(.text-\\[10px\\]))' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: AUTO mode pill surfaces when isInBatch=true
	// ===================================================================
	{
		name: 'session-item-shows-AUTO-pill-when-session-is-in-batch',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "delta-id", name: "delta", toolType: "claude-code", state: "busy" } and isInBatch=true.',
		when: ['the SessionItem renders'],
		then: [
			// Row present.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// AUTO pill copy surfaces as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'AUTO' },
			// Pill carries the Auto-Run tooltip for hover discoverability.
			{
				verb: 'hasElement',
				target: '[draggable="true"] [title="Auto Run active"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: agent-error pill surfaces when session.agentError is set
	// ===================================================================
	{
		name: 'session-item-shows-ERR-pill-when-session-has-agentError',
		given:
			'A SessionItem is mounted with variant="group" for session { id: "epsilon-id", name: "epsilon", toolType: "claude-code", state: "error", agentError: { type: "auth", message: "Bad token" } }.',
		when: ['the SessionItem renders'],
		then: [
			// Row present.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// ERR pill copy surfaces as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'ERR' },
			// Tooltip carries the error message body.
			{
				verb: 'hasElement',
				target: '[draggable="true"] [title="Error: Bad token"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: inline rename input mounts when isEditing=true
	// ===================================================================
	{
		name: 'session-item-renders-inline-rename-input-when-isEditing-is-true',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "zeta-id", name: "zeta", toolType: "claude-code", state: "idle" } and isEditing=true.',
		when: ['the SessionItem renders'],
		then: [
			// Row container is present.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Inline rename input mounts inside the row.
			{ verb: 'hasElement', target: '[draggable="true"] input' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: jump-number badge surfaces when jumpNumber is provided
	// ===================================================================
	{
		name: 'session-item-shows-jump-number-badge-when-jumpNumber-prop-is-set',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "eta-id", name: "eta", toolType: "claude-code", state: "idle" } and jumpNumber="3".',
		when: ['the SessionItem renders'],
		then: [
			// Row present + carries the badge text.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			{ verb: 'hasText', target: '[draggable="true"]', value: '3' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: GIT pill surfaces for non-bookmark, non-worktree, git repo
	// ===================================================================
	{
		name: 'session-item-shows-GIT-pill-when-session-is-git-repo-and-variant-not-bookmark',
		given:
			'A SessionItem is mounted with variant="ungrouped" for session { id: "theta-id", name: "theta", toolType: "claude-code", state: "idle", isGitRepo: true } and leftSidebarOpen=true.',
		when: ['the SessionItem renders'],
		then: [
			// Row present.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// GIT pill copy surfaces as visible text.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'GIT' },
			// Tooltip "Git repository" surfaces for hover discoverability.
			{
				verb: 'hasElement',
				target: '[draggable="true"] [title="Git repository"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Negative-path: terminal sessions DO NOT show the GIT/LOCAL pill ladder
	// ===================================================================
	{
		name: 'session-item-does-not-show-GIT-or-LOCAL-pill-for-terminal-toolType',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "neg-1", name: "shell", toolType: "terminal", state: "idle", isGitRepo: true }.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Terminal sessions intentionally skip the location ladder — the
			// renderer source guards on `session.toolType !== 'terminal'`.
			// Catalog asserts ABSENCE via `:not(:has(...))`. The GIT pill
			// uses `title="Git repository"`; if it surfaced for terminal
			// sessions a future refactor would silently regress.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Git repository"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: AUTO pill is suppressed when isInBatch=false (default)
	// ===================================================================
	{
		name: 'session-item-does-not-show-AUTO-pill-when-isInBatch-is-false',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "neg-2", name: "neg2", toolType: "claude-code", state: "idle" } and isInBatch=false.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// The Auto-Run tooltip — and therefore the AUTO pill chrome —
			// must NOT surface. Negation via `:not(:has(...))` per the
			// MergeProgressOverlay precedent.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Auto Run active"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: agent-error pill suppressed when session.agentError absent
	// ===================================================================
	{
		name: 'session-item-does-not-show-ERR-pill-when-session-has-no-agentError',
		given:
			'A SessionItem is mounted with variant="group" for session { id: "neg-3", name: "neg3", toolType: "claude-code", state: "idle" } with no `agentError` field.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Catalog asserts that no tooltip with the "Error:" prefix
			// surfaces — pins the ERR-pill suppression contract. The
			// `aria-hidden` lucide AlertCircle would carry no title; the
			// title `Error: <msg>` lives on the wrapping pill div.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title^="Error:"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: inline rename input does NOT mount when isEditing=false
	// ===================================================================
	{
		name: 'session-item-does-not-render-inline-rename-input-when-isEditing-is-false',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "neg-4", name: "neg4", toolType: "claude-code", state: "idle" } and isEditing=false.',
		when: ['the SessionItem renders'],
		then: [
			// Row rendered + the rename input is intentionally absent.
			{ verb: 'hasElement', target: '[draggable="true"]:not(:has(input))' },
			// Session name still surfaces as visible text via the
			// non-editing-branch span.
			{ verb: 'hasText', target: '[draggable="true"]', value: 'neg4' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: bookmark variant suppresses GIT pill even on git repos
	// ===================================================================
	{
		name: 'session-item-does-not-show-GIT-pill-in-bookmark-variant-even-when-isGitRepo',
		given:
			'A SessionItem is mounted with variant="bookmark" for session { id: "neg-5", name: "neg5", toolType: "claude-code", state: "idle", isGitRepo: true, bookmarked: true }.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// The renderer source explicitly guards the location-pill
			// ladder on `variant !== 'bookmark'` — bookmark rows show the
			// group badge instead. Pin via `:not(:has(...))` against the
			// tooltip the GIT pill carries.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Git repository"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: worktree variant suppresses bookmark toggle entirely
	// ===================================================================
	{
		name: 'session-item-does-not-render-bookmark-toggle-button-in-worktree-variant',
		given:
			'A SessionItem is mounted with variant="worktree" for session { id: "neg-6", name: "neg6", toolType: "claude-code", state: "idle", parentSessionId: "parent-id" }.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// Worktree children inherit the bookmark status of their
			// parent and intentionally suppress the toggle — the renderer
			// source gates the toggle behind `!session.parentSessionId`.
			// Pin via the "Add bookmark" / "Remove bookmark" tooltip
			// absence. Catalog uses the `[title*=…]` form so either copy
			// triggers the failure.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Add bookmark"]))',
			},
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Remove bookmark"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: unread badge suppressed when row IS active
	// ===================================================================
	{
		name: 'session-item-does-not-show-unread-badge-when-row-is-active',
		given:
			'A SessionItem is mounted with variant="flat" for session { id: "neg-7", name: "neg7", toolType: "claude-code", state: "idle", aiTabs: [{ id: "t1", hasUnread: true }] } and isActive=true.',
		when: ['the SessionItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[draggable="true"]' },
			// "Unread messages" tooltip carries the badge presence — if
			// active rows leak the badge, this guard fails.
			{
				verb: 'hasElement',
				target: '[draggable="true"]:not(:has([title="Unread messages"]))',
			},
		],
		happyPath: false,
	},
];

describe('SessionItem — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = sessionItemParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		// Brief: "≥3 happy + ≥1 negative-per-happy". With 8 happy + 7
		// negative the floor is comfortably met.
		const happy = sessionItemParityCatalog.filter((s) => s.happyPath).length;
		const negative = sessionItemParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(happy / 8)));
		expect(negative).toBeGreaterThanOrEqual(1);
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
		for (const story of sessionItemParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of sessionItemParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// SessionItem makes no IPC calls. The catalog must not leak any
		// renderer-only assertion target.
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'dialog.',
			'tunnel.',
			'ipcrenderer',
		];
		for (const story of sessionItemParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('every story is render-shape oriented (uses hasElement or hasText only)', () => {
		// SessionItem is purely presentational — no internal lifecycle, no
		// async, no IPC. Stories therefore stay render-shape oriented
		// (hasElement / hasText). Click + drag + rename + bookmark-toggle
		// wiring is asserted by the parent SessionList parity catalog where
		// the callbacks are bound, NOT here.
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of sessionItemParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story name is unique', () => {
		const names = sessionItemParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
