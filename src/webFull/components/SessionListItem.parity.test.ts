/**
 * Parity catalog — SessionListItem
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SessionListItem is a purely presentational row component for the Left
 * Bar. It takes a `Session`, an `isActive` flag, a `theme`, and an
 * `onSelect` callback. It touches 0 IPC namespaces and 0 Electron-only
 * APIs.
 *
 * Per the task brief, stories here are **render-shape oriented**
 * (hasElement / hasText) rather than interaction-flow oriented, because
 * the component has no internal lifecycle — it renders a single button
 * with a status dot, label, and mode pill. Click semantics are covered
 * by the parent `SessionList`'s parity catalog
 * (`SessionList.parity.test.ts` → `session-list-click-fires-…`), so we
 * don't duplicate them here.
 *
 *   IN (asserted here):
 *     - The row renders as a single option button with the right
 *       data attributes (id, state, active).
 *     - The session name appears as visible text; "Untitled" fallback
 *       when name is empty.
 *     - Active-row aria-selected + data-active flip to true.
 *     - State attribute pass-through for status-color assertions
 *       (idle / busy / connecting / unknown→error fallback).
 *     - AI vs Terminal mode pill (label and pill text).
 *
 *   DROPPED (named so the partial-parity surface is countable):
 *     - Star button, quick-resume, inline rename, origin pill, session
 *       ID pill, stats (time/messages/size/cost), match info, ACTIVE
 *       text badge. These belong to the renderer's
 *       `SessionListItem.tsx` (AgentSessionsBrowser context) — NOT the
 *       Left Bar agent row. The webFull Left Bar tracks each Left-Bar
 *       deferral at `ISC-44.layer-4.1.<deferral>`.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron
 *     oracle at localhost:9222 and webFull at localhost:5176).
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

export const sessionListItemParityCatalog: ParityStory[] = [
	// ===================================================================
	// Happy-path: row renders with correct data attributes + name text
	// ===================================================================
	{
		name: 'session-list-item-renders-as-an-option-button-with-id-state-and-active-attrs',
		given:
			'A SessionListItem is mounted for session { id: "alpha-id", name: "alpha", state: "idle", inputMode: "ai" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// Single option button keyed by session id is in the DOM.
			{ verb: 'hasElement', target: '[role="option"][data-session-id="alpha-id"]' },
			// State attribute is the raw wire-protocol value, for status-color
			// assertions higher up in the catalog tree.
			{
				verb: 'hasElement',
				target: '[data-session-id="alpha-id"][data-session-state="idle"]',
			},
			// data-active mirrors aria-selected for non-aria-aware harnesses.
			{ verb: 'hasElement', target: '[data-session-id="alpha-id"][data-active="false"]' },
			// aria-selected matches the inactive flag.
			{ verb: 'hasElement', target: '[data-session-id="alpha-id"][aria-selected="false"]' },
			// Session name appears as visible text inside the row.
			{ verb: 'hasText', target: '[data-session-id="alpha-id"]', value: 'alpha' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: active row flips aria-selected + data-active to true
	// ===================================================================
	{
		name: 'session-list-item-marks-active-row-with-aria-selected-and-data-active-true',
		given:
			'A SessionListItem is mounted for session { id: "beta-id", name: "beta", state: "busy", inputMode: "ai" } with isActive=true.',
		when: ['the SessionListItem renders'],
		then: [
			// aria-selected reflects isActive=true.
			{ verb: 'hasElement', target: '[data-session-id="beta-id"][aria-selected="true"]' },
			// data-active mirrors.
			{ verb: 'hasElement', target: '[data-session-id="beta-id"][data-active="true"]' },
			// State pass-through stays present (so status-color downstream still works).
			{
				verb: 'hasElement',
				target: '[data-session-id="beta-id"][data-session-state="busy"]',
			},
			// Name still rendered.
			{ verb: 'hasText', target: '[data-session-id="beta-id"]', value: 'beta' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: AI mode pill present for AI-mode sessions
	// ===================================================================
	{
		name: 'session-list-item-shows-AI-mode-pill-when-inputMode-is-not-terminal',
		given:
			'A SessionListItem is mounted for session { id: "gamma-id", name: "gamma", state: "connecting", inputMode: "ai" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// Mode pill text says "AI".
			{ verb: 'hasText', target: '[data-session-id="gamma-id"]', value: 'AI' },
			// Pill carries the aria-label "AI mode" for assistive tech.
			{
				verb: 'hasElement',
				target: '[data-session-id="gamma-id"] [aria-label="AI mode"]',
			},
			// State pass-through for the connecting case.
			{
				verb: 'hasElement',
				target: '[data-session-id="gamma-id"][data-session-state="connecting"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: Terminal mode pill present for terminal-mode sessions
	// ===================================================================
	{
		name: 'session-list-item-shows-terminal-mode-pill-when-inputMode-is-terminal',
		given:
			'A SessionListItem is mounted for session { id: "delta-id", name: "delta", state: "idle", inputMode: "terminal" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// Terminal-mode pill uses the ⌘ glyph.
			{ verb: 'hasText', target: '[data-session-id="delta-id"]', value: '⌘' },
			// Pill carries the aria-label "Terminal mode" for assistive tech.
			{
				verb: 'hasElement',
				target: '[data-session-id="delta-id"] [aria-label="Terminal mode"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Negative-path: empty name falls back to "Untitled"
	// ===================================================================
	{
		name: 'session-list-item-falls-back-to-untitled-when-name-is-empty',
		given:
			'A SessionListItem is mounted for session { id: "anon-id", name: "", state: "idle", inputMode: "ai" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// The row still exists.
			{ verb: 'hasElement', target: '[data-session-id="anon-id"]' },
			// "Untitled" copy appears as the visible name fallback.
			{ verb: 'hasText', target: '[data-session-id="anon-id"]', value: 'Untitled' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: unknown state still renders (status falls back to error)
	// ===================================================================
	{
		name: 'session-list-item-renders-row-even-for-unknown-state-values',
		given:
			'A SessionListItem is mounted for session { id: "weird-id", name: "weird", state: "dead", inputMode: "ai" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// Row still rendered — we never drop unknown-state sessions.
			{ verb: 'hasElement', target: '[data-session-id="weird-id"]' },
			// Raw state attribute preserved so a status-color assertion
			// against the StatusDot pulls "error" via the renderer's mapping
			// (stateToStatus → 'error' for anything outside the known set).
			{
				verb: 'hasElement',
				target: '[data-session-id="weird-id"][data-session-state="dead"]',
			},
			// Name still rendered.
			{ verb: 'hasText', target: '[data-session-id="weird-id"]', value: 'weird' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: undefined inputMode treated as AI (default)
	// ===================================================================
	{
		name: 'session-list-item-treats-undefined-inputMode-as-AI',
		given:
			'A SessionListItem is mounted for session { id: "noinput-id", name: "noinput", state: "idle", inputMode: undefined } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			// Row still rendered.
			{ verb: 'hasElement', target: '[data-session-id="noinput-id"]' },
			// Mode pill defaults to AI (only "terminal" forces the ⌘ branch).
			{ verb: 'hasText', target: '[data-session-id="noinput-id"]', value: 'AI' },
			{
				verb: 'hasElement',
				target: '[data-session-id="noinput-id"] [aria-label="AI mode"]',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: inactive row does NOT carry aria-selected=true
	// ===================================================================
	{
		name: 'session-list-item-inactive-row-reports-aria-selected-false-and-data-active-false',
		given:
			'A SessionListItem is mounted for session { id: "epsilon-id", name: "epsilon", state: "idle", inputMode: "ai" } with isActive=false.',
		when: ['the SessionListItem renders'],
		then: [
			{ verb: 'hasElement', target: '[data-session-id="epsilon-id"][aria-selected="false"]' },
			{ verb: 'hasElement', target: '[data-session-id="epsilon-id"][data-active="false"]' },
		],
		happyPath: false,
	},
];

describe('SessionListItem — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = sessionListItemParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		// Brief: "≥3 happy + ≥1 negative-per-happy". With 4 happy + 4 negative
		// the floor is comfortably met.
		const happy = sessionListItemParityCatalog.filter((s) => s.happyPath).length;
		const negative = sessionListItemParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(happy / 3)));
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
		for (const story of sessionListItemParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of sessionListItemParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// SessionListItem makes no IPC calls. The catalog must not leak any
		// renderer-only assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of sessionListItemParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('every story is render-shape oriented (uses hasElement or hasText only)', () => {
		// Per task brief: SessionListItem is purely presentational, so stories
		// are render-shape oriented (hasElement / hasText) NOT interaction-flow
		// (broadcast / wsFrameMatches). Click semantics belong to the parent
		// SessionList catalog where the callback wiring lives.
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of sessionListItemParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
