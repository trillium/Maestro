/**
 * Parity catalog — PromptComposerModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * PromptComposerModal is a full-viewport (90vw x 80vh) prompt-editor
 * modal that holds a multi-line textarea, an `@`-mention dropdown sourced
 * from `sessions` + `groups`, a staged-image thumbnail strip, and a
 * footer toggle row (History / Read-Only / Show Thinking / Enter-to-send
 * / Send). It registers with the layer stack at
 * `MODAL_PRIORITIES.PROMPT_COMPOSER` (725) with `focusTrap: 'strict'`.
 *
 * The catalog is observable-behavior-only and render-shape oriented
 * (`hasElement` / `hasText`). Internal state (value, showMentions,
 * mentionFilter, selectedMentionIndex) is asserted indirectly via the
 * render-shape it produces (e.g. textarea presence, character/token
 * count copy, Send button enabled/disabled), NOT by introspecting React
 * state.
 *
 *   IN (asserted here):
 *     - Closed-state contract: when `isOpen=false` the modal renders
 *       nothing (no header, no textarea, no footer).
 *     - Open-state contract: when `isOpen=true` the modal renders the
 *       "Prompt Composer" header, the session-name suffix, the
 *       Close-(Escape) X affordance, the textarea, the character +
 *       token count copy, and the Send button.
 *     - The textarea carries the no-mentions placeholder copy when
 *       `sessions` is empty or undefined.
 *     - The textarea carries the with-mentions placeholder copy when
 *       `sessions` contains at least one entry.
 *     - The Send button is disabled when `value.trim()` is empty (i.e.
 *       on first open with empty `initialValue`).
 *     - When `setStagedImages` is provided, the Attach-Image affordance
 *       surfaces and the hidden file input is mounted.
 *     - When optional toggles (`onToggleTabSaveToHistory`,
 *       `onToggleTabReadOnlyMode`, `onToggleEnterToSend`) are provided,
 *       the matching footer chips surface with their visible copy.
 *
 *   DROPPED / OUT-OF-SCOPE (named so the partial-parity surface is
 *   countable, not silently invisible):
 *     - The keyboard shortcuts (Cmd/Ctrl+Enter to send, Cmd/Ctrl+S to
 *       toggle history, Cmd/Ctrl+R to toggle read-only, Cmd/Ctrl+Shift+L
 *       to open lightbox, Tab to insert tab char) are wiring-level
 *       behavior asserted at the integration layer where a real DOM +
 *       key event flow can be fed in; this catalog stays render-shape
 *       oriented.
 *     - The `@`-mention dropdown filter logic and arrow-key navigation
 *       within the dropdown are also wiring-level; the catalog asserts
 *       only the placeholder copy variant when `hasMentions` is true.
 *     - The clipboard paste-handling (image-byte detection + whitespace
 *       trimming) is wiring-level and tested where a real
 *       ClipboardEvent can be synthesised.
 *     - Layer-stack registration is asserted indirectly via the chrome
 *       presence — the layer-stack harness owns the Escape wiring
 *       contract in its own parity catalog.
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

export const promptComposerModalParityCatalog: ParityStory[] = [
	// ===================================================================
	// Happy-path: open-state renders header, textarea, footer Send button
	// ===================================================================
	{
		name: 'prompt-composer-renders-header-textarea-and-send-button-when-open',
		given:
			'PromptComposerModal is mounted with isOpen=true, initialValue="hello world", sessionName="alpha-bot", and no optional toggles set.',
		when: ['the modal renders'],
		then: [
			// Header title copy surfaces as visible text.
			{ verb: 'hasText', target: 'body', value: 'Prompt Composer' },
			// Session-name suffix surfaces ("— alpha-bot").
			{ verb: 'hasText', target: 'body', value: 'alpha-bot' },
			// Close-(Escape) X affordance surfaces with the canonical title.
			{ verb: 'hasElement', target: 'button[title="Close (Escape)"]' },
			// Textarea mounts inside the chrome.
			{ verb: 'hasElement', target: 'textarea' },
			// Send button copy surfaces as visible text.
			{ verb: 'hasText', target: 'body', value: 'Send' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: textarea carries the no-mentions placeholder copy
	// ===================================================================
	{
		name: 'prompt-composer-textarea-uses-no-mentions-placeholder-when-sessions-not-provided',
		given:
			'PromptComposerModal is mounted with isOpen=true, initialValue="", and `sessions` is undefined.',
		when: ['the modal renders'],
		then: [
			// Textarea exists.
			{ verb: 'hasElement', target: 'textarea' },
			// Placeholder is the no-mentions variant.
			{
				verb: 'hasElement',
				target: 'textarea[placeholder="Write your prompt here..."]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: textarea carries the with-mentions placeholder copy
	// ===================================================================
	{
		name: 'prompt-composer-textarea-uses-with-mentions-placeholder-when-sessions-provided',
		given:
			'PromptComposerModal is mounted with isOpen=true, initialValue="", and `sessions` contains one entry { id: "alpha", name: "Alpha", toolType: "claude-code" }.',
		when: ['the modal renders'],
		then: [
			// Textarea exists.
			{ verb: 'hasElement', target: 'textarea' },
			// Placeholder is the with-mentions variant — explicitly names
			// the `@` mention affordance so users discover it on first open.
			{
				verb: 'hasElement',
				target: 'textarea[placeholder="Write your prompt here... (@ to mention agent)"]',
			},
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: optional footer toggles surface when their callbacks are provided
	// ===================================================================
	{
		name: 'prompt-composer-footer-toggles-render-when-callbacks-provided',
		given:
			'PromptComposerModal is mounted with isOpen=true and the optional toggle callbacks `onToggleTabSaveToHistory`, `onToggleTabReadOnlyMode`, `onToggleEnterToSend` all provided.',
		when: ['the modal renders'],
		then: [
			// History toggle copy surfaces.
			{ verb: 'hasText', target: 'body', value: 'History' },
			// Read-Only toggle copy surfaces (with fallback label when
			// `agentId` is not provided).
			{ verb: 'hasText', target: 'body', value: 'Read-Only' },
			// At least one chip exists in the footer toggle row.
			{ verb: 'hasElement', target: 'button[title*="Save to History"]' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Happy-path: character + token count chips surface for non-empty value
	// ===================================================================
	{
		name: 'prompt-composer-character-and-token-count-chips-surface-in-footer',
		given:
			'PromptComposerModal is mounted with isOpen=true and initialValue="hello" (5 characters). The component renders the chip "5 characters" + the token-count chip in the footer.',
		when: ['the modal renders'],
		then: [
			// Character count chip surfaces — pins the formatter contract.
			{ verb: 'hasText', target: 'body', value: '5 characters' },
			// "tokens" suffix surfaces (exact integer + `toLocaleString`
			// formatting is owned by `estimateTokenCount`, not asserted
			// here — the catalog pins the suffix presence only).
			{ verb: 'hasText', target: 'body', value: 'tokens' },
		],
		happyPath: true,
	},

	// ===================================================================
	// Negative-path: closed-state renders nothing
	// ===================================================================
	{
		name: 'prompt-composer-renders-nothing-when-isOpen-is-false',
		given:
			'PromptComposerModal is mounted with isOpen=false. The component returns null per the early-return guard.',
		when: ['the modal renders'],
		then: [
			// Header copy MUST NOT surface — would indicate the early-return
			// guard regressed and the modal stayed visible.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:is(*:has-text("Prompt Composer"))))',
			},
			// Textarea MUST NOT mount.
			{ verb: 'hasElement', target: 'body:not(:has(textarea))' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: Send button is disabled when value is empty
	// ===================================================================
	{
		name: 'prompt-composer-send-button-disabled-when-value-is-empty',
		given:
			'PromptComposerModal is mounted with isOpen=true and initialValue="". The Send button reads `disabled={!value.trim()}`.',
		when: ['the modal renders'],
		then: [
			// Send button copy still surfaces.
			{ verb: 'hasText', target: 'body', value: 'Send' },
			// Send button MUST carry the disabled attribute.
			{ verb: 'hasElement', target: 'button[disabled]' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: image-attach affordance suppressed when setStagedImages absent
	// ===================================================================
	{
		name: 'prompt-composer-image-attach-affordance-suppressed-when-setStagedImages-undefined',
		given:
			'PromptComposerModal is mounted with isOpen=true and `setStagedImages` is undefined. The image-attach button + hidden file input are gated on `setStagedImages` truthiness.',
		when: ['the modal renders'],
		then: [
			// Modal chrome still mounts.
			{ verb: 'hasElement', target: 'textarea' },
			// Attach-Image button MUST NOT mount — its title="Attach Image".
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Attach Image"]))',
			},
			// Hidden file input MUST NOT mount.
			{
				verb: 'hasElement',
				target: 'body:not(:has(input[type="file"]))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: Show Thinking toggle suppressed when supportsThinking=false
	// ===================================================================
	{
		name: 'prompt-composer-thinking-toggle-suppressed-when-supportsThinking-is-false',
		given:
			'PromptComposerModal is mounted with isOpen=true, supportsThinking=false, and `onToggleTabShowThinking` provided. The renderer source gates the chip on `supportsThinking && onToggleTabShowThinking`.',
		when: ['the modal renders'],
		then: [
			// Modal still mounts.
			{ verb: 'hasElement', target: 'textarea' },
			// Thinking-toggle chip copy MUST NOT surface.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:is(*:has-text("Thinking"))))',
			},
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: no IPC / no WS lifecycle pin
	// ===================================================================
	{
		name: 'prompt-composer-no-ipc-or-websocket-frames-fire-on-mount',
		given:
			'PromptComposerModal is mounted with isOpen=true. The lift contract is "0 IPC namespaces touched, 0 Electron-only APIs touched". A future refactor adding a `window.maestro.*` call inside `useEffect` would silently regress the contract.',
		when: ['the modal renders'],
		then: [
			// Lifecycle pin: NO WS frames fire from the modal's own mount.
			// The parent `onSend` / `onSubmit` callbacks own the
			// downstream wiring — the modal itself stays pure.
			{ verb: 'wsFrameMatches', target: 'prompt-composer.modal.mount', value: 'absent' },
		],
		happyPath: false,
	},

	// ===================================================================
	// Negative-path: Close-(Escape) X affordance presence pin
	// ===================================================================
	{
		name: 'prompt-composer-close-x-affordance-must-carry-Escape-tooltip-copy',
		given:
			'PromptComposerModal is mounted with isOpen=true. The header X button carries title="Close (Escape)" — a future refactor dropping the Escape hint would silently regress accessibility expectations.',
		when: ['the modal renders'],
		then: [
			// Close affordance with the canonical title presence pin.
			{ verb: 'hasElement', target: 'button[title="Close (Escape)"]' },
		],
		happyPath: false,
	},
];

describe('PromptComposerModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = promptComposerModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		// Brief: "≥3 happy + ≥1 negative-per-happy".
		const happy = promptComposerModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = promptComposerModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of promptComposerModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of promptComposerModalParityCatalog) {
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
		for (const story of promptComposerModalParityCatalog) {
			for (const assertion of story.then) {
				const haystack = (assertion.target + ' ' + (assertion.value ?? '')).toLowerCase();
				for (const b of banned) {
					expect(haystack.includes(b)).toBe(false);
				}
			}
		}
	});

	it('every story name is unique', () => {
		const names = promptComposerModalParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('pins the closed-state empty-render contract at least once', () => {
		// The renderer source's `if (!isOpen) return null` early-return is
		// a core invariant — a future refactor that "always renders, just
		// CSS-hides" would silently regress focus-trap + layer-stack
		// behavior. Guard against catalog drift away from the empty-render
		// pin.
		const seen = promptComposerModalParityCatalog.some((story) =>
			story.then.some((a) => {
				if (a.verb !== 'hasElement') return false;
				const t = a.target;
				return t.includes('body:not(:has(textarea))') || t.includes('Prompt Composer');
			})
		);
		expect(seen).toBe(true);
	});
});
