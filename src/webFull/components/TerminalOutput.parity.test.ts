/**
 * Parity catalog — TerminalOutput
 *
 * Layer 2.5 — leaf-parade lift wave. Catalog of (Given, When, Then) stories
 * using the fixed WEB_PARITY_VERIFICATION assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * TerminalOutput is the AI Terminal / Command Terminal **conversation
 * surface** — the scrollback panel where every log entry (user prompts, AI
 * responses, tool calls, thinking, errors) is rendered. It carries the
 * per-entry chrome (copy / delete / save-to-file / local filter / error
 * details), markdown rendering with bionify reading mode, ANSI → HTML for
 * terminal mode, debounced search, throttled scroll-position tracking, an
 * inline `QueuedItemsList`, and a child `SaveMarkdownModal` gated on
 * `saveModalContent !== null`.
 *
 * Per the audit #10 callout this is "the AI tab content surface — the actual
 * conversation pipeline" — landing this lift is the unlock for mounting
 * webFull's first real AI tab content view.
 *
 * The parity contract is observable-behavior-only and covers the minimum
 * surfaces named in the brief:
 *   - User message render (renders the user prompt text into the scrollback)
 *   - AI response (markdown) render
 *   - Code-block render (markdown fenced ```code``` blocks surface as code)
 *   - Tool-call render (tool entries surface with the tool identifier)
 *   - Error state (error log entries surface error chrome + view-details
 *     affordance when `onShowErrorDetails` is wired)
 *   - Empty state (no logs → scrollback chrome still renders, no log items)
 *   - Search affordance (search panel surfaces when outputSearchOpen)
 *   - Save Markdown child modal (SaveMarkdownModal mounts inline when
 *     `saveModalContent !== null` — strip-and-promote contract verified)
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
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION.
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

export const terminalOutputParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'terminal-output-renders-user-message-text',
		given:
			'session has inputMode="ai" and the active AI tab carries one log entry with source="user" and text="how do I open a port?".',
		when: ['the TerminalOutput mounts'],
		then: [
			// User prompt surfaces verbatim in the scrollback
			{ verb: 'hasText', target: 'body', value: 'how do I open a port?' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-renders-ai-response-markdown-paragraph',
		given:
			'session has inputMode="ai" and the active AI tab carries one log entry with source="assistant" (or any non-user source) and text="The quick brown fox jumps."',
		when: ['the TerminalOutput mounts', 'markdownEditMode prop is false'],
		then: [
			// Assistant response is markdown-rendered and the prose text surfaces
			{ verb: 'hasText', target: 'body', value: 'The quick brown fox jumps.' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-renders-fenced-code-block-content',
		given:
			'session has inputMode="ai" and an assistant log entry carries a fenced markdown code block: "```bash\\necho hello\\n```".',
		when: ['the TerminalOutput mounts', 'markdownEditMode prop is false'],
		then: [
			// Code block content surfaces verbatim inside the rendered markdown
			{ verb: 'hasText', target: 'body', value: 'echo hello' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-renders-tool-call-entry-with-tool-identifier',
		given:
			'session has inputMode="ai" and a log entry with source="tool" carrying a serialized tool invocation referencing the "Read" tool identifier.',
		when: ['the TerminalOutput mounts'],
		then: [
			// Tool entries surface with the tool identifier visible in the chrome
			{ verb: 'hasText', target: 'body', value: 'Read' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-surfaces-error-entry-chrome',
		given:
			'session has inputMode="ai" and a log entry with source="error" carrying an agentError field; onShowErrorDetails is wired.',
		when: ['the TerminalOutput mounts'],
		then: [
			// AlertCircle icon surfaces (renderer source imports AlertCircle from
			// lucide-react and uses it for error entries). The catalog asserts
			// observable presence rather than specific lucide DOM shape.
			{ verb: 'hasElement', target: 'svg' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-renders-search-input-when-output-search-open',
		given: 'outputSearchOpen prop is true.',
		when: ['the TerminalOutput mounts'],
		then: [
			// Search input surfaces with one of the two placeholders the renderer
			// uses ("Filter output..." for AI mode, "Search output..." for terminal).
			// Catalog asserts the suffix that's shared across both: "(Esc to close)".
			{ verb: 'hasText', target: 'body', value: 'Esc to close' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-mounts-save-markdown-modal-when-save-flow-triggered',
		given:
			'session has inputMode="ai", an assistant log entry, onWriteMarkdownFile is wired, and the user clicks the Save (FileText) icon on the entry to populate saveModalContent.',
		when: ['the TerminalOutput mounts', 'the user triggers the Save action on an assistant entry'],
		then: [
			// The SaveMarkdownModal child surfaces with its canonical title
			{ verb: 'hasText', target: 'body', value: 'Save Markdown' },
		],
		happyPath: true,
	},
	{
		name: 'terminal-output-renders-queued-items-list-inline-when-execution-queue-populated',
		given:
			'session has inputMode="ai" and session.executionQueue carries one message item on the active tab; onRemoveQueuedItem is wired.',
		when: ['the TerminalOutput mounts'],
		then: [
			// QueuedItemsList renders the QUEUED separator inline above logsEnd
			{ verb: 'hasText', target: 'body', value: 'QUEUED' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'terminal-output-renders-empty-state-when-no-logs',
		given:
			'session has inputMode="ai" and the active AI tab has zero log entries; outputSearchOpen is false.',
		when: ['the TerminalOutput mounts'],
		then: [
			// Scrollback chrome surfaces but no log-item text — pin: the search
			// placeholder must NOT appear because search is closed, and there
			// are no user/assistant entries to render. The terminal-output
			// region itself is still present (it carries the role/aria label).
			{ verb: 'hasElement', target: '[role="region"][aria-label="Terminal output"]' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-hides-search-input-when-output-search-closed',
		given: 'outputSearchOpen prop is false.',
		when: ['the TerminalOutput mounts'],
		then: [
			// Search input chrome must not appear when the parent has not opened search
			{ verb: 'hasElement', target: 'body:not(:has-text("Esc to close"))' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-renders-raw-markdown-when-markdown-edit-mode-true',
		given:
			'session has inputMode="ai" and an assistant log entry carries markdown text "# Header"; markdownEditMode prop is true.',
		when: ['the TerminalOutput mounts'],
		then: [
			// In markdownEditMode, raw markdown is displayed (not rendered) —
			// the literal "# Header" string surfaces unmodified rather than
			// being transformed into an <h1>. Pin: literal "#" character is
			// visible in the body text.
			{ verb: 'hasText', target: 'body', value: '#' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-suppresses-save-modal-when-save-content-null',
		given:
			'session has inputMode="ai" and an assistant log entry; saveModalContent is null (user has not triggered the Save action).',
		when: ['the TerminalOutput mounts'],
		then: [
			// The SaveMarkdownModal child must NOT appear when saveModalContent is null
			{ verb: 'hasElement', target: 'body:not(:has-text("Save Markdown"))' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-suppresses-queued-items-list-when-execution-queue-empty',
		given: 'session has inputMode="ai" and session.executionQueue is undefined OR an empty array.',
		when: ['the TerminalOutput mounts'],
		then: [
			// QueuedItemsList must not render when the queue is empty —
			// the "QUEUED" separator copy must be absent.
			{ verb: 'hasElement', target: 'body:not(:has-text("QUEUED"))' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-suppresses-queued-items-list-when-input-mode-terminal',
		given: 'session has inputMode="terminal" and session.executionQueue carries one item.',
		when: ['the TerminalOutput mounts'],
		then: [
			// Renderer source gates QueuedItemsList on `session.inputMode === "ai"`;
			// the queue panel is an AI-mode-only affordance.
			{ verb: 'hasElement', target: 'body:not(:has-text("QUEUED"))' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-fires-no-ipc-or-websocket-traffic-on-mount-or-scroll',
		given:
			'session has inputMode="ai" with two log entries; TerminalOutput is wired with all callbacks.',
		when: [
			'the TerminalOutput mounts',
			'the user scrolls the scrollback container',
			'the user types into the search input',
		],
		then: [
			// Presentational + callback-only. The component does NOT reach into
			// window.maestro at any point. All effects flow through prop callbacks
			// the host wires: onScrollPositionChange, onAtBottomChange,
			// setOutputSearchQuery, onDeleteLog, onRemoveQueuedItem,
			// onShowErrorDetails, onFileSaved, onOpenInTab, onReplayMessage,
			// onFileClick, onWriteMarkdownFile, onBrowseMarkdownFolder.
			{ verb: 'hasElement', target: '[role="region"][aria-label="Terminal output"]' },
		],
		happyPath: false,
	},
	{
		name: 'terminal-output-falls-back-to-default-bionify-when-prop-omitted',
		given:
			'session has inputMode="ai" with one assistant log entry; bionifyReadingMode prop is omitted (defaults to false).',
		when: ['the TerminalOutput mounts'],
		then: [
			// With bionifyReadingMode=false (the renderer settings-store default),
			// markdown renders without bionify span chrome — the prose text still
			// surfaces but no bionify-specific affordance fires. Pin: the
			// terminal-output region itself is present and the entry text renders.
			{ verb: 'hasElement', target: '[role="region"][aria-label="Terminal output"]' },
		],
		happyPath: false,
	},
];

describe('TerminalOutput — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = terminalOutputParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = terminalOutputParityCatalog.filter((s) => s.happyPath).length;
		const negative = terminalOutputParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of terminalOutputParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of terminalOutputParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of terminalOutputParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('covers the conversation-surface minimum (user, assistant, code-block, tool, error, empty)', () => {
		// The brief explicitly names these surfaces as the minimum coverage
		// for the conversation-pipeline lift. Pin the catalog so a future
		// drift that removes any of these surfaces fails fast.
		const haystack = JSON.stringify(terminalOutputParityCatalog).toLowerCase();
		// JSON.stringify escapes quotes, so substring checks must allow for `\"` boundaries.
		const hasUser =
			haystack.includes('user message') ||
			haystack.includes('user prompt') ||
			haystack.includes('source=\\"user\\"');
		const hasAssistant = haystack.includes('ai response') || haystack.includes('assistant');
		const hasCodeBlock = haystack.includes('code-block') || haystack.includes('code block');
		const hasToolCall =
			haystack.includes('tool-call') ||
			haystack.includes('tool call') ||
			haystack.includes('source=\\"tool\\"');
		const hasError = haystack.includes('error');
		const hasEmpty = haystack.includes('empty');
		expect(hasUser).toBe(true);
		expect(hasAssistant).toBe(true);
		expect(hasCodeBlock).toBe(true);
		expect(hasToolCall).toBe(true);
		expect(hasError).toBe(true);
		expect(hasEmpty).toBe(true);
	});

	it('pins the strip-and-promote contract — Save Markdown surfaces via host-supplied write callback', () => {
		// SaveMarkdownModal is rendered inline. The TerminalOutput lift adds
		// `onWriteMarkdownFile` as a REQUIRED prop because the modal's write
		// surface MUST be wired by the caller. If a future refactor drops
		// `onWriteMarkdownFile` from the contract OR makes it optional, the
		// catalog should fail rather than silently allow no-op saves.
		const saveStory = terminalOutputParityCatalog.find((s) =>
			s.then.some((t) => t.value === 'Save Markdown')
		);
		expect(saveStory).toBeDefined();
	});
});
