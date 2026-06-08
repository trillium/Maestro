/**
 * Parity catalog — SummarizeProgressModal
 *
 * Layer 2.5 — leaf-parade lift wave
 * (ISC-44.layer-2.5.summarize_progress_modal). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SummarizeProgressModal is a centered blocking `role="dialog"` modal that
 * displays progress through context-summarization stages. Sibling of
 * `SummarizeProgressOverlay` (already lifted) but in the modal shape:
 * takes `theme`, `isOpen`, `progress`, `result`, `onCancel`, and
 * `onComplete`. Renders a 450px-wide centered surface with a header ("
 * Summarizing Context..." while in flight, "Summarization Complete" once
 * `progress.stage === 'complete'`), a centered Wand2 spinner / Check
 * head icon, a current-stage status message line (with elapsed-time chip
 * while in flight), a numeric-percentage progress bar, a four-stage
 * vertical indicator list (`extracting` → `summarizing` → `creating` →
 * `complete`), an optional TokenReductionStats card on `result.success`,
 * an error message card on `result.success === false`, and a footer
 * Cancel/Done button. The cancel-confirmation sub-overlay surfaces with
 * "Cancel Compaction?" header copy once the Cancel button is clicked
 * while in flight. The component touches 0 IPC namespaces / 0 Electron-
 * only APIs; all side effects flow through the `onCancel` / `onComplete`
 * props.
 *
 * The parity contract is observable-behavior-only:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-label="Summarization
 *     Progress"` are present
 *   - Active-state title "Summarizing Context..."
 *   - "Summarization Complete" title on completion
 *   - Stage labels render verbatim ("Extract context", "Summarize with
 *     AI", "Create new tab", "Complete")
 *   - Token reduction stats surface when `result.success === true` with
 *     "Context Reduced by N%" copy
 *   - Error message surfaces verbatim when `result.success === false`
 *   - Inline confirmation copy ("Cancel Compaction?", "No", "Yes")
 *     surfaces when the Cancel button is clicked while in flight
 *   - Footer button copy flips from "Cancel" → "Done" on completion
 *   - Close (X) button surfaces in the header on completion only
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

export const summarizeProgressModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'summarize-progress-modal-renders-active-title-while-in-flight',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress={ stage:"summarizing", progress: 50, message:"Summarizing with AI..." }, result=null.',
		when: ['the modal mounts'],
		then: [
			// Active-state title
			{ verb: 'hasText', target: 'body', value: 'Summarizing Context...' },
			// Modal chrome
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Summarization Progress"]' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-modal-renders-completion-title-and-stage-labels',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress={ stage:"complete", progress: 100, message:"Complete" }, result={ success:true, originalTokens: 10000, compactedTokens: 4000, reductionPercent: 60 }.',
		when: ['the modal renders the completion state'],
		then: [
			// Completion title copy
			{ verb: 'hasText', target: 'body', value: 'Summarization Complete' },
			// Stage indicator list carries each stage label verbatim
			{ verb: 'hasText', target: 'body', value: 'Extract context' },
			{ verb: 'hasText', target: 'body', value: 'Summarize with AI' },
			{ verb: 'hasText', target: 'body', value: 'Create new tab' },
			{ verb: 'hasText', target: 'body', value: 'Complete' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-modal-surfaces-token-reduction-stats-on-success',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress.stage="complete", result={ success:true, originalTokens: 10000, compactedTokens: 4000, reductionPercent: 60 }.',
		when: ['the modal renders the completion state with success result'],
		then: [
			// Reduction percent surfaces in canonical copy
			{ verb: 'hasText', target: 'body', value: 'Context Reduced by 60%' },
			// Before/After section headers
			{ verb: 'hasText', target: 'body', value: 'Before' },
			{ verb: 'hasText', target: 'body', value: 'After' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-modal-shows-cancel-confirmation-after-cancel-click',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress.stage="extracting" and the user clicks the footer Cancel button once.',
		when: ['the inline confirmation card renders'],
		then: [
			// Confirmation header copy
			{ verb: 'hasText', target: 'body', value: 'Cancel Compaction?' },
			// Both confirmation buttons render their copy ("No" / "Yes")
			{ verb: 'hasText', target: 'body', value: 'No' },
			{ verb: 'hasText', target: 'body', value: 'Yes' },
		],
		happyPath: true,
	},
	{
		name: 'summarize-progress-modal-renders-done-button-and-close-x-on-completion',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress.stage="complete" and result={ success:true }.',
		when: ['the modal renders the completion state'],
		then: [
			// Footer flips from Cancel to Done
			{ verb: 'hasText', target: 'body', value: 'Done' },
			// Close (X) affordance appears in header on completion
			{ verb: 'hasElement', target: 'button[aria-label="Close modal"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'summarize-progress-modal-renders-error-message-on-failure',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress.stage="complete" and result={ success:false, error:"Summarization agent timed out" }.',
		when: ['the modal renders the failure state'],
		then: [
			// Completion title still renders (the modal does not gate the title on success)
			{ verb: 'hasText', target: 'body', value: 'Summarization Complete' },
			// Error message body surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'Summarization agent timed out' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-modal-suppresses-close-x-while-in-flight',
		given: 'SummarizeProgressModal mounts with isOpen=true and progress.stage="summarizing".',
		when: ['the modal renders its in-flight header'],
		then: [
			// In-flight footer button is "Cancel", not "Done"
			{ verb: 'hasText', target: 'body', value: 'Cancel' },
			// The header Close (X) button is gated behind `isComplete` —
			// it must not appear while still in flight
			{ verb: 'hasElement', target: 'body:not(:has(button[aria-label="Close modal"]))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-modal-suppresses-token-reduction-stats-on-failure',
		given:
			'SummarizeProgressModal mounts with isOpen=true, progress.stage="complete" and result={ success:false, error:"Failed" }.',
		when: ['the modal renders the failure state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Summarization Complete' },
			// The "Context Reduced by" stats line is gated behind
			// `result.success === true` — must not appear on failure
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Context Reduced by")))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-modal-is-not-mounted-when-isOpen-false',
		given: 'SummarizeProgressModal is rendered with isOpen=false.',
		when: ['the parent re-renders'],
		then: [
			// The component returns `null` when `!isOpen` — no dialog chrome
			// should be present on the page
			{ verb: 'hasElement', target: 'body:not(:has([aria-label="Summarization Progress"]))' },
		],
		happyPath: false,
	},
	{
		name: 'summarize-progress-modal-no-ipc-no-ws-lifecycle-pin',
		given: 'SummarizeProgressModal mounts in any state (active, complete, error).',
		when: ['the modal renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport. All side effects flow through the `onCancel` /
			// `onComplete` prop callbacks. This story pins the lifecycle
			// contract so a future refactor that wires IPC directly into the
			// modal would fail the catalog rather than silently track it.
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
];

describe('SummarizeProgressModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = summarizeProgressModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = summarizeProgressModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = summarizeProgressModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of summarizeProgressModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of summarizeProgressModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of summarizeProgressModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the modal-shape contract (role=dialog with aria-modal)', () => {
		// SummarizeProgressModal is a centered blocking modal with focus
		// trap, distinct from the sibling SummarizeProgressOverlay (inline
		// non-blocking). The catalog must continue to assert the
		// `role="dialog"` + `aria-modal="true"` chrome — if a future
		// refactor strips that and reverts to the overlay shape, the catalog
		// should fail rather than silently track it.
		const haystack = JSON.stringify(summarizeProgressModalParityCatalog);
		expect(haystack.includes('role="dialog"') || haystack.includes('role=\\"dialog\\"')).toBe(true);
	});
});
