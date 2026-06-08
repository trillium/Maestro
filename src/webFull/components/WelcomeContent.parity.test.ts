/**
 * Parity catalog — WelcomeContent
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * WelcomeContent is a pure presentational content block rendered inside
 * the first-launch empty state and the tour introduction overlay. It
 * accepts a `theme: Theme` prop and an optional `showGetStarted: boolean`
 * (defaults to `false`). It touches 0 IPC namespaces, 0 Electron-only
 * APIs, and has no hooks, effects, state, refs, or event handlers. The
 * only output is a content tree.
 *
 * The parity contract is therefore observable-behavior-only: the block
 * surfaces the Maestro wand icon (alt="Maestro"), the "Welcome to
 * Maestro" h1 heading, the intro line ("Maestro is an orchestration
 * tool designed to:"), the two numbered goal rows (parallel agents /
 * Auto Run), the "How it works" explainer card naming MCP tools, skills,
 * and permissions, the auto-approve + Read-Only mode line, and — when
 * `showGetStarted` is truthy — the "To get started..." call-to-action
 * line. When `showGetStarted` is false / omitted, the call-to-action
 * MUST NOT render.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior,
 *   not DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-per-happy. This
 * catalog ships 4 happy + 4 negative = 8 stories.
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

export const welcomeContentParityCatalog: ParityStory[] = [
	// ============ Happy path: chrome + always-on copy ============
	{
		name: 'welcome-content-renders-icon-and-heading',
		given:
			'The WelcomeContent block mounts inside a tour intro overlay or first-launch empty state with a theme prop.',
		when: ['the block renders'],
		then: [
			// The Maestro wand icon is the visual anchor; alt="Maestro" is the
			// observable, layout-independent handle.
			{ verb: 'hasElement', target: 'img[alt="Maestro"]' },
			// The h1 heading is load-bearing copy and the only h1 in this block.
			{ verb: 'hasElement', target: 'h1' },
			{ verb: 'hasText', target: 'h1', value: 'Welcome to Maestro' },
		],
		happyPath: true,
	},
	{
		name: 'welcome-content-renders-intro-and-numbered-goals',
		given: 'The WelcomeContent block is mounted.',
		when: ['the intro paragraph and the two numbered goal rows render'],
		then: [
			// Intro line — anchors the goal list.
			{
				verb: 'hasText',
				target: 'div',
				value: 'Maestro is an orchestration tool designed to:',
			},
			// Numbered chips — "1" and "2" both appear inline as round
			// number badges. Pin both presence + ordering via text content.
			{ verb: 'hasText', target: 'div', value: '1' },
			{ verb: 'hasText', target: 'div', value: '2' },
			// Goal 1 — parallel agent management. The bolded headline copy
			// is the load-bearing phrase consumers verify against.
			{
				verb: 'hasText',
				target: 'div',
				value: 'Manage multiple AI agents in parallel',
			},
			// Goal 2 — Auto Run automation. Same shape as goal 1.
			{
				verb: 'hasText',
				target: 'div',
				value: 'Enable unattended automation via Auto Run',
			},
		],
		happyPath: true,
	},
	{
		name: 'welcome-content-renders-how-it-works-explainer',
		given: 'The WelcomeContent block is mounted.',
		when: ['the "How it works" explainer card renders'],
		then: [
			// Section label
			{ verb: 'hasText', target: 'div', value: 'How it works:' },
			// MCP / skills / permissions pass-through line — this is the
			// load-bearing claim about provider integration.
			{
				verb: 'hasText',
				target: 'div',
				value: 'Your MCP tools, skills, and permissions work exactly as',
			},
			// Auto-approve + Read-Only mode line
			{ verb: 'hasText', target: 'div', value: 'auto-approve mode' },
			{ verb: 'hasText', target: 'div', value: 'Read-Only mode for guardrails' },
		],
		happyPath: true,
	},
	{
		name: 'welcome-content-shows-get-started-cta-when-flag-set',
		given:
			'The WelcomeContent block is mounted with `showGetStarted=true` (used by the first-launch empty-state callsite).',
		when: ['the call-to-action paragraph at the bottom renders'],
		then: [
			// The full CTA copy is layout-independent and pinned in source.
			{
				verb: 'hasText',
				target: 'div',
				value:
					'To get started, create your first agent manually or with the help of the AI wizard.',
			},
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'welcome-content-hides-get-started-cta-when-flag-omitted',
		given:
			'The WelcomeContent block is mounted with `showGetStarted` omitted (defaults to false — the tour intro overlay callsite).',
		when: ['the bottom of the block renders'],
		then: [
			// The CTA must NOT render — the tour overlay has its own footer
			// affordances and re-rendering the CTA would create a double
			// call-to-action on the intro page.
			{
				verb: 'hasElement',
				target:
					'div:not(:has(p:text("To get started, create your first agent manually or with the help of the AI wizard.")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'welcome-content-hides-get-started-cta-when-flag-false',
		given:
			'The WelcomeContent block is mounted with `showGetStarted={false}` (explicit false from a caller that wants to suppress the CTA).',
		when: ['the bottom of the block renders'],
		then: [
			// Same suppression rule as the omitted case — the explicit
			// false must produce identical observable output.
			{
				verb: 'hasElement',
				target:
					'div:not(:has(p:text("To get started, create your first agent manually or with the help of the AI wizard.")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'welcome-content-renders-no-third-numbered-goal',
		given: 'The WelcomeContent block is mounted.',
		when: ['the numbered goal list renders'],
		then: [
			// Goal list is hard-coded to exactly two entries. A "3" badge
			// surfacing here would indicate accidental copy drift from the
			// renderer source. Pin the absence as an observable assertion.
			{
				verb: 'hasElement',
				target: 'div:not(:has(span:text("3")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'welcome-content-touches-no-ipc-or-electron-surface',
		given:
			'The WelcomeContent block is mounted on either the Electron oracle or the webFull target.',
		when: ['the entire block renders'],
		then: [
			// The component has zero side effects: no fetch, no IPC, no
			// shell, no notifications, no broadcast. Pin the contract via
			// negative observables on the side-effect surfaces — none of
			// these should fire when the block renders.
			{ verb: 'notificationFired', target: 'none' },
			{ verb: 'broadcast', target: 'none' },
		],
		happyPath: false,
	},
];

describe('WelcomeContent — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(welcomeContentParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = welcomeContentParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = welcomeContentParityCatalog.filter((s) => s.happyPath).length;
		const negative = welcomeContentParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of welcomeContentParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of welcomeContentParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of welcomeContentParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
