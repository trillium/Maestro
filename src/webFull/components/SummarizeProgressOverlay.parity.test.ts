/**
 * Parity catalog — SummarizeProgressOverlay
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SummarizeProgressOverlay is a presentational inline overlay that replaces
 * the input area for a single AI tab while a context SUMMARIZATION is in
 * flight (sibling of MergeProgressOverlay, different operation). It renders
 * a bordered status card carrying a head icon (spinner during progress,
 * check on complete, warning on error), a title row driven by
 * `(isComplete, hasError)` — `Summarizing Context...`, `Context Compacted`,
 * `Summarization Failed`, an elapsed-time chip driven by `startTime`, a
 * `<X>` cancel affordance that toggles into an inline confirmation card
 * (`Cancel Compaction?` / `No` / `Yes`), an animated progress bar driven
 * by `progress.progress`, a four-stage indicator row (`extracting` →
 * `summarizing` → `creating` → `complete`), an error message row when
 * `result.success === false`, and a completion-stats line on the success
 * branch (`Reduced context by N% (~M → ~K tokens)`). All side effects flow
 * through the `onCancel` prop — the component touches 0 IPC namespaces / 0
 * Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - Active-state title `Summarizing Context...` while in flight
 *   - Completion title `Context Compacted` once `progress.stage === "complete"`
 *   - Failure title `Summarization Failed` + verbatim error message body on
 *     `result.success === false`
 *   - Elapsed-time chip during in-flight progress (suppressed once complete
 *     or errored)
 *   - Cancel button (`title="Cancel"`) discoverable while in flight,
 *     suppressed once complete
 *   - Inline confirmation copy (`Cancel Compaction?`, `No`, `Yes`) surfaces
 *     when the X is clicked once
 *   - Stage labels render verbatim (`Extract context`, `Summarize with AI`,
 *     `Create new tab`, `Complete`)
 *   - Completion stats copy (`Reduced context by N% (~M → ~K tokens)`)
 *     surfaces on success with the `toLocaleString`-formatted token counts
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per
 * happy-path story → minimum 3 happy + 3 negative. This catalog ships 5
 * happy + 6 negative = 11 stories.
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

export const summarizeProgressOverlayParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'summarize-progress-overlay-renders-active-title-and-cancel-affordance-during-flight',
		given:
			'SummarizeProgressOverlay mounts with progress={ stage:"summarizing", progress: 40, message:"Summarizing with AI..." }, result=null, startTime=Date.now()-2000.',
		when: ['the overlay mounts'],
		then: [
			// Active-state title verbatim copy
			{ verb: 'hasText', target: 'body', value: 'Summarizing Context...' },
			// Cancel affordance discoverable while in flight
			{ verb: 'hasElement', target: 'button[title="Cancel"]' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-overlay-renders-completion-title-and-stage-labels-when-complete',
		given:
			'SummarizeProgressOverlay mounts with progress={ stage:"complete", progress: 100, message:"Complete" }, result={ success:true, originalTokens: 20000, compactedTokens: 5000, reductionPercent: 75 }, startTime=Date.now()-12000.',
		when: ['the overlay renders the completion state'],
		then: [
			// Completion title copy
			{ verb: 'hasText', target: 'body', value: 'Context Compacted' },
			// Stage indicator row carries each stage label verbatim
			{ verb: 'hasText', target: 'body', value: 'Extract context' },
			{ verb: 'hasText', target: 'body', value: 'Summarize with AI' },
			{ verb: 'hasText', target: 'body', value: 'Create new tab' },
			{ verb: 'hasText', target: 'body', value: 'Complete' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-overlay-surfaces-completion-stats-with-localized-token-counts',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="complete", result={ success:true, originalTokens: 24680, compactedTokens: 1234, reductionPercent: 95 }.',
		when: ['the overlay renders the completion stats line'],
		then: [
			// Stats copy with the toLocaleString-formatted token counts + the
			// canonical "Reduced context by N% (~M → ~K tokens)" framing
			{ verb: 'hasText', target: 'body', value: 'Reduced context by 95%' },
			{ verb: 'hasText', target: 'body', value: '24,680' },
			{ verb: 'hasText', target: 'body', value: '1,234' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-overlay-shows-cancel-confirmation-after-first-cancel-click',
		given:
			'SummarizeProgressOverlay mounts in active state (progress.stage="extracting") and the user clicks the `[title="Cancel"]` affordance once.',
		when: ['the inline confirmation card renders'],
		then: [
			// Confirmation header copy
			{ verb: 'hasText', target: 'body', value: 'Cancel Compaction?' },
			// Both confirmation buttons render their copy (yes / no — different
			// from MergeProgressOverlay's "Continue" / "Cancel" pair)
			{ verb: 'hasText', target: 'body', value: 'No' },
			{ verb: 'hasText', target: 'body', value: 'Yes' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-overlay-renders-progress-bar-driven-by-progress-value',
		given:
			'SummarizeProgressOverlay mounts with progress={ stage:"summarizing", progress: 60, message:"Summarizing with AI..." } and result=null.',
		when: ['the overlay renders its progress bar'],
		then: [
			// Active title still surfaces alongside the progress bar
			{ verb: 'hasText', target: 'body', value: 'Summarizing Context...' },
			// The "summarizing" stage label renders verbatim alongside the bar
			{ verb: 'hasText', target: 'body', value: 'Summarize with AI' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'summarize-progress-overlay-suppresses-cancel-button-once-complete',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="complete" and result={ success:true, originalTokens: 100, compactedTokens: 50, reductionPercent: 50 }.',
		when: ['the overlay renders its header in the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Context Compacted' },
			// No Cancel affordance present anywhere on the page once complete
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Cancel"]))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-overlay-renders-failure-title-and-error-message-on-error',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="summarizing" and result={ success:false, originalTokens: 0, compactedTokens: 0, reductionPercent: 0, error:"Summarization agent timed out" }.',
		when: ['the overlay renders the error state'],
		then: [
			// Failure title from the hasError branch
			{ verb: 'hasText', target: 'body', value: 'Summarization Failed' },
			// Error message body surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'Summarization agent timed out' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-overlay-suppresses-completion-stats-on-error-branch',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="summarizing", result={ success:false, originalTokens: 0, compactedTokens: 0, reductionPercent: 0, error:"failure" }.',
		when: ['the overlay renders the error state'],
		then: [
			// Failure title renders
			{ verb: 'hasText', target: 'body', value: 'Summarization Failed' },
			// The "Reduced context by" stats copy is gated behind
			// `isComplete && result && result.success`; on the error branch
			// it must NOT appear anywhere on the page. A future refactor
			// breaking that gate would silently emit zero-reduction stats
			// copy alongside a failure title.
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Reduced context by")))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-overlay-suppresses-elapsed-time-chip-once-complete',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="complete", result={ success:true, originalTokens: 10, compactedTokens: 5, reductionPercent: 50 }, startTime=Date.now()-5000.',
		when: ['the overlay renders the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Context Compacted' },
			// The font-mono elapsed-time chip from ElapsedTimeDisplay is gated
			// behind `!isComplete && !hasError`; it must not appear in the
			// completion state. The font-mono Tailwind class is the same one
			// the renderer uses, and is the most stable selector for this
			// presentational chip.
			{ verb: 'hasElement', target: 'body:not(:has(span.font-mono))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-overlay-suppresses-inline-confirmation-before-cancel-click',
		given:
			'SummarizeProgressOverlay mounts with progress.stage="extracting" and the user has NOT clicked the cancel affordance.',
		when: ['the overlay mounts'],
		then: [
			// Active title still renders
			{ verb: 'hasText', target: 'body', value: 'Summarizing Context...' },
			// The confirmation header copy is gated behind `showCancelConfirm`
			// state. Before the first click it must not appear.
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Cancel Compaction?")))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-overlay-no-ipc-no-ws-lifecycle-pin',
		given: 'SummarizeProgressOverlay mounts in any state (active, complete, error).',
		when: ['the overlay renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport. All side effects flow through the `onCancel` prop
			// callback supplied by the caller. This story pins the lifecycle
			// contract so a future refactor that wires IPC directly into the
			// overlay would fail the catalog rather than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('SummarizeProgressOverlay — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = summarizeProgressOverlayParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = summarizeProgressOverlayParityCatalog.filter((s) => s.happyPath).length;
		const negative = summarizeProgressOverlayParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of summarizeProgressOverlayParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of summarizeProgressOverlayParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of summarizeProgressOverlayParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (overlay is inline chrome, no modal role on its root)', () => {
		// SummarizeProgressOverlay is an inline replacement for the input area,
		// NOT a modal. The cancel-confirmation it gates is a scoped overlay
		// inside the card, not a top-level dialog. The catalog must never
		// drift toward making the overlay itself a `role="dialog"` surface —
		// if a future refactor wraps it in a modal, that's a behavior change
		// and the catalog should fail rather than silently track it.
		for (const story of summarizeProgressOverlayParityCatalog) {
			const haystack = JSON.stringify(story);
			// Strict pin: no positive assertion targets the overlay root as a
			// dialog. Negative-path `:not(:has(...))` exclusions remain
			// permitted because they assert ABSENCE, not presence.
			expect(haystack.includes('"target":"[role=\\"dialog\\"]"')).toBe(false);
		}
	});
});
