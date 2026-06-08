/**
 * Parity catalog — ErrorBoundary
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ErrorBoundary is a React class component that catches errors thrown in
 * its child tree via `componentDidCatch` + `getDerivedStateFromError`. It
 * accepts `children`, an optional `fallbackComponent` for caller-provided
 * fallback UI, and an optional `onReset` callback. It touches 0 IPC
 * namespaces and 0 Electron-only APIs (`@sentry/electron/renderer` was
 * swapped for the webFull-side `captureException` from `../utils/sentry`,
 * and the renderer's `logger` was swapped for the webFull `webLogger`
 * with the same `error(message, context?, data?)` signature).
 *
 * The parity contract is therefore observable-behavior-only: the boundary
 * is invisible while no error has been thrown (children render through
 * untouched), and on error swaps to either the supplied `fallbackComponent`
 * verbatim OR the default error UI (full-viewport centered card with
 * AlertTriangle header, "Something went wrong" h1, the explanatory body,
 * an "Error Details:" block when `state.error` is non-null, a collapsible
 * "Component Stack Trace" `<details>` block when `state.errorInfo` is
 * non-null, and a Try Again / Reload App button pair).
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
 *
 * Render-shape vocabulary: this catalog uses only `hasElement` and
 * `hasText` plus the lifecycle-pin verbs (`wsFrameMatches`, `broadcast`,
 * `notificationFired`) on the no-IPC story — click semantics belong to
 * feature-consumer catalogs (the host that mounts an ErrorBoundary around
 * a tab / panel / route is the one that exercises the Try Again /
 * Reload App buttons end-to-end). Matches the SettingCheckbox /
 * ToggleButtonGroup / SessionListItem / CollapsibleJsonViewer L2.5
 * precedent.
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

export const errorBoundaryParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'error-boundary-renders-default-fallback-card-after-child-throws',
		given:
			'An ErrorBoundary wraps a child component that throws `new Error("kaboom")` on its first render. No `fallbackComponent` prop is supplied. The boundary mounts, the child throws synchronously inside render, and `getDerivedStateFromError` + `componentDidCatch` fire.',
		when: ['the boundary swaps to its fallback render after the synchronous throw'],
		then: [
			// The default error card surfaces the "Something went wrong" h1.
			{ verb: 'hasText', target: 'h1', value: 'Something went wrong' },
			// The explanatory body is shown.
			{
				verb: 'hasText',
				target: 'body',
				value: 'An unexpected error occurred in the application.',
			},
			// Two action buttons are rendered (Try Again + Reload App).
			{ verb: 'hasElement', target: 'button' },
		],
		happyPath: true,
	},
	{
		name: 'error-boundary-surfaces-error-message-in-error-details-block',
		given:
			'An ErrorBoundary wraps a child that throws `new Error("API key has expired")` on first render. No `fallbackComponent` is supplied. The boundary catches the error and renders the default fallback UI.',
		when: ['the boundary renders the "Error Details:" block after catching the throw'],
		then: [
			// The "Error Details:" label heading is shown.
			{ verb: 'hasText', target: 'body', value: 'Error Details:' },
			// The thrown error message is rendered inside the details block.
			{ verb: 'hasText', target: 'body', value: 'API key has expired' },
			// A <pre> block is used to render the error toString.
			{ verb: 'hasElement', target: 'pre' },
		],
		happyPath: true,
	},
	{
		name: 'error-boundary-exposes-component-stack-trace-details-when-errorInfo-present',
		given:
			'An ErrorBoundary wraps a child that throws on first render. React passes a non-null `errorInfo` with a populated `componentStack` to `componentDidCatch`, so the boundary stores `errorInfo` in state via `setState({ error, errorInfo })`.',
		when: ['the boundary renders the collapsible Component Stack Trace block'],
		then: [
			// The <details> summary heading is shown.
			{ verb: 'hasText', target: 'body', value: 'Component Stack Trace' },
			// The trace is wrapped in a <details> element.
			{ verb: 'hasElement', target: 'details' },
			// The <summary> is reachable inside the <details>.
			{ verb: 'hasElement', target: 'details summary' },
		],
		happyPath: true,
	},
	{
		name: 'error-boundary-renders-recovery-action-buttons-pair',
		given:
			'An ErrorBoundary in its post-error fallback render. The default UI ships two action buttons: "Try Again" (blue, resets the boundary state via `handleReset`) and "Reload App" (gray, calls `window.location.reload()` via `handleReload`).',
		when: ['the boundary renders the recovery-action button row'],
		then: [
			// Both labels are present.
			{ verb: 'hasText', target: 'body', value: 'Try Again' },
			{ verb: 'hasText', target: 'body', value: 'Reload App' },
			// Both are rendered as <button> elements.
			{ verb: 'hasElement', target: 'button' },
		],
		happyPath: true,
	},
	{
		name: 'error-boundary-renders-supplied-fallbackComponent-verbatim-when-error-thrown',
		given:
			'An ErrorBoundary mounts with `fallbackComponent={<div data-testid="caller-fallback">Caller-owned fallback copy</div>}` and a child that throws on first render. The caller-supplied fallback short-circuits the default error card entirely.',
		when: ['the boundary swaps to its render path after catching the throw'],
		then: [
			// The caller's fallback content is rendered.
			{ verb: 'hasText', target: 'body', value: 'Caller-owned fallback copy' },
			// The caller's data-testid is reachable.
			{ verb: 'hasElement', target: '[data-testid="caller-fallback"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'error-boundary-renders-children-unchanged-when-no-error-thrown',
		given:
			'An ErrorBoundary wraps `<div data-testid="happy-child">Hello world</div>`. No throw occurs anywhere in the tree; `state.hasError` stays false for the lifetime of the mount.',
		when: ['the boundary completes its initial render with hasError=false'],
		then: [
			// Children pass through untouched.
			{ verb: 'hasText', target: 'body', value: 'Hello world' },
			// The caller child node is directly reachable.
			{ verb: 'hasElement', target: '[data-testid="happy-child"]' },
			// The default error card chrome is NOT emitted while hasError=false.
			// Selector pins absence-of-error-card via :not(:has(...)).
			{
				verb: 'hasElement',
				target: 'body:not(:has(h1:has-text("Something went wrong")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'error-boundary-omits-error-details-block-when-state-error-null',
		given:
			'An ErrorBoundary in a hypothetical post-`getDerivedStateFromError` state where `hasError=true` but `state.error` was cleared back to null before render (rare, but the source guards via `{this.state.error && (...)}`). The default fallback UI still renders.',
		when: ['the boundary renders the fallback card with state.error=null'],
		then: [
			// The "Something went wrong" header still renders.
			{ verb: 'hasText', target: 'body', value: 'Something went wrong' },
			// The Error Details: block is NOT rendered when state.error is null.
			{
				verb: 'hasElement',
				target: 'body:not(:has(h2:has-text("Error Details:")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'error-boundary-omits-component-stack-trace-details-when-errorInfo-null',
		given:
			'An ErrorBoundary in the `getDerivedStateFromError`-derived state where `hasError=true` and `state.error` is set but `state.errorInfo` is still null (i.e. before `componentDidCatch` fires, the catch path sets errorInfo to null per the source). The default fallback UI renders without the stack trace block.',
		when: ['the boundary renders the fallback card with errorInfo=null'],
		then: [
			// Error Details: block is still rendered when state.error is set.
			{ verb: 'hasText', target: 'body', value: 'Error Details:' },
			// The Component Stack Trace <details> is NOT rendered while errorInfo is null.
			// The source guards via `{this.state.errorInfo && (...)}`.
			{
				verb: 'hasElement',
				target: 'body:not(:has(summary:has-text("Component Stack Trace")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'error-boundary-default-card-suppressed-when-fallbackComponent-supplied',
		given:
			'An ErrorBoundary mounts with `fallbackComponent={<div>Custom fallback</div>}` and a child that throws on first render. The fallback short-circuits the default error card entirely so the "Something went wrong" header, Error Details block, and Try Again / Reload App row never render.',
		when: ['the boundary renders the caller-supplied fallback'],
		then: [
			// Caller fallback content is shown.
			{ verb: 'hasText', target: 'body', value: 'Custom fallback' },
			// The default "Something went wrong" header is NOT rendered.
			{
				verb: 'hasElement',
				target: 'body:not(:has(h1:has-text("Something went wrong")))',
			},
			// Neither default recovery action button is rendered.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button:has-text("Try Again")))',
			},
			{
				verb: 'hasElement',
				target: 'body:not(:has(button:has-text("Reload App")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'error-boundary-pure-render-emits-no-ws-no-ipc-no-notifications',
		given:
			'An ErrorBoundary completes one full render cycle for both branches (children-pass-through and post-error fallback). The component owns no `useEffect`, no `componentDidMount` side effects beyond the `componentDidCatch` logger.error / Sentry capture path, and no event-emitter wiring. No WebSocket frames are sent, no IPC bridge methods are invoked at module-load time, and no system notifications fire from the boundary itself.',
		when: ['the boundary mounts, renders, and possibly swaps to the fallback'],
		then: [
			// Lifecycle pins on the no-IPC / no-WS / no-notification contract.
			{ verb: 'wsFrameMatches', target: 'none', value: 'no-frames-emitted' },
			{ verb: 'broadcast', target: 'none', value: 'no-broadcasts-emitted' },
			{ verb: 'notificationFired', target: 'none', value: 'no-notifications-fired' },
		],
		happyPath: false,
	},
];

describe('ErrorBoundary — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = errorBoundaryParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = errorBoundaryParityCatalog.filter((s) => s.happyPath).length;
		const negative = errorBoundaryParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of errorBoundaryParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of errorBoundaryParityCatalog) {
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
			'dialog.',
			'tunnel.',
			'ipcrenderer',
		];
		for (const story of errorBoundaryParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('happy-path stories use only render-shape verbs (hasElement / hasText)', () => {
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of errorBoundaryParityCatalog.filter((s) => s.happyPath)) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
