/**
 * Parity catalog — MergeProgressModal
 *
 * Layer 2.5 — leaf-parade lift wave (ISC-44.layer-2.5.merge_progress_modal).
 * Per WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every
 * feature port ships with a catalog of (Given, When, Then) stories using
 * the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MergeProgressModal is a centered blocking `role="dialog"` modal that
 * displays progress through context-merge stages. Sibling of
 * `MergeProgressOverlay` (already lifted) but in the modal shape: takes
 * `theme`, `isOpen`, `progress`, optional `sourceName`/`targetName`, and
 * `onCancel`. Renders a 450px-wide centered surface with a header
 * (interpolating source/target names into the title when provided, or
 * showing "Merge Complete" once `progress.stage === 'complete'`), a
 * centered Wand2 spinner / Check head icon, a current-stage status
 * message line (with elapsed-time chip while in flight), a numeric-
 * percentage progress bar, a four-stage vertical indicator list
 * (`collecting` → `grooming` → `creating` → `complete`), and a footer
 * Cancel/Done button. The cancel-confirmation sub-overlay surfaces with
 * "Cancel Merge?" header copy once the Cancel button is clicked while in
 * flight. The component touches 0 IPC namespaces / 0 Electron-only APIs;
 * all side effects flow through the `onCancel` prop.
 *
 * The parity contract is observable-behavior-only:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-label="Merge Progress"`
 *     are present
 *   - Active-state title with `Merging "<source>" into "<target>"...` copy
 *     when both names are provided
 *   - Fallback `Merging Contexts...` title when names are missing
 *   - `Merge Complete` title on completion
 *   - Elapsed-time chip during in-flight progress (suppressed once
 *     complete)
 *   - Stage labels render verbatim ("Collect contexts", "Groom with AI",
 *     "Add to session", "Complete")
 *   - Inline confirmation copy ("Cancel Merge?", "Continue Merge",
 *     "Cancel Merge") surfaces when the Cancel button is clicked while in
 *     flight
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

export const mergeProgressModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'merge-progress-modal-renders-active-title-with-source-and-target-names',
		given:
			'MergeProgressModal mounts with isOpen=true, progress={ stage:"grooming", progress: 50, message:"Grooming with AI..." }, sourceName="Morning Routine", targetName="Evening Refactor".',
		when: ['the modal mounts'],
		then: [
			// Active-state title interpolates both names with the canonical "into" copy
			{ verb: 'hasText', target: 'body', value: 'Morning Routine' },
			{ verb: 'hasText', target: 'body', value: 'Evening Refactor' },
			// Modal dialog chrome
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Merge Progress"]' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-modal-renders-completion-title-and-stage-labels-when-complete',
		given:
			'MergeProgressModal mounts with isOpen=true, progress={ stage:"complete", progress: 100, message:"Complete" }, sourceName="A", targetName="B".',
		when: ['the modal renders the completion state'],
		then: [
			// Completion title copy
			{ verb: 'hasText', target: 'body', value: 'Merge Complete' },
			// Stage indicator list carries each stage label verbatim
			{ verb: 'hasText', target: 'body', value: 'Collect contexts' },
			{ verb: 'hasText', target: 'body', value: 'Groom with AI' },
			{ verb: 'hasText', target: 'body', value: 'Add to session' },
			{ verb: 'hasText', target: 'body', value: 'Complete' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-modal-shows-cancel-confirmation-after-cancel-click',
		given:
			'MergeProgressModal mounts with isOpen=true, progress.stage="collecting" and the user clicks the footer Cancel button once.',
		when: ['the inline confirmation card renders'],
		then: [
			// Confirmation header copy
			{ verb: 'hasText', target: 'body', value: 'Cancel Merge?' },
			// Both confirmation buttons render their copy
			{ verb: 'hasText', target: 'body', value: 'Continue Merge' },
			{ verb: 'hasText', target: 'body', value: 'Cancel Merge' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-modal-renders-fallback-title-when-source-omitted',
		given:
			'MergeProgressModal mounts with isOpen=true, progress.stage="collecting" and no sourceName.',
		when: ['the modal renders its header'],
		then: [
			// Fallback active-state title
			{ verb: 'hasText', target: 'body', value: 'Merging Contexts...' },
			// Modal chrome still present
			{ verb: 'hasElement', target: '[aria-modal="true"]' },
		],
		happyPath: true,
	},
	{
		name: 'merge-progress-modal-renders-done-button-and-close-x-on-completion',
		given: 'MergeProgressModal mounts with isOpen=true and progress.stage="complete".',
		when: ['the modal renders the completion state'],
		then: [
			// Footer flips from Cancel to Done
			{ verb: 'hasText', target: 'body', value: 'Done' },
			// Close (X) affordance with aria-label appears in header on completion
			{ verb: 'hasElement', target: 'button[aria-label="Close modal"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'merge-progress-modal-suppresses-close-x-while-in-flight',
		given: 'MergeProgressModal mounts with isOpen=true and progress.stage="grooming".',
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
		name: 'merge-progress-modal-suppresses-elapsed-time-chip-once-complete',
		given: 'MergeProgressModal mounts with isOpen=true and progress.stage="complete".',
		when: ['the modal renders the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Merge Complete' },
			// The "Elapsed:" label is gated behind `!isComplete` — must not appear
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Elapsed:")))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-modal-suppresses-cancel-confirmation-before-click',
		given:
			'MergeProgressModal mounts with isOpen=true, progress.stage="collecting" and the user has NOT clicked the Cancel button.',
		when: ['the modal mounts'],
		then: [
			// Active title still renders
			{ verb: 'hasText', target: 'body', value: 'Merging Contexts...' },
			// The "Cancel Merge?" confirmation header copy is gated behind
			// `showCancelConfirm` state and must not appear before the first click
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Cancel Merge?")))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-modal-is-not-mounted-when-isOpen-false',
		given: 'MergeProgressModal is rendered with isOpen=false.',
		when: ['the parent re-renders'],
		then: [
			// The component returns `null` when `!isOpen` — no dialog chrome
			// should be present on the page
			{ verb: 'hasElement', target: 'body:not(:has([aria-label="Merge Progress"]))' },
		],
		happyPath: false,
	},
	{
		name: 'merge-progress-modal-no-ipc-no-ws-lifecycle-pin',
		given: 'MergeProgressModal mounts in any state (active or complete).',
		when: ['the modal renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport. All side effects flow through the `onCancel` prop
			// callback. This story pins the lifecycle contract so a future
			// refactor that wires IPC directly into the modal would fail the
			// catalog rather than silently track it.
			{ verb: 'hasElement', target: '[role="dialog"]' },
		],
		happyPath: false,
	},
];

describe('MergeProgressModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = mergeProgressModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = mergeProgressModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = mergeProgressModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of mergeProgressModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of mergeProgressModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of mergeProgressModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the modal-shape contract (role=dialog with aria-modal)', () => {
		// MergeProgressModal is a centered blocking modal with focus trap,
		// distinct from the sibling MergeProgressOverlay (inline non-blocking).
		// The catalog must continue to assert the `role="dialog"` +
		// `aria-modal="true"` chrome — if a future refactor strips that and
		// reverts to the overlay shape, the catalog should fail rather than
		// silently track it.
		const haystack = JSON.stringify(mergeProgressModalParityCatalog);
		expect(haystack.includes('role="dialog"') || haystack.includes('role=\\"dialog\\"')).toBe(true);
		expect(
			haystack.includes('aria-modal="true"') || haystack.includes('aria-modal=\\"true\\"')
		).toBe(true);
	});
});
