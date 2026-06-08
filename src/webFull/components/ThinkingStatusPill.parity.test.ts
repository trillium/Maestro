/**
 * Parity catalog — ThinkingStatusPill
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ThinkingStatusPill is a pure UI primitive — it renders a centered pill above
 * the input area whenever the AI is actively processing on at least one
 * (session, tab) pair. The caller hands it a pre-filtered `thinkingItems`
 * array (the comparator gate is part of the observable performance contract,
 * not the parity contract). The component multiplexes three observable shapes:
 *
 *   1. AutoRun mode — when `autoRunState?.isRunning` is true, the
 *      `AutoRunPill` sub-component renders instead, surfacing total elapsed
 *      time, the `<completed>/<total>` task counter, the optional worktree
 *      indicator (lucide `GitBranch` icon), and an optional Stop button.
 *   2. Thinking mode — when `thinkingItems.length > 0` and AutoRun is off,
 *      the main pill renders the primary item: Maestro session name + token
 *      count (or "Thinking..." placeholder when zero) + elapsed time + the
 *      Claude session ID / custom name / tab name button. When more than one
 *      tab is thinking, a `+N` hover-gated dropdown lists every thinking
 *      item.
 *   3. Idle mode — when AutoRun is off AND `thinkingItems` is empty, the
 *      component renders nothing (null).
 *
 * The component touches 0 IPC namespaces at module load (pre-flight grep
 * `grep -n "window\.maestro\|window\.electron\|ipcRenderer\|window\.api"
 * src/renderer/components/ThinkingStatusPill.tsx` → empty). All side effects
 * are threaded out via the `onSessionClick`, `onStopAutoRun`, and
 * `onInterrupt` callback props.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per happy-path
 * story → minimum 3 happy + 3 negative. This catalog ships 5 happy + 5
 * negative = 10 stories — bigger surface gets bigger coverage.
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

export const thinkingStatusPillParityCatalog: ParityStory[] = [
	// ============ Happy path: primary thinking pill renders ============
	{
		name: 'thinking-pill-shows-session-name-and-thinking-placeholder-with-zero-tokens',
		given:
			'A single AI session is in `busy` state with `currentCycleTokens=0` and `thinkingStartTime=null`. The caller supplies a single ThinkingItem for that session.',
		when: [
			'the ThinkingStatusPill mounts with thinkingItems=[{session: {name:"alpha", currentCycleTokens:0}, tab:null}] and autoRunState undefined',
		],
		then: [
			// Pill renders the Maestro session name verbatim
			{ verb: 'hasText', target: 'body', value: 'alpha' },
			// "Thinking..." placeholder shows when tokens=0
			{ verb: 'hasText', target: 'body', value: 'Thinking...' },
		],
		happyPath: true,
	},
	{
		name: 'thinking-pill-shows-token-count-when-currentCycleTokens-is-positive',
		given:
			'A single AI session is busy with `currentCycleTokens=1250` and `thinkingStartTime=null`.',
		when: ['the ThinkingStatusPill mounts with thinkingItems=[{session, tab:null}]'],
		then: [
			// "Tokens:" label is present
			{ verb: 'hasText', target: 'body', value: 'Tokens:' },
			// Formatted token count is rendered (1250 → "1.3K" via formatTokensCompact)
			{ verb: 'hasText', target: 'body', value: '1.3K' },
			// "Thinking..." placeholder is suppressed
			{ verb: 'hasElement', target: 'body:not(:has-text("Thinking..."))' },
		],
		happyPath: true,
	},
	{
		name: 'thinking-pill-shows-elapsed-time-when-thinkingStartTime-is-set',
		given:
			'A single AI session is busy with `thinkingStartTime` set to roughly five seconds before mount.',
		when: ['the ThinkingStatusPill mounts with thinkingItems=[{session, tab:null}]'],
		then: [
			// "Elapsed:" label is present
			{ verb: 'hasText', target: 'body', value: 'Elapsed:' },
			// The mm:ss formatter renders a "0m 5s"-shaped string (lower-bound — the
			// interval may have advanced; "0m" + "s" alone are the stable anchors)
			{ verb: 'hasText', target: 'body', value: '0m' },
		],
		happyPath: true,
	},
	{
		name: 'thinking-pill-prioritises-active-session-as-primary-when-multiple-items-think',
		given:
			'Two AI sessions are busy. The caller threads activeSessionId="beta" so the pill should surface session "beta" as the primary even though "alpha" is first in the array.',
		when: [
			'the ThinkingStatusPill mounts with thinkingItems=[{session:{id:"alpha",name:"alpha"}, tab:null}, {session:{id:"beta",name:"beta"}, tab:null}] and activeSessionId="beta"',
		],
		then: [
			// The primary slot shows "beta" — i.e. "beta" appears in the rendered output
			{ verb: 'hasText', target: 'body', value: 'beta' },
			// The +N indicator shows the remaining count for the non-primary item
			{ verb: 'hasText', target: 'body', value: '+1' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-pill-replaces-thinking-pill-when-autoRunState-isRunning',
		given:
			'autoRunState={isRunning:true, completedTasks:3, totalTasks:7, startTime: now-60s, isStopping:false} is supplied. thinkingItems is empty.',
		when: ['the ThinkingStatusPill mounts with autoRunState as above and thinkingItems=[]'],
		then: [
			// AutoRun label is present (not the thinking placeholder)
			{ verb: 'hasText', target: 'body', value: 'AutoRun' },
			// "Tasks:" counter is present with the "3/7" progress
			{ verb: 'hasText', target: 'body', value: 'Tasks:' },
			{ verb: 'hasText', target: 'body', value: '3/7' },
			// "Elapsed:" label is present
			{ verb: 'hasText', target: 'body', value: 'Elapsed:' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'thinking-pill-renders-nothing-when-thinkingItems-empty-and-no-autorun',
		given: 'No sessions are thinking and AutoRun is inactive.',
		when: ['the ThinkingStatusPill mounts with thinkingItems=[] and autoRunState undefined'],
		then: [
			// No "Thinking..." placeholder
			{ verb: 'hasElement', target: 'body:not(:has-text("Thinking..."))' },
			// No "AutoRun" pill
			{ verb: 'hasElement', target: 'body:not(:has-text("AutoRun"))' },
			// No "+N" overflow indicator
			{ verb: 'hasElement', target: 'body:not(:has-text("+1"))' },
		],
		happyPath: false,
	},
	{
		name: 'thinking-pill-hides-plus-n-indicator-when-only-one-item-thinks',
		given: 'Exactly one AI session is busy. activeSessionId is undefined.',
		when: ['the ThinkingStatusPill mounts with thinkingItems=[{session:{name:"alpha"}, tab:null}]'],
		then: [
			// The session name is present
			{ verb: 'hasText', target: 'body', value: 'alpha' },
			// No +N indicator
			{ verb: 'hasElement', target: 'body:not(:has-text("+1"))' },
			{ verb: 'hasElement', target: 'body:not(:has-text("+2"))' },
		],
		happyPath: false,
	},
	{
		name: 'thinking-pill-hides-stop-button-when-onInterrupt-not-provided',
		given: 'A single AI session is busy and the caller does NOT supply an onInterrupt callback.',
		when: ['the ThinkingStatusPill mounts without onInterrupt'],
		then: [
			// Pill renders
			{ verb: 'hasText', target: 'body', value: 'alpha' },
			// No interrupt button — the documented title attribute is absent
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Interrupt Claude (Ctrl+C)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-pill-shows-stopping-state-when-isStopping-true',
		given:
			'autoRunState={isRunning:true, isStopping:true, completedTasks:2, totalTasks:5, startTime: now-30s}. An onStopAutoRun callback is provided.',
		when: ['the ThinkingStatusPill mounts with autoRunState as above'],
		then: [
			// Stopping label replaces plain "AutoRun"
			{ verb: 'hasText', target: 'body', value: 'AutoRun Stopping...' },
			// Stop button text reads "Stopping" (not "Stop") when isStopping is true
			{ verb: 'hasText', target: 'body', value: 'Stopping' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-pill-hides-stop-button-when-onStop-not-provided',
		given:
			'autoRunState={isRunning:true, completedTasks:0, totalTasks:3, startTime: now-5s}. No onStopAutoRun callback is provided.',
		when: ['the ThinkingStatusPill mounts with autoRunState as above and onStopAutoRun=undefined'],
		then: [
			// AutoRun pill renders
			{ verb: 'hasText', target: 'body', value: 'AutoRun' },
			// Tasks counter is present
			{ verb: 'hasText', target: 'body', value: '0/3' },
			// No Stop button title is rendered when onStopAutoRun is undefined
			{
				verb: 'hasElement',
				target:
					'body:not(:has(button[title="Stop auto-run after current task"])):not(:has(button[title="Stopping after current task..."]))',
			},
		],
		happyPath: false,
	},
];

/**
 * Smoke test — the catalog is well-formed and covers required cardinality.
 * Per the brief: ≥3 happy-path AND ≥1 negative-path story per happy-path
 * story (so ≥3 negative-path overall). This vitest pass acts as a
 * compile-time guard for the catalog shape; the actual record-and-replay
 * harness lands later.
 */
describe('ThinkingStatusPill — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = thinkingStatusPillParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = thinkingStatusPillParityCatalog.filter((s) => s.happyPath).length;
		const negative = thinkingStatusPillParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of thinkingStatusPillParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of thinkingStatusPillParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('every story has a unique name', () => {
		const names = thinkingStatusPillParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		// ThinkingStatusPill is a pure UI primitive at module load. Zero IPC
		// namespaces are touched, and every side effect is threaded through a
		// caller-provided callback (`onSessionClick`, `onStopAutoRun`,
		// `onInterrupt`). Sanity check that no story leaks a renderer-only
		// assertion target.
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of thinkingStatusPillParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
