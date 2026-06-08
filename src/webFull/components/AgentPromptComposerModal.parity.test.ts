/**
 * Parity catalog — AgentPromptComposerModal
 *
 * Layer 2.5 — leaf-parade lift wave
 * (ISC-44.layer-2.5.agent_prompt_composer). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AgentPromptComposerModal is a full-viewport prompt-editor surface used
 * to compose an agent's prompt template prior to invocation. It takes
 * `isOpen`, `onClose`, `theme`, `initialValue`, and `onSubmit`. It
 * touches 0 IPC namespaces and 0 Electron-only APIs. The parity contract
 * is therefore observable-behavior-only: the modal renders its
 * "Agent Prompt Editor" header chrome with the document/file icon, a
 * collapsible "Template Variables" disclosure (collapsed by default), an
 * autoFocused textarea seeded with `initialValue` and the placeholder
 * "Enter your agent prompt... (type {{ for variables)", a footer that
 * shows character + ~token counts and a primary "Done" affordance, and a
 * close (X) button in the header. Persistence + transport are the
 * caller's job — this is a pure presentational surface that delivers
 * its outputs via the `onSubmit` and `onClose` props.
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

export const agentPromptComposerModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'agent-prompt-composer-renders-header-chrome-when-open',
		given:
			'The user has an active agent. AgentPromptComposerModal mounts with isOpen=true, initialValue="", onSubmit=()=>{}, onClose=()=>{}.',
		when: ['the modal mounts'],
		then: [
			// Modal chrome is rendered as a top-level overlay.
			{ verb: 'hasElement', target: 'textarea' },
			// Header text identifies the surface.
			{ verb: 'hasText', target: 'body', value: 'Agent Prompt Editor' },
			// Close button is rendered.
			{ verb: 'hasElement', target: 'button[title="Close (Escape)"]' },
		],
		happyPath: true,
	},
	{
		name: 'agent-prompt-composer-seeds-textarea-with-initialValue',
		given:
			'AgentPromptComposerModal mounts with isOpen=true and initialValue="Summarize {{TAB_NAME}} at {{CWD}}".',
		when: ['the modal renders its textarea'],
		then: [
			// The textarea is present and holds the seed value.
			{ verb: 'hasElement', target: 'textarea' },
			// The seeded text is visible on the surface.
			{ verb: 'hasText', target: 'textarea', value: 'Summarize {{TAB_NAME}} at {{CWD}}' },
		],
		happyPath: true,
	},
	{
		name: 'agent-prompt-composer-shows-template-variables-disclosure-collapsed-by-default',
		given:
			'AgentPromptComposerModal mounts with isOpen=true; the variables disclosure has never been toggled.',
		when: ['the modal mounts (collapsed-by-default state)'],
		then: [
			// The disclosure header is shown.
			{ verb: 'hasText', target: 'body', value: 'Template Variables' },
			// The disclosure is a button (clickable to expand).
			{ verb: 'hasElement', target: 'button' },
		],
		happyPath: true,
	},
	{
		name: 'agent-prompt-composer-renders-footer-with-counts-and-done-affordance',
		given:
			'AgentPromptComposerModal mounts with isOpen=true and initialValue="hello world" (11 characters).',
		when: ['the modal renders its footer row'],
		then: [
			// Character-count label is shown.
			{ verb: 'hasText', target: 'body', value: 'characters' },
			// Token-count label is shown.
			{ verb: 'hasText', target: 'body', value: 'tokens' },
			// Primary commit affordance is rendered.
			{ verb: 'hasText', target: 'button', value: 'Done' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'agent-prompt-composer-renders-nothing-when-isOpen-false',
		given:
			'AgentPromptComposerModal mounts with isOpen=false; all other props supplied with defaults.',
		when: ['the modal would otherwise render'],
		then: [
			// No textarea is present in the document.
			{ verb: 'hasElement', target: 'body:not(:has(textarea))' },
			// The "Agent Prompt Editor" header is not anywhere in the document.
			{
				verb: 'hasElement',
				target: 'body:not(:has(*:has-text("Agent Prompt Editor")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'agent-prompt-composer-omits-variable-grid-while-disclosure-collapsed',
		given:
			'AgentPromptComposerModal mounts with isOpen=true and the variables disclosure has not been expanded.',
		when: ['the modal renders in its initial collapsed state'],
		then: [
			// Disclosure header is still shown.
			{ verb: 'hasText', target: 'body', value: 'Template Variables' },
			// The expansion-only descriptor text is NOT yet in the document.
			{
				verb: 'hasElement',
				target: 'body:not(:has(*:has-text("They will be replaced with actual values at runtime")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'agent-prompt-composer-shows-placeholder-when-initialValue-empty',
		given: 'AgentPromptComposerModal mounts with isOpen=true and initialValue="" (empty string).',
		when: ['the textarea renders with no seed text'],
		then: [
			// The placeholder copy is exposed on the textarea.
			{
				verb: 'hasElement',
				target: 'textarea[placeholder="Enter your agent prompt... (type {{ for variables)"]',
			},
		],
		happyPath: false,
	},
	{
		name: 'agent-prompt-composer-escape-key-closes-when-autocomplete-not-open',
		given:
			'AgentPromptComposerModal is the topmost layer, the textarea has focus, and the template-variable autocomplete dropdown is NOT open.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes via layer stack onEscape -> onSubmit + onClose.
			{ verb: 'hasElement', target: 'body:not(:has(textarea))' },
		],
		happyPath: false,
	},
	{
		name: 'agent-prompt-composer-click-on-backdrop-commits-and-closes',
		given:
			'AgentPromptComposerModal is open with initialValue="draft prompt" and the user clicks the dimmed backdrop region (outside the inner panel).',
		when: ['the backdrop receives a click whose target equals currentTarget'],
		then: [
			// Modal commits via onSubmit and closes — textarea no longer in document.
			{ verb: 'hasElement', target: 'body:not(:has(textarea))' },
		],
		happyPath: false,
	},
];

describe('AgentPromptComposerModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = agentPromptComposerModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = agentPromptComposerModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = agentPromptComposerModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of agentPromptComposerModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of agentPromptComposerModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of agentPromptComposerModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
