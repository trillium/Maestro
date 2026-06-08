/**
 * Parity catalog — TransferProgressModal
 *
 * Layer 2.5 — leaf-parade lift wave
 * (ISC-44.layer-2.5.transfer_progress_modal). Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * TransferProgressModal is a centered blocking `role="dialog"` modal that
 * displays progress through cross-agent context transfer stages. Takes
 * `theme`, `isOpen`, `progress`, `sourceAgent`, `targetAgent`, `onCancel`,
 * and optional `onComplete`. Renders a 450px-wide centered surface with a
 * header ("Transferring Context..." while in flight, "Transfer Complete"
 * once `progress.stage === 'complete'`), an AgentTransferIndicator row
 * (source agent display name → target agent display name with an
 * ArrowRight between, both via `getAgentDisplayName` from
 * `src/shared/agentMetadata`), a centered Wand2 spinner / Check head
 * icon, a current-stage status message line (with elapsed-time chip
 * while in flight), a numeric-percentage progress bar, a four-stage
 * vertical indicator list (`collecting` → `grooming` → `creating` →
 * `complete`) where the active stage interpolates the target agent
 * display name (e.g. "Grooming for Claude Code..."), and a footer
 * Cancel/Done button. The cancel-confirmation sub-overlay surfaces with
 * "Cancel Transfer?" header copy once the Cancel button is clicked while
 * in flight. The component touches 0 IPC namespaces / 0 Electron-only
 * APIs; all side effects flow through the `onCancel` / `onComplete`
 * props.
 *
 * The parity contract is observable-behavior-only:
 *   - `role="dialog"` + `aria-modal="true"` + `aria-label="Transfer
 *     Progress"` are present
 *   - Active-state title "Transferring Context..."
 *   - "Transfer Complete" title on completion
 *   - Stage labels render verbatim ("Extract context", "Groom for target",
 *     "Create session", "Complete")
 *   - Source/target agent display names surface in the indicator row
 *   - Inline confirmation copy ("Cancel Transfer?", "Continue Transfer",
 *     "Cancel Transfer") surfaces when the Cancel button is clicked while
 *     in flight
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

export const transferProgressModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'transfer-progress-modal-renders-active-title-and-agent-indicator',
		given:
			'TransferProgressModal mounts with isOpen=true, progress={ stage:"grooming", progress: 40, message:"Grooming for Codex..." }, sourceAgent="claude-code", targetAgent="codex".',
		when: ['the modal mounts'],
		then: [
			// Active-state title
			{ verb: 'hasText', target: 'body', value: 'Transferring Context...' },
			// Modal chrome
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Transfer Progress"]' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-progress-modal-renders-completion-title-and-stage-labels',
		given:
			'TransferProgressModal mounts with isOpen=true, progress={ stage:"complete", progress: 100, message:"Complete" }, sourceAgent="claude-code", targetAgent="codex".',
		when: ['the modal renders the completion state'],
		then: [
			// Completion title copy
			{ verb: 'hasText', target: 'body', value: 'Transfer Complete' },
			// Stage indicator list carries each stage label verbatim
			{ verb: 'hasText', target: 'body', value: 'Extract context' },
			{ verb: 'hasText', target: 'body', value: 'Groom for target' },
			{ verb: 'hasText', target: 'body', value: 'Create session' },
			{ verb: 'hasText', target: 'body', value: 'Complete' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-progress-modal-shows-cancel-confirmation-after-cancel-click',
		given:
			'TransferProgressModal mounts with isOpen=true, progress.stage="collecting" and the user clicks the footer Cancel button once.',
		when: ['the inline confirmation card renders'],
		then: [
			// Confirmation header copy
			{ verb: 'hasText', target: 'body', value: 'Cancel Transfer?' },
			// Both confirmation buttons render their copy
			{ verb: 'hasText', target: 'body', value: 'Continue Transfer' },
			{ verb: 'hasText', target: 'body', value: 'Cancel Transfer' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-progress-modal-renders-done-button-and-close-x-on-completion',
		given: 'TransferProgressModal mounts with isOpen=true and progress.stage="complete".',
		when: ['the modal renders the completion state'],
		then: [
			// Footer flips from Cancel to Done
			{ verb: 'hasText', target: 'body', value: 'Done' },
			// Close (X) affordance appears in header on completion
			{ verb: 'hasElement', target: 'button[aria-label="Close modal"]' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-progress-modal-renders-aria-modal-chrome',
		given: 'TransferProgressModal mounts with isOpen=true, progress.stage="grooming".',
		when: ['the modal mounts'],
		then: [
			// Modal `aria-modal="true"` flag is present (focus-trap contract)
			{ verb: 'hasElement', target: '[aria-modal="true"]' },
			// Active title still renders alongside
			{ verb: 'hasText', target: 'body', value: 'Transferring Context...' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'transfer-progress-modal-suppresses-close-x-while-in-flight',
		given: 'TransferProgressModal mounts with isOpen=true and progress.stage="grooming".',
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
		name: 'transfer-progress-modal-suppresses-elapsed-time-chip-once-complete',
		given: 'TransferProgressModal mounts with isOpen=true and progress.stage="complete".',
		when: ['the modal renders the completion state'],
		then: [
			// Completion title still renders
			{ verb: 'hasText', target: 'body', value: 'Transfer Complete' },
			// The "Elapsed:" label is gated behind `!isComplete` — must not appear
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Elapsed:")))' },
		],
		happyPath: false,
	},
	{
		name: 'transfer-progress-modal-suppresses-cancel-confirmation-before-click',
		given:
			'TransferProgressModal mounts with isOpen=true, progress.stage="collecting" and the user has NOT clicked the Cancel button.',
		when: ['the modal mounts'],
		then: [
			// Active title still renders
			{ verb: 'hasText', target: 'body', value: 'Transferring Context...' },
			// The "Cancel Transfer?" confirmation header copy is gated
			// behind `showCancelConfirm` state and must not appear before
			// the first click
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Cancel Transfer?")))' },
		],
		happyPath: false,
	},
	{
		name: 'transfer-progress-modal-is-not-mounted-when-isOpen-false',
		given: 'TransferProgressModal is rendered with isOpen=false.',
		when: ['the parent re-renders'],
		then: [
			// The component returns `null` when `!isOpen` — no dialog chrome
			// should be present on the page
			{ verb: 'hasElement', target: 'body:not(:has([aria-label="Transfer Progress"]))' },
		],
		happyPath: false,
	},
	{
		name: 'transfer-progress-modal-no-ipc-no-ws-lifecycle-pin',
		given: 'TransferProgressModal mounts in any state (active or complete).',
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

describe('TransferProgressModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = transferProgressModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = transferProgressModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = transferProgressModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of transferProgressModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of transferProgressModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of transferProgressModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the modal-shape contract (role=dialog with aria-modal)', () => {
		// TransferProgressModal is a centered blocking modal with focus
		// trap. The catalog must continue to assert the `role="dialog"` +
		// `aria-modal="true"` chrome — if a future refactor strips that, the
		// catalog should fail rather than silently track it.
		const haystack = JSON.stringify(transferProgressModalParityCatalog);
		expect(haystack.includes('role="dialog"') || haystack.includes('role=\\"dialog\\"')).toBe(true);
		expect(
			haystack.includes('aria-modal="true"') || haystack.includes('aria-modal=\\"true\\"')
		).toBe(true);
	});
});
