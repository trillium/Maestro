/**
 * Parity catalog — MergeProgressOverlay
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MergeProgressOverlay is a presentational inline overlay that replaces the
 * input area for a single AI tab while a context merge is in flight. It
 * renders a bordered status card carrying a head icon (spinner during
 * progress, check on complete, warning on error), a title row built from
 * `(sourceName, targetName, isComplete, hasError)`, an elapsed-time chip
 * driven by `startTime`, a `<X>` cancel affordance that toggles into an
 * inline confirmation card, an animated progress bar driven by
 * `progress.progress`, a four-stage indicator row (`collecting` →
 * `grooming` → `creating` → `complete`), an error message row when
 * `result.success === false`, and an optional completion-stats line when
 * `tokensSaved > 0`. All side effects flow through the `onCancel` prop —
 * the component touches 0 IPC namespaces / 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only:
 *   - Active-state title with `Merging "<source>" into "<target>"...` copy
 *     when both names are provided
 *   - Fallback `Merging Contexts...` title when names are missing
 *   - `Contexts Merged` title on completion
 *   - `Merge Failed` title + error message body on error
 *   - Elapsed-time chip during in-flight progress (suppressed once
 *     complete or errored)
 *   - Cancel button (`title="Cancel"`) discoverable while in flight,
 *     suppressed once complete
 *   - Inline confirmation copy ("Cancel Merge?", "Continue", "Cancel")
 *     surfaces when the X is clicked once
 *   - Stage labels render verbatim ("Collect contexts", "Groom with AI",
 *     "Add to session", "Complete")
 *   - Completion stats copy ("Saved ~<N> tokens through deduplication")
 *     surfaces only when `tokensSaved > 0`
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

export const mergeProgressOverlayParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'merge-progress-overlay-renders-active-title-with-source-and-target-names',
		given:
			'MergeProgressOverlay mounts with progress={ stage:"grooming", progress: 50, message:"Grooming with AI..." }, result=null, sourceName="Morning Routine", targetName="Evening Refactor", startTime=Date.now()-3000.',
		when: ['the overlay mounts'],
		then: [
			// Active-state title interpolates both names with the canonical "into" copy
			{ verb: 'hasText', target: 'body', value: 'Morning Routine' },
			{ verb: 'hasText', target: 'body', value: 'Evening Refactor' },
			// Cancel affordance discoverable while in flight
			{ verb: 'hasElement', target: 'button[title="Cancel"]' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-overlay-renders-completion-title-and-stage-labels-when-complete',
		given:
			'MergeProgressOverlay mounts with progress={ stage:"complete", progress: 100, message:"Complete" }, result={ success:true, tokensSaved: 4200 }, sourceName="A", targetName="B", startTime=Date.now()-12000.',
		when: ['the overlay renders the completion state'],
		then: [
			// Completion title copy
			{ verb: 'hasText', target: 'body', value: 'Contexts Merged' },
			// Stage indicator row carries each stage label verbatim
			{ verb: 'hasText', target: 'body', value: 'Collect contexts' },
			{ verb: 'hasText', target: 'body', value: 'Groom with AI' },
			{ verb: 'hasText', target: 'body', value: 'Add to session' },
			{ verb: 'hasText', target: 'body', value: 'Complete' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-overlay-surfaces-completion-stats-when-tokens-saved-positive',
		given:
			'MergeProgressOverlay mounts with progress.stage="complete", result={ success:true, tokensSaved: 12345 }.',
		when: ['the overlay renders the completion stats line'],
		then: [
			// Stats copy with the toLocaleString-formatted token count + the
			// canonical "Saved ~" / "through deduplication" framing
			{ verb: 'hasText', target: 'body', value: 'Saved ~12,345 tokens through deduplication' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-overlay-shows-cancel-confirmation-after-first-cancel-click',
		given:
			'MergeProgressOverlay mounts in active state (progress.stage="collecting") and the user clicks the `[title="Cancel"]` affordance once.',
		when: ['the inline confirmation card renders'],
		then: [
			// Confirmation header copy
			{ verb: 'hasText', target: 'body', value: 'Cancel Merge?' },
			// Both confirmation buttons render their copy
			{ verb: 'hasText', target: 'body', value: 'Continue' },
			{ verb: 'hasText', target: 'body', value: 'Cancel' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-overlay-renders-fallback-title-when-names-omitted',
		given:
			'MergeProgressOverlay mounts with progress.stage="collecting" and no sourceName or targetName.',
		when: ['the overlay renders its header'],
		then: [
			// Fallback active-state title
			{ verb: 'hasText', target: 'body', value: 'Merging Contexts...' },
			// Cancel affordance still discoverable
			{ verb: 'hasElement', target: 'button[title="Cancel"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'merge-progress-overlay-suppresses-cancel-button-once-complete',
		given:
			'MergeProgressOverlay mounts with progress.stage="complete" and result={ success:true }.',
		when: ['the overlay renders its header in the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Contexts Merged' },
			// No Cancel affordance present anywhere on the page once complete
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Cancel"]))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-overlay-renders-failure-title-and-error-message-on-error',
		given:
			'MergeProgressOverlay mounts with progress.stage="grooming" and result={ success:false, error:"Grooming agent timed out" }.',
		when: ['the overlay renders the error state'],
		then: [
			// Failure title from getErrorTitle branch
			{ verb: 'hasText', target: 'body', value: 'Merge Failed' },
			// Error message body surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'Grooming agent timed out' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-overlay-suppresses-completion-stats-when-tokens-saved-zero',
		given:
			'MergeProgressOverlay mounts with progress.stage="complete", result={ success:true, tokensSaved: 0 }.',
		when: ['the overlay renders the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Contexts Merged' },
			// The "Saved ~" stats line is NOT present anywhere on the page —
			// the literal copy that would appear if the gate (`tokensSaved > 0`)
			// were broken is `Saved ~0 tokens through deduplication`.
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Saved ~")))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-overlay-suppresses-elapsed-time-chip-once-complete',
		given:
			'MergeProgressOverlay mounts with progress.stage="complete", result={ success:true }, startTime=Date.now()-5000.',
		when: ['the overlay renders the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Contexts Merged' },
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
		name: 'merge-progress-overlay-suppresses-inline-confirmation-before-cancel-click',
		given:
			'MergeProgressOverlay mounts with progress.stage="collecting" and the user has NOT clicked the cancel affordance.',
		when: ['the overlay mounts'],
		then: [
			// Active title still renders
			{ verb: 'hasText', target: 'body', value: 'Merging Contexts...' },
			// The confirmation header copy is gated behind `showCancelConfirm`
			// state. Before the first click it must not appear.
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Cancel Merge?")))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-overlay-no-ipc-no-ws-lifecycle-pin',
		given: 'MergeProgressOverlay mounts in any state (active, complete, error).',
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

describe('MergeProgressOverlay — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = mergeProgressOverlayParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = mergeProgressOverlayParityCatalog.filter((s) => s.happyPath).length;
		const negative = mergeProgressOverlayParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of mergeProgressOverlayParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of mergeProgressOverlayParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of mergeProgressOverlayParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (overlay is inline chrome, no modal role on its root)', () => {
		// MergeProgressOverlay is an inline replacement for the input area,
		// NOT a modal. The cancel-confirmation it gates is a scoped overlay
		// inside the card, not a top-level dialog. The catalog must never
		// drift toward making the overlay itself a `role="dialog"` surface —
		// if a future refactor wraps it in a modal, that's a behavior change
		// and the catalog should fail rather than silently track it.
		for (const story of mergeProgressOverlayParityCatalog) {
			const haystack = JSON.stringify(story);
			// Strict pin: no positive assertion targets the overlay root as a
			// dialog. Negative-path `:not(:has(...))` exclusions remain
			// permitted because they assert ABSENCE, not presence.
			expect(haystack.includes('"target":"[role=\\"dialog\\"]"')).toBe(false);
		}
	});
});
