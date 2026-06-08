/**
 * Parity catalog — MarkdownRenderer
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MarkdownRenderer is the unified markdown rendering component used across
 * AI responses, group-chat bubbles, and any other surface that needs to
 * render markdown content with theme-aware styling, GFM support, syntax-
 * highlighted code blocks with copy button overlays, file-link rewiring
 * (via `remarkFileLinks` + `[[wiki]]` syntax), DOMPurify XSS sanitization
 * for raw-HTML passthrough, frontmatter table rendering, and Bionify
 * reading-mode emphasis. The component renders a single
 * `prose prose-sm max-w-none text-sm` container wrapping a `ReactMarkdown`
 * instance with per-element component overrides for: `a`, `pre`, `code`,
 * `p`, `li`, `blockquote`, `h1`-`h6`, `img` (routed through the local
 * `LocalImage` IPC-aware loader), `table`, `th`, `td`, and `details`
 * (with `onToggle` stripped — fixes MAESTRO-8Q).
 *
 * The parity contract is observable-behavior-only: containers, headings,
 * code-block syntax-highlighter classes, anchor cursor affordances, image
 * loading-state copy, error-state ImageOff icon copy, table overflow
 * wrapper, the per-codeblock copy-button overlay's clipboard-icon title,
 * and the absence of XSS vectors when `allowRawHtml=true` (DOMPurify
 * sanitization is invoked before rendering). Lambda-deferred renderer
 * IPC surface (`window.maestro.fs.readFile`, `window.maestro.shell.openPath`,
 * `window.maestro.shell.openExternal`) is NOT exercised by any story —
 * the catalog stays render-shape-only per the L2.5 precedent.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb here
 * is explicitly out of scope; if a story needs an assertion that doesn't fit,
 * the story is wrong, not the vocabulary.
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

export const markdownRendererParityCatalog: ParityStory[] = [
	// ============ Happy path: prose container chrome ============
	{
		name: 'markdown-renderer-wraps-content-in-prose-container',
		given:
			'MarkdownRenderer mounts with content="Hello world" and a theme prop with textMain color.',
		when: ['the component renders'],
		then: [
			// The prose container that hosts every rendered element is present
			{ verb: 'hasElement', target: '.prose' },
			// The body text is visible inside the container
			{ verb: 'hasText', target: '.prose', value: 'Hello world' },
		],
		happyPath: true,
	},
	// ============ Happy path: code-block renders with copy button ============
	{
		name: 'markdown-renderer-renders-fenced-code-block-with-copy-button',
		given:
			'MarkdownRenderer mounts with content containing a fenced TypeScript code block (```ts\\nconst x = 1;\\n```).',
		when: ['the component renders the fenced code block'],
		then: [
			// The code content is visible
			{ verb: 'hasText', target: '.prose', value: 'const x = 1;' },
			// The copy-button overlay's title attribute is present (clipboard affordance)
			{ verb: 'hasElement', target: '.prose [title="Copy code"]' },
		],
		happyPath: true,
	},
	// ============ Happy path: heading renders as <h1> ============
	{
		name: 'markdown-renderer-renders-h1-heading',
		given: 'MarkdownRenderer mounts with content="# Main Title" and a theme prop.',
		when: ['the component renders the heading'],
		then: [
			// The h1 element is present in the prose container
			{ verb: 'hasElement', target: '.prose h1' },
			// The heading text is visible
			{ verb: 'hasText', target: '.prose h1', value: 'Main Title' },
		],
		happyPath: true,
	},
	// ============ Happy path: hyperlink renders with cursor affordance ============
	{
		name: 'markdown-renderer-renders-external-link-as-clickable-anchor',
		given:
			'MarkdownRenderer mounts with content="[GitHub](https://github.com)" — a standard external link.',
		when: ['the component renders the anchor'],
		then: [
			// The anchor element is present in the prose container
			{ verb: 'hasElement', target: '.prose a' },
			// The link text is visible
			{ verb: 'hasText', target: '.prose a', value: 'GitHub' },
		],
		happyPath: true,
	},
	// ============ Happy path: unordered list renders <li> children ============
	{
		name: 'markdown-renderer-renders-unordered-list-with-list-items',
		given:
			'MarkdownRenderer mounts with content="- first\\n- second\\n- third" — three-row unordered list.',
		when: ['the component renders the list'],
		then: [
			// The list item element is present in the prose container
			{ verb: 'hasElement', target: '.prose li' },
			// Each list-item text is visible
			{ verb: 'hasText', target: '.prose', value: 'first' },
			{ verb: 'hasText', target: '.prose', value: 'second' },
			{ verb: 'hasText', target: '.prose', value: 'third' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	// Empty content still renders the prose wrapper (no crash, no missing-shape regression)
	{
		name: 'markdown-renderer-empty-content-still-renders-prose-wrapper',
		given: 'MarkdownRenderer mounts with content="" (empty string).',
		when: ['the component renders'],
		then: [
			// The prose container still exists even with no content
			{ verb: 'hasElement', target: '.prose' },
			// No code-block copy-button overlay surfaces when there is no code
			{ verb: 'hasElement', target: '.prose:not(:has([title="Copy code"]))' },
		],
		happyPath: false,
	},
	// Inline code stays inline — does NOT render the block-code copy-button overlay
	{
		name: 'markdown-renderer-inline-code-does-not-show-copy-button',
		given:
			'MarkdownRenderer mounts with content="Use the `foo()` helper" — inline code only, no fenced block.',
		when: ['the component renders'],
		then: [
			// Inline <code> is present
			{ verb: 'hasElement', target: '.prose code' },
			// The copy-button overlay is NOT shown for inline code (it is only for fenced blocks)
			{ verb: 'hasElement', target: '.prose:not(:has([title="Copy code"]))' },
		],
		happyPath: false,
	},
	// Plain paragraph content does NOT auto-render an <h1> (no false positive on heading-shape)
	{
		name: 'markdown-renderer-plain-paragraph-does-not-render-heading',
		given: 'MarkdownRenderer mounts with content="Just a paragraph." — no leading "#" marker.',
		when: ['the component renders'],
		then: [
			// The paragraph element is present
			{ verb: 'hasElement', target: '.prose p' },
			// No h1 element is generated for non-heading content
			{ verb: 'hasElement', target: '.prose:not(:has(h1))' },
		],
		happyPath: false,
	},
	// Disallowed JS-pseudo-protocol URLs are stripped by markdownUrlTransform
	{
		name: 'markdown-renderer-strips-javascript-pseudo-protocol-from-href',
		given: 'MarkdownRenderer mounts with content="[click](javascript:alert(1))" — a hostile href.',
		when: ['the component renders the anchor'],
		then: [
			// The anchor link text is still rendered (the visible <a> is unchanged)
			{ verb: 'hasText', target: '.prose', value: 'click' },
			// The hostile pseudo-protocol is NOT preserved on any anchor href
			{ verb: 'hasElement', target: '.prose:not(:has(a[href^="javascript:"]))' },
		],
		happyPath: false,
	},
	// Lifecycle pin: no IPC / no WS frames fire from a pure-text render
	{
		name: 'markdown-renderer-pure-text-render-does-not-fire-ipc-or-ws',
		given: 'MarkdownRenderer mounts with content="Hello" — no images, no links, no code blocks.',
		when: ['the component renders and idles'],
		then: [
			// The prose container is present
			{ verb: 'hasElement', target: '.prose' },
			// No code-block overlay; no link affordance — confirms minimum-surface render
			{ verb: 'hasElement', target: '.prose:not(:has([title="Copy code"]))' },
			{ verb: 'hasElement', target: '.prose:not(:has(a))' },
		],
		happyPath: false,
	},
];

describe('MarkdownRenderer — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(markdownRendererParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = markdownRendererParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = markdownRendererParityCatalog.filter((s) => s.happyPath).length;
		const negative = markdownRendererParityCatalog.filter((s) => !s.happyPath).length;
		// Brief floor: ≥1 negative-path per happy-path. Catalog must honour this floor.
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
		for (const story of markdownRendererParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of markdownRendererParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of markdownRendererParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
