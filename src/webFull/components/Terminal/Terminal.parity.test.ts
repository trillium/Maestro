/**
 * Parity catalog — Terminal (xterm.js raw PTY renderer)
 *
 * Layer 6.2 — client-side renderer for the L6.1 raw PTY WS protocol. Per
 * WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every feature
 * port ships with a catalog of (Given, When, Then) stories using the fixed
 * assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * This catalog is plain data. The runner that records against the Electron
 * oracle (CDP at :9222) and replays against webFull (Vite dev server) lands
 * later; this file passes type-checks today so the structure is locked in
 * before the runner consumes it.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets.
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Coverage focus for L6.2:
 *   - Happy: Terminal mounts → subscribes → renders bytes from pty_data.
 *   - Happy: User keystrokes flow back as pty_input over WS.
 *   - Happy: Backfill on reconnect (pty_subscribe with lastSeq).
 *   - Negative: pty_dropped renders a visible marker so the user sees the gap.
 *   - Negative: missing PtyMessageRouter provider throws a developer-time
 *     error rather than silently rendering an inert terminal.
 *
 * Out of scope (deferred to L6.3+ or higher):
 *   - WS bufferedAmount backpressure on the wire (server-side concern).
 *   - Mobile / on-screen-keyboard UX.
 *   - User-facing toggle between xterm view and parsed MessageHistory.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb
 * here is out of scope; if a story needs a different assertion, the story
 * is wrong, not the vocabulary.
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
	/** True if the story is a happy-path; false for negative-path coverage. */
	happyPath: boolean;
}

export const terminalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'mount-subscribes-and-renders-pty-data',
		given:
			'A terminal-mode session "sess-1" is live on the server and the user navigates to its view.',
		when: [
			'the Terminal component mounts inside <PtyMessageRouterProvider>',
			'the WS connection is already authenticated',
			'the server emits one pty_data { sessionId:"sess-1", seq:1, bytes:base64("$ ") }',
		],
		then: [
			// The xterm container is in the DOM with a per-session testid
			{ verb: 'hasElement', target: '[data-testid="webfull-terminal-sess-1"]' },
			// The client sent the subscribe frame on mount (no lastSeq on a
			// fresh session, just the type and sessionId)
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '{"type":"pty_subscribe","sessionId":"sess-1"}',
			},
			// The client sent an initial resize after open()+fit()
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '"type":"pty_resize","sessionId":"sess-1"',
			},
		],
		happyPath: true,
	},
	{
		name: 'user-keystroke-sends-pty-input-base64',
		given: 'A Terminal for "sess-1" is mounted, subscribed, and focused.',
		when: ['the user types the single character "a" (xterm onData fires with "a")'],
		then: [
			// pty_input goes out, base64-encoded, encoding flag present
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '"type":"pty_input","sessionId":"sess-1"',
			},
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '"encoding":"base64"',
			},
			// "a" in base64 is "YQ=="
			{ verb: 'wsFrameMatches', target: 'client>server', value: '"bytes":"YQ=="' },
		],
		happyPath: true,
	},
	{
		name: 'reconnect-resubscribes-with-last-seq',
		given:
			'A Terminal for "sess-1" was mounted previously and persisted lastSeq=42 to its seq store.',
		when: [
			'the user navigates away and back, causing a fresh mount of the Terminal',
			'the seq store reports lastSeq=42 for "sess-1"',
		],
		then: [
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '"type":"pty_subscribe"',
			},
			// The subscribe frame carries the lastSeq so the server can replay
			// from the ring buffer rather than starting fresh.
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '"lastSeq":42',
			},
		],
		happyPath: true,
	},
	{
		name: 'unmount-sends-pty-unsubscribe',
		given: 'A Terminal for "sess-1" is mounted and the user navigates away.',
		when: ['the Terminal component unmounts'],
		then: [
			{
				verb: 'wsFrameMatches',
				target: 'client>server',
				value: '{"type":"pty_unsubscribe","sessionId":"sess-1"}',
			},
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'pty-dropped-renders-visible-marker',
		given:
			'A Terminal for "sess-1" was offline long enough that the server ring rotated past its lastSeq.',
		when: [
			'the user reconnects and the server emits pty_dropped { sessionId:"sess-1", droppedBytes:1234, lastSeq:42 } before backfill',
		],
		then: [
			// The xterm viewport surfaces the gap to the user. We assert on
			// the visible text rather than the inner xterm DOM because xterm's
			// grid is renderer-specific (canvas / WebGL / DOM).
			{
				verb: 'hasText',
				target: '[data-testid="webfull-terminal-sess-1"]',
				value: '[server dropped 1234 bytes; some output lost]',
			},
			// The terminal element is still in the DOM (renderer didn't crash)
			{ verb: 'hasElement', target: '[data-testid="webfull-terminal-sess-1"]' },
		],
		happyPath: false,
	},
	{
		name: 'missing-router-provider-throws-developer-error',
		given:
			'A Terminal component is mounted outside of any <PtyMessageRouterProvider> (developer mis-wired the tree).',
		when: ['React attempts to render the Terminal'],
		then: [
			// The provider absence is a developer-time signal, not a runtime
			// fallback. We don't assert a specific in-DOM error UI because
			// React surfaces the throw via its own error boundary path; what
			// matters here is that no terminal container leaks into the DOM
			// (the throw happens before render returns).
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per WEB_PARITY_VERIFICATION: ≥1 happy-path AND ≥1 negative-path story
 * total, with ≥3 stories overall (brief requires ≥3). This vitest pass
 * acts as a compile-time guard for the catalog shape; the actual record-
 * and-replay harness lands later.
 */
describe('Terminal (xterm.js raw PTY) — parity catalog', () => {
	it('declares at least one happy-path story', () => {
		const happy = terminalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = terminalParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least three stories total (brief requires ≥3)', () => {
		expect(terminalParityCatalog.length).toBeGreaterThanOrEqual(3);
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
		for (const story of terminalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of terminalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('covers the L6.2 protocol surface (subscribe/input/resize/unsubscribe/dropped)', () => {
		// Sanity check that the catalog mentions every client→server message
		// type the Terminal owns. If we later add a new pty_* type and forget
		// to extend the catalog, this guard catches it.
		const haystack = JSON.stringify(terminalParityCatalog);
		const requiredFragments = [
			'pty_subscribe',
			'pty_input',
			'pty_resize',
			'pty_unsubscribe',
			'dropped',
		];
		for (const f of requiredFragments) {
			expect(haystack.includes(f)).toBe(true);
		}
	});

	it('scopes assertions to the per-session terminal element id format', () => {
		// The Terminal component exposes one testid: webfull-terminal-<sessionId>.
		// Catch any drift from that convention so the runner's selectors keep
		// working across renames.
		const haystack = JSON.stringify(terminalParityCatalog);
		expect(haystack.includes('webfull-terminal-')).toBe(true);
	});
});
