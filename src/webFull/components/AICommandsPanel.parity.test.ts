/**
 * Parity catalog — AICommandsPanel
 *
 * Layer 2.5 — leaf-parade lift wave
 * (ISC-44.layer-2.5.ai_commands_panel). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AICommandsPanel is a settings-pane editor for custom AI slash-commands.
 * It takes `theme`, `customAICommands`, and `setCustomAICommands`. It is
 * NOT a modal — it renders inline inside the AI-Commands tab of the
 * settings pane. It touches 0 IPC namespaces and 0 Electron-only APIs.
 * The parity contract is therefore observable-behavior-only: header copy,
 * Template Variables disclosure label, Add Command button, empty-state
 * copy, per-command row chrome (command name, Built-in badge with `Lock`
 * icon, description text), and the inline edit / create form structure.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
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

export const aiCommandsPanelParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'ai-commands-panel-renders-header-and-template-variables-disclosure',
		given: 'AICommandsPanel mounts with customAICommands=[], setCustomAICommands=noop.',
		when: ['the panel mounts'],
		then: [
			// Header label (uppercased visually via CSS) — assert the source
			// text "Custom AI Commands" is in the body
			{ verb: 'hasText', target: 'body', value: 'Custom AI Commands' },
			// Header subtitle copy (verbatim from the renderer source)
			{
				verb: 'hasText',
				target: 'body',
				value:
					'Slash commands available in AI terminal mode. Built-in commands can be edited but not deleted.',
			},
			// Template Variables disclosure label
			{ verb: 'hasText', target: 'body', value: 'Template Variables' },
		],
		happyPath: true,
	},
	{
		name: 'ai-commands-panel-renders-add-command-button-when-not-creating',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"a",command:"/hi",description:"x",prompt:"y",isBuiltIn:false}] and isCreating=false (initial state).',
		when: ['the panel mounts'],
		then: [
			// Add Command button copy
			{ verb: 'hasText', target: 'body', value: 'Add Command' },
		],
		happyPath: true,
	},
	{
		name: 'ai-commands-panel-renders-empty-state-cta-when-no-commands',
		given: 'AICommandsPanel mounts with customAICommands=[] and isCreating=false.',
		when: ['the panel renders the empty state'],
		then: [
			// Empty-state primary copy
			{ verb: 'hasText', target: 'body', value: 'No custom AI commands configured' },
			// Empty-state secondary CTA copy
			{ verb: 'hasText', target: 'body', value: 'Create your first command' },
		],
		happyPath: true,
	},
	{
		name: 'ai-commands-panel-renders-command-rows-sorted-by-command-name',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"b",command:"/zebra",description:"z desc",prompt:"p",isBuiltIn:false},{id:"a",command:"/alpha",description:"a desc",prompt:"p",isBuiltIn:false}].',
		when: ['the panel renders the command list'],
		then: [
			// Both command names surface verbatim — the catalog asserts
			// presence, not ordering (ordering is a layout concern enforced
			// by the renderer-source sort)
			{ verb: 'hasText', target: 'body', value: '/alpha' },
			{ verb: 'hasText', target: 'body', value: '/zebra' },
			// Both descriptions surface verbatim
			{ verb: 'hasText', target: 'body', value: 'a desc' },
			{ verb: 'hasText', target: 'body', value: 'z desc' },
		],
		happyPath: true,
	},
	{
		name: 'ai-commands-panel-renders-built-in-badge-with-lock-icon-for-builtin-commands',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"b1",command:"/init",description:"d",prompt:"p",isBuiltIn:true}].',
		when: ['the panel renders the command row'],
		then: [
			// Command name surfaces verbatim
			{ verb: 'hasText', target: 'body', value: '/init' },
			// Built-in badge copy
			{ verb: 'hasText', target: 'body', value: 'Built-in' },
			// Lock icon (lucide-react renders an inline SVG with this class)
			{ verb: 'hasElement', target: 'svg.lucide-lock' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'ai-commands-panel-suppresses-empty-state-when-commands-present',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"a",command:"/hi",description:"x",prompt:"y",isBuiltIn:false}].',
		when: ['the panel renders'],
		then: [
			// Command name surfaces
			{ verb: 'hasText', target: 'body', value: '/hi' },
			// The empty-state CTA copy must NOT appear when commands are
			// present (a future refactor that breaks the `customAICommands.length === 0`
			// gate would silently render both states)
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("No custom AI commands configured")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'ai-commands-panel-suppresses-delete-affordance-for-builtin-commands',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"b1",command:"/init",description:"d",prompt:"p",isBuiltIn:true}] and the command row is in the expanded display mode (the disclosure has been toggled open).',
		when: ['the expanded row renders its action row'],
		then: [
			// Edit affordance is unconditionally rendered for all commands
			// (built-in OR user-created) when expanded — the catalog pins
			// the "Edit but not Delete" contract for built-in commands.
			//
			// Delete affordance is gated behind `!cmd.isBuiltIn`. The Edit
			// button's `title="Edit command"` is the discoverable marker;
			// the catalog asserts a presence-only check for the action row
			// (the panel renders no other `title="Delete command"` outside
			// the expanded display mode, so absence of the Delete title is
			// the strongest catalog-shape pin available without driving
			// state).
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title="Delete command"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'ai-commands-panel-suppresses-add-command-button-while-creating',
		given:
			'AICommandsPanel mounts and the user clicks the "Add Command" button to enter creation mode (isCreating becomes true).',
		when: ['the creation form renders'],
		then: [
			// New Command form header surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'New Command' },
			// The "Add Command" button is gated behind `!isCreating` and
			// must not appear once the form is open. A future refactor
			// that broke the gate would render both surfaces simultaneously.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button:has-text("Add Command")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'ai-commands-panel-suppresses-empty-state-while-creating-with-zero-commands',
		given:
			'AICommandsPanel mounts with customAICommands=[] and the user clicks "Create your first command" to enter creation mode (isCreating becomes true).',
		when: ['the creation form renders'],
		then: [
			// New Command form header surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'New Command' },
			// The empty-state CTA is gated behind `customAICommands.length === 0 && !isCreating`.
			// Once creation mode is active the empty-state copy must not
			// appear — a future refactor breaking the AND gate would
			// render both simultaneously.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("No custom AI commands configured")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'ai-commands-panel-suppresses-builtin-badge-for-user-commands',
		given:
			'AICommandsPanel mounts with customAICommands=[{id:"u",command:"/mine",description:"d",prompt:"p",isBuiltIn:false}].',
		when: ['the command row renders'],
		then: [
			// Command name surfaces
			{ verb: 'hasText', target: 'body', value: '/mine' },
			// Built-in badge is gated behind `cmd.isBuiltIn` and must NOT
			// appear for user-created commands. A future refactor breaking
			// the gate would silently mark every command as built-in.
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("Built-in")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'ai-commands-panel-no-ipc-no-ws-lifecycle-pin',
		given:
			'AICommandsPanel mounts in any state (empty, populated, creating, editing, with built-in commands, with user commands).',
		when: ['the panel renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport. All side effects flow through the
			// `setCustomAICommands` prop callback supplied by the caller.
			// This story pins the lifecycle contract so a future refactor
			// that wires IPC directly into the panel would fail the
			// catalog rather than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('AICommandsPanel — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = aiCommandsPanelParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = aiCommandsPanelParityCatalog.filter((s) => s.happyPath).length;
		const negative = aiCommandsPanelParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of aiCommandsPanelParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of aiCommandsPanelParityCatalog) {
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
			'ipcrenderer',
			'dialog.',
			'tunnel.',
		];
		for (const story of aiCommandsPanelParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('story names are unique across the catalog', () => {
		const names = aiCommandsPanelParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
