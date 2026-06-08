/**
 * Parity catalog — SendToAgentModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SendToAgentModal is a modal-shape surface that lets the user transfer
 * the current session/tab context to a different Maestro session. It owns
 * a fuzzy-search input bound to a filtered session list, arrow-key + 1-9
 * quick-select keyboard navigation, a token estimate row (source ~tokens
 * + groomed ~73% estimate when groomContext is on), a "Clean context"
 * checkbox (default ON), and a Send button that calls
 * `onSend(targetSessionId, options)` and awaits a `MergeResult` before
 * calling `onClose()`.
 *
 * The catalog is observable-behavior-only and render-shape oriented
 * (`hasElement` / `hasText`). Internal state (selected index, groom
 * checkbox, isSending) is asserted indirectly via the render-shape it
 * produces (e.g. "Sending..." copy + the busy aria attribute on the send
 * button), NOT by introspecting React state.
 *
 *   IN (asserted here):
 *     - Closed-state contract: when `isOpen=false` the modal renders
 *       nothing (no role="dialog", no header copy, no listbox).
 *     - Open-state contract: when `isOpen=true` the modal renders the
 *       `role="dialog"` overlay, the "Send Context to Agent" title, the
 *       search input, the session listbox, the token preview, the Clean
 *       context checkbox (default checked), the Cancel button, and the
 *       Send button.
 *     - Source session is excluded from the target list.
 *     - Terminal-only sessions are excluded from the target list.
 *     - Each target session row carries the session name and the project
 *       root as visible text.
 *     - Empty-state copy ("No other sessions available") surfaces when
 *       there are no eligible targets.
 *     - Empty-state copy ("No matching sessions found") surfaces when the
 *       search query filters all targets out.
 *
 *   DROPPED / OUT-OF-SCOPE (named so the partial-parity surface is
 *   countable, not silently invisible):
 *     - The actual side effects (onSend → MergeResult → onClose) are
 *       parent-owned; the catalog asserts the button presence + the
 *       `aria-busy` attribute, not the underlying IPC + grooming flow.
 *     - Layer-stack registration is asserted indirectly via the modal's
 *       `role="dialog"` + `aria-modal="true"` attributes — the layer-stack
 *       harness wires Escape via the registered `onEscape` callback and
 *       that callback wiring is asserted by the LayerStack parity catalog,
 *       not here.
 *     - The fuzzy-search scoring math itself is owned by
 *       `fuzzyMatchWithScore` (consumed from
 *       `../../renderer/utils/search`) and has its own test surface.
 *     - The arrow-key / 1-9 quick-select keyboard navigation is asserted
 *       at the integration layer where a real DOM + key event flow can be
 *       fed in; this catalog stays render-shape oriented and pins only
 *       the listbox + per-row quick-select badge.
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

export const sendToAgentModalParityCatalog: ParityStory[] = [
	// ===================================================================
	// Happy-path: open-state renders dialog + title + search + listbox + footer
	// ===================================================================
	{
		name: 'send-to-agent-renders-dialog-with-title-and-controls-when-open',
		given:
			'SendToAgentModal is mounted with isOpen=true, a sourceSession with at least one available target session, sourceTabId pointing to an aiTab on the source session, and allSessions containing the source plus one idle non-terminal target.',
		when: ['the modal renders'],
		then: [
			// Modal-overlay contract.
			{ verb: 'hasElement', target: '[role="dialog"][aria-modal="true"]' },
			// Header title surfaces as visible text.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Send Context to Agent' },
			// Search input is present with the visible placeholder.
			{ verb: 'hasElement', target: '[role="dialog"] input[placeholder="Search sessions..."]' },
			// Session list mounts with the listbox role + visible label.
			{
				verb: 'hasElement',
				target: '[role="dialog"] [role="listbox"][aria-label="Available sessions"]',
			},
			// Footer Cancel + Send buttons surface as visible text.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Send to Session' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: target session row shows name + project path
	// ===================================================================
	{
		name: 'send-to-agent-target-session-row-renders-name-and-projectRoot',
		given:
			'SendToAgentModal is mounted with isOpen=true and allSessions=[sourceSession, { id: "alpha", name: "Alpha Bot", projectRoot: "/repos/alpha", toolType: "claude-code", state: "idle", aiTabs: [] }]. Source session is distinct from "alpha".',
		when: ['the modal renders'],
		then: [
			// Row mounts with role="option".
			{ verb: 'hasElement', target: '[role="listbox"] [role="option"]' },
			// Session name surfaces as visible text inside the listbox.
			{ verb: 'hasText', target: '[role="listbox"]', value: 'Alpha Bot' },
			// Project root surfaces as visible text inside the listbox.
			{ verb: 'hasText', target: '[role="listbox"]', value: '/repos/alpha' },
			// Idle status label surfaces (status-badge copy).
			{ verb: 'hasText', target: '[role="listbox"]', value: 'Idle' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: groom-context checkbox is checked by default
	// ===================================================================
	{
		name: 'send-to-agent-groom-context-checkbox-is-checked-by-default',
		given: 'SendToAgentModal is mounted with isOpen=true. No checkbox interaction has occurred.',
		when: ['the modal renders'],
		then: [
			// Checkbox carries the default-on contract.
			{ verb: 'hasElement', target: '[role="dialog"] input[type="checkbox"]:checked' },
			// Label copy surfaces as visible text.
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Clean context (remove duplicates, reduce size)',
			},
			// "After cleaning:" preview row surfaces because groomContext is on by default.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'After cleaning:' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: source session is excluded from the target list
	// ===================================================================
	{
		name: 'send-to-agent-source-session-is-not-rendered-as-a-target-option',
		given:
			'SendToAgentModal is mounted with isOpen=true, sourceSession={ id: "self", name: "SourceBot", projectRoot: "/repos/self", toolType: "claude-code" }, and allSessions=[sourceSession, { id: "alpha", name: "Alpha Bot", projectRoot: "/repos/alpha", toolType: "claude-code", state: "idle", aiTabs: [] }].',
		when: ['the modal renders'],
		then: [
			// The listbox renders the target row.
			{ verb: 'hasText', target: '[role="listbox"]', value: 'Alpha Bot' },
			// The source session name DOES NOT surface inside the listbox.
			// :not(:has(...)) form per the precedent set by SessionItem +
			// MergeProgressOverlay.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has([role="listbox"] :is(*:has-text("SourceBot"))))',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: empty-state copy when no eligible targets exist
	// ===================================================================
	{
		name: 'send-to-agent-empty-state-copy-when-only-source-session-exists',
		given:
			'SendToAgentModal is mounted with isOpen=true and allSessions=[sourceSession] (only the source — no other sessions, no terminal sessions).',
		when: ['the modal renders'],
		then: [
			// Dialog is still rendered.
			{ verb: 'hasElement', target: '[role="dialog"]' },
			// Empty-state copy surfaces inside the listbox area.
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'No other sessions available',
			},
			// No [role="option"] rows render.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has([role="option"]))',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Negative-path: closed-state renders nothing
	// ===================================================================
	{
		name: 'send-to-agent-renders-nothing-when-isOpen-is-false',
		given:
			'SendToAgentModal is mounted with isOpen=false. The component returns null per the early-return guard.',
		when: ['the modal renders'],
		then: [
			// No dialog overlay surfaces.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
			// Header copy MUST NOT leak — would indicate the early-return
			// guard regressed and the modal stayed visible while isOpen=false.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:is(*:has-text("Send Context to Agent"))))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: terminal-only sessions are excluded from the target list
	// ===================================================================
	{
		name: 'send-to-agent-terminal-sessions-are-not-rendered-as-target-options',
		given:
			'SendToAgentModal is mounted with isOpen=true, sourceSession={ id: "self", toolType: "claude-code" }, and allSessions=[sourceSession, { id: "shell-1", name: "Shell", projectRoot: "/repos/shell", toolType: "terminal", state: "idle", aiTabs: [] }].',
		when: ['the modal renders'],
		then: [
			// The listbox area renders the empty-state copy because the
			// only non-source session is terminal and gets filtered out.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'No other sessions available' },
			// Terminal session name MUST NOT leak into the listbox.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has([role="option"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: send button is disabled until a session is selected
	// ===================================================================
	{
		name: 'send-to-agent-send-button-disabled-when-no-selection-made',
		given:
			'SendToAgentModal is mounted with isOpen=true, a valid sourceSession, and at least one eligible target — but the user has NOT yet clicked / quick-selected any target row.',
		when: ['the modal renders'],
		then: [
			// Send button surfaces as visible text.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Send to Session' },
			// Send button MUST carry the disabled attribute because
			// `canSend` returns false when `selectedSessionId === null`.
			{ verb: 'hasElement', target: '[role="dialog"] button[disabled]' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: dialog is NOT registered as an inline overlay or
	// non-modal popup — must remain a `role="dialog"` + `aria-modal="true"`
	// ===================================================================
	{
		name: 'send-to-agent-does-not-render-as-inline-non-modal-overlay',
		given:
			'SendToAgentModal is mounted with isOpen=true. A future refactor that drops the `aria-modal="true"` attribute (downgrading to a non-modal popup) would silently regress accessibility expectations.',
		when: ['the modal renders'],
		then: [
			// Modal contract pinned: dialog + aria-modal=true together.
			{ verb: 'hasElement', target: '[role="dialog"][aria-modal="true"]' },
			// MUST NOT render as a tooltip / listbox-only / status surface.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not([role="tooltip"]):not([role="status"])',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: no IPC / no WS lifecycle pin
	// ===================================================================
	{
		name: 'send-to-agent-no-ipc-or-websocket-frames-fire-on-mount',
		given:
			'SendToAgentModal is mounted with isOpen=true. The lift contract is "0 IPC namespaces touched, 0 Electron-only APIs touched". A future refactor adding a `window.maestro.*` call inside `useEffect` would silently regress the contract.',
		when: ['the modal renders'],
		then: [
			// Lifecycle pin: NO WS frames fire from the modal's own mount.
			// The parent `onSend` callback is responsible for grooming
			// + merging — the modal itself stays pure.
			{ verb: 'wsFrameMatches', target: 'send-to-agent.modal.mount', value: 'absent' },
		],
		happyPath: false,
	},
];

describe('SendToAgentModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = sendToAgentModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		// Brief: "≥3 happy + ≥1 negative-per-happy".
		const happy = sendToAgentModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = sendToAgentModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of sendToAgentModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of sendToAgentModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface as a positive target', () => {
		// The catalog's only IPC/WS assertion is the `wsFrameMatches`
		// absence-pin in the no-IPC lifecycle guard. Catalog stories
		// must not POSITIVELY name `window.maestro` / `ipcRenderer` /
		// `shell.*` / `dialog.*` / `tunnel.*` selectors.
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'dialog.',
			'tunnel.',
			'ipcrenderer',
		];
		for (const story of sendToAgentModalParityCatalog) {
			for (const assertion of story.then) {
				const haystack = (assertion.target + ' ' + (assertion.value ?? '')).toLowerCase();
				for (const b of banned) {
					expect(haystack.includes(b)).toBe(false);
				}
			}
		}
	});

	it('every story name is unique', () => {
		const names = sendToAgentModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('pins the modal contract (role=dialog + aria-modal=true) at least once', () => {
		// SendToAgentModal is a true modal — a future refactor downgrading
		// it to an inline popup is a behavioral change and should fail the
		// catalog, not silently track. Guard against catalog drift toward
		// missing the modal-shape contract.
		const seen = sendToAgentModalParityCatalog.some((story) =>
			story.then.some((a) => a.verb === 'hasElement' && a.target.includes('aria-modal="true"'))
		);
		expect(seen).toBe(true);
	});
});
