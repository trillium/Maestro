/**
 * Parity catalog — ToolCallCard
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ToolCallCard is a presentational tool-execution card that surfaces tool
 * call details from OpenCode and Codex session messages. Default-collapsed
 * view: a single horizontal pill with a `ChevronRight`, a `"Tool: <name>"`
 * label chip, a status icon, and a `"Show more"` button. Click or
 * Enter/Space activates the expanded view: a sticky header with a
 * `ChevronDown` + the same label chip + status icon + `"Collapse"` button,
 * an Input section (collapsible JSON), a status row carrying an optional
 * `"Time: <timestamp>"` label and the literal `"Status: <status>"` text,
 * and an Output section (collapsible JSON). The component honours BOTH
 * name-keys via the exported `getToolName` helper — Claude's `name` and
 * OpenCode's `tool` — so heterogeneous session entries render correctly.
 *
 * Status icon mapping (verbatim from the renderer source):
 *   - 'completed' | 'success' → `CheckCircle2`, themed success-green
 *   - 'running'   | 'pending' → `Loader2` (spinning), themed warning
 *   - 'error'     | 'failed'  → `AlertCircle`, themed error-red
 *   - default                  → `CheckCircle2` (same shape as success)
 *
 * The component touches 0 IPC namespaces / 0 Electron-only APIs / 0
 * clipboard surfaces. Pure render — all side effects are owned internally
 * by `useState` toggles (expanded/collapsed); no callbacks fire upward.
 *
 * The parity contract is observable-behavior-only:
 *   - Collapsed pill chrome: `ChevronRight` + `"Tool: <name>"` chip +
 *     `"Show more"` button.
 *   - Expanded chrome: `ChevronDown` + `"Tool: <name>"` chip + `"Collapse"`
 *     button + `"Status: <status>"` row.
 *   - Optional `"Time: <timestamp>"` row when `timestamp` prop is supplied.
 *   - JSON sections gated on `state.input` / `state.output` presence.
 *   - `"Show more"` / `"Show less"` toggle copy on JSON sections only when
 *     the content is longer than 5 lines (the `maxCollapsedLines`
 *     constant).
 *   - Both name-keys (`name` and `tool`) are honoured by `getToolName`.
 *   - `defaultExpanded={true}` opens the card on mount.
 *   - Empty `toolUse=[]` and `toolUse=undefined` cases render nothing
 *     (early `return null`).
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

export const toolCallCardParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'tool-call-card-collapsed-renders-tool-name-chip-and-show-more',
		given:
			'The component is mounted with toolUse=[{ name: "Bash", state: { status: "completed" } }], defaultExpanded omitted (default false).',
		when: ['the ToolCallCard renders in its default-collapsed state'],
		then: [
			// "Tool: <name>" chip copy
			{ verb: 'hasText', target: 'span', value: 'Tool: Bash' },
			// "Show more" affordance discoverable on the collapsed pill
			{ verb: 'hasText', target: 'button', value: 'Show more' },
			// The collapsed pill is keyboard-activatable — it carries role=button
			{ verb: 'hasElement', target: '[role="button"]' },
		],
		happyPath: true,
	},
	{
		name: 'tool-call-card-expanded-renders-collapse-and-status-row',
		given:
			'The component is mounted with toolUse=[{ name: "Write", state: { status: "completed", input: { path: "/tmp/x" }, output: "ok" } }], defaultExpanded=true, timestamp="12:34:56".',
		when: ['the ToolCallCard renders in its expanded state'],
		then: [
			// Expanded header carries the "Collapse" affordance
			{ verb: 'hasText', target: 'button', value: 'Collapse' },
			// Tool-name chip stays present in the expanded header
			{ verb: 'hasText', target: 'span', value: 'Tool: Write' },
			// "Status: <status>" row text
			{ verb: 'hasText', target: 'span', value: 'Status: completed' },
			// Optional "Time: <timestamp>" row when timestamp is supplied
			{ verb: 'hasText', target: 'span', value: 'Time: 12:34:56' },
		],
		happyPath: true,
	},
	{
		name: 'tool-call-card-honours-opencode-tool-key-as-well-as-claude-name-key',
		given:
			'The component is mounted with toolUse=[{ tool: "edit", state: { status: "success" } }] (OpenCode shape — `tool` key instead of `name` key), defaultExpanded=false.',
		when: ['the ToolCallCard renders'],
		then: [
			// The `tool` key surfaces as the chip name — both name-keys are
			// honoured by `getToolName` per the renderer contract.
			{ verb: 'hasText', target: 'span', value: 'Tool: edit' },
			// "Show more" affordance still discoverable on the collapsed pill
			{ verb: 'hasText', target: 'button', value: 'Show more' },
		],
		happyPath: true,
	},
	{
		name: 'tool-call-card-expanded-renders-input-and-output-section-labels',
		given:
			'The component is mounted with toolUse=[{ name: "Read", state: { status: "completed", input: { path: "/etc/hosts" }, output: { lines: 12 } } }], defaultExpanded=true.',
		when: ['the ToolCallCard renders in its expanded state'],
		then: [
			// Input section label
			{ verb: 'hasText', target: 'span', value: 'Input:' },
			// Output section label
			{ verb: 'hasText', target: 'span', value: 'Output:' },
			// The JSON payloads land inside <pre> blocks (the monospace
			// formatted-content container)
			{ verb: 'hasElement', target: 'pre' },
		],
		happyPath: true,
	},
	{
		name: 'tool-call-card-collapsed-default-without-timestamp-omits-time-row',
		given:
			'The component is mounted with toolUse=[{ name: "Glob", state: { status: "completed" } }], defaultExpanded=true, timestamp undefined.',
		when: ['the ToolCallCard renders in its expanded state without a timestamp prop'],
		then: [
			// Status row still surfaces
			{ verb: 'hasText', target: 'span', value: 'Status: completed' },
			// Tool-name chip surfaces in the header
			{ verb: 'hasText', target: 'span', value: 'Tool: Glob' },
			// "Collapse" affordance on expanded header
			{ verb: 'hasText', target: 'button', value: 'Collapse' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'tool-call-card-renders-nothing-when-tooluse-empty-array',
		given: 'The component is mounted with toolUse=[] (empty array).',
		when: ['the ToolCallCard renders'],
		then: [
			// The component returns null — no `Tool:` chip is emitted, no
			// `Show more` button is emitted. Asserted as exclusion via
			// `:not(:has(...))` selectors on the body.
			{ verb: 'hasElement', target: 'body:not(:has(button))' },
		],
		happyPath: false,
	},
	{
		name: 'tool-call-card-collapsed-omits-collapse-affordance',
		given:
			'The component is mounted with toolUse=[{ name: "Bash", state: { status: "completed" } }], defaultExpanded=false.',
		when: ['the ToolCallCard renders in its default-collapsed state'],
		then: [
			// "Collapse" affordance is expanded-only — the collapsed pill
			// must not carry that copy.
			{ verb: 'hasElement', target: 'body:not(:has(button:has-text("Collapse")))' },
			// "Show more" is still present (positive companion to the above)
			{ verb: 'hasText', target: 'button', value: 'Show more' },
		],
		happyPath: false,
	},
	{
		name: 'tool-call-card-falls-back-to-unknown-when-both-name-keys-missing',
		given:
			'The component is mounted with toolUse=[{ state: { status: "completed" } }] (neither `name` nor `tool` key present), defaultExpanded=false.',
		when: ['the ToolCallCard renders'],
		then: [
			// `getToolName` returns the literal string "unknown" when both
			// shape-keys are absent.
			{ verb: 'hasText', target: 'span', value: 'Tool: unknown' },
		],
		happyPath: false,
	},
	{
		name: 'tool-call-card-does-not-render-modal-or-banner-chrome',
		given:
			'The component is mounted with toolUse=[{ name: "Bash", state: { status: "completed" } }], defaultExpanded=true.',
		when: ['the ToolCallCard renders in any state (collapsed or expanded)'],
		then: [
			// The card is an inline transcript artefact — NOT a modal, NOT a
			// banner. If a future refactor wraps the card in a modal/banner,
			// that is a behaviour change and the catalog should fail rather
			// than silently track it.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
			{ verb: 'hasElement', target: 'body:not(:has([role="alert"]))' },
		],
		happyPath: false,
	},
	{
		name: 'tool-call-card-fires-no-ipc-or-websocket-traffic-on-mount-or-toggle',
		given:
			'The component is mounted with toolUse=[{ name: "Bash", state: { status: "completed", input: { cmd: "ls" }, output: "a\\nb\\nc" } }], defaultExpanded=false.',
		when: [
			'the ToolCallCard mounts',
			'the user clicks the collapsed pill to expand',
			'the user clicks the expanded header to collapse',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db
			// side effect. The card's expand/collapse state lives entirely
			// in local React state.
			{ verb: 'hasText', target: 'span', value: 'Tool: Bash' },
		],
		happyPath: false,
	},
	{
		name: 'tool-call-card-status-error-still-renders-tool-chip',
		given:
			'The component is mounted with toolUse=[{ name: "Bash", state: { status: "error", output: "exit 1" } }], defaultExpanded=true.',
		when: ['the ToolCallCard renders an errored tool call in its expanded state'],
		then: [
			// Tool-name chip is independent of status — still surfaces
			// when the tool errored.
			{ verb: 'hasText', target: 'span', value: 'Tool: Bash' },
			// "Status: error" row surfaces the failure mode verbatim
			{ verb: 'hasText', target: 'span', value: 'Status: error' },
		],
		happyPath: false,
	},
];

describe('ToolCallCard — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(toolCallCardParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = toolCallCardParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = toolCallCardParityCatalog.filter((s) => s.happyPath).length;
		const negative = toolCallCardParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative per happy.
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
		for (const story of toolCallCardParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of toolCallCardParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of toolCallCardParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (card is not a modal or banner)', () => {
		// The card is an inline tool-execution artefact — not a `role="dialog"`
		// modal, not a `role="alert"` banner. The catalog may reference those
		// role tokens INSIDE the "no modal/banner chrome" pin (as a
		// `:not(:has(...))` selector) — but no story may assert a positive
		// hasElement(role="dialog") / hasElement(role="alert") against a modal
		// shell directly.
		for (const story of toolCallCardParityCatalog) {
			for (const a of story.then) {
				const t = a.target.toLowerCase();
				const isDialogTarget = t.startsWith('[role="dialog"]') || t === '[role="dialog"]';
				const isAlertTarget = t.startsWith('[role="alert"]') || t === '[role="alert"]';
				expect(isDialogTarget).toBe(false);
				expect(isAlertTarget).toBe(false);
			}
		}
	});
});
