/**
 * Parity catalog — TransferErrorModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of (Given,
 * When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * TransferErrorModal is a cross-agent-transfer error-display primitive that
 * surfaces a structured `TransferError` to the user along with up to two
 * recovery-action buttons (Retry primary; Skip Grooming secondary) and a
 * Cancel row. It takes `theme`, `isOpen`, `error`, `onRetry`,
 * `onSkipGrooming`, `onCancel`, and optional `isRetrying`. It touches 0 IPC
 * namespaces and 0 Electron-only APIs. The parity contract is therefore
 * observable-behavior-only: the modal renders with the right type-keyed
 * title chrome, names the source→target agents when supplied, shows the
 * error message + timestamp + optional details + optional install
 * instructions, exposes recovery action buttons gated by the
 * type-specific `getAvailableActions` table, and shows a Cancel row at
 * the bottom. Persistence + transport are the caller's job — this is a
 * pure presentational surface.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
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

export const transferErrorModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'transfer-error-modal-renders-grooming-timeout-title-and-message',
		given:
			'A cross-agent transfer fails with error.type="grooming_timeout", error.message="Context grooming took too long and timed out. You can retry or skip grooming to transfer the raw context.", error.recoverable=true, error.timestamp=Date.now(); the TransferErrorModal mounts with this error and stub onRetry / onSkipGrooming / onCancel callbacks.',
		when: ['the modal mounts'],
		then: [
			// Modal chrome present with the grooming-timeout title.
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Grooming Timed Out"]' },
			// Title visible in header.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Grooming Timed Out' },
			// Error message body.
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Context grooming took too long',
			},
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-source-to-target-agent-context-when-supplied',
		given:
			'TransferErrorModal mounts with error.sourceAgent="claude-code", error.targetAgent="codex", error.type="agent_busy", error.message="The target agent is currently processing another request. Please wait and try again.".',
		when: ['the modal renders its body'],
		then: [
			// Source agent display name shown (via shared/agentMetadata).
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Claude Code' },
			// Target agent display name shown.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Codex' },
			// Agent-busy title from getErrorTitle().
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent Busy' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-skip-grooming-and-retry-buttons-for-grooming-timeout',
		given:
			'TransferErrorModal mounts with error.type="grooming_timeout" (canRetry=true, canSkipGrooming=true per the getAvailableActions table).',
		when: ['the modal renders its recovery-action column'],
		then: [
			// Skip Grooming secondary action visible.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Skip Grooming' },
			// Retry-with-Grooming primary action visible.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Retry with Grooming' },
			// Both rendered as buttons inside the dialog.
			{ verb: 'hasElement', target: '[role="dialog"] button' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-cancel-row-at-bottom',
		given:
			'TransferErrorModal mounts with any error type and stub callbacks; the Cancel row is unconditional (no `dismissible` flag — Cancel is always present).',
		when: ['the modal renders the bottom row'],
		then: [
			// Cancel button is rendered in the dialog.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Cancel' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-details-line-when-elapsed-time-supplied',
		given:
			'TransferErrorModal mounts with error.type="grooming_timeout" and error.details={ elapsedTimeMs: 45000 } — formatDetails() should surface "Elapsed time: 45s".',
		when: ['the modal renders its body'],
		then: [
			// Details line surfaces the elapsed time.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Elapsed time: 45s' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-install-instructions-when-agent-not-installed',
		given:
			'TransferErrorModal mounts with error.type="agent_not_installed", error.targetAgent="codex", error.details={ installInstructions: "Run brew install codex" }.',
		when: ['the modal renders its body'],
		then: [
			// The supplied install instructions are surfaced verbatim.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Run brew install codex' },
			// The agent-not-installed title is shown.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent Not Available' },
		],
		happyPath: true,
	},
	{
		name: 'transfer-error-modal-renders-context-too-large-primary-action-as-try-with-grooming',
		given:
			'TransferErrorModal mounts with error.type="context_too_large" — getAvailableActions returns canRetry=false, canSkipGrooming=true with skipGroomingLabel="Try with Grooming" rendered as the PRIMARY (accent-coloured) button instead of the secondary slot.',
		when: ['the modal renders its recovery-action column'],
		then: [
			// "Try with Grooming" is rendered as a button in the dialog.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Try with Grooming' },
			// The Context-Too-Large title is shown.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Context Too Large' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'transfer-error-modal-omits-agent-context-when-no-source-or-target-agent',
		given:
			'TransferErrorModal mounts WITHOUT error.sourceAgent and WITHOUT error.targetAgent; error.type="network_error".',
		when: ['the modal renders its body'],
		then: [
			// The connection-error title still renders.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Connection Error' },
			// No source/target agent pill row is present — guarded via a :has(...) selector
			// so the entire dialog never contains the ArrowRight icon-row chrome that
			// only renders when at least one agent is supplied (the chrome is gated
			// behind `error.sourceAgent || error.targetAgent`).
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(.lucide-arrow-right))',
			},
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-omits-skip-grooming-button-for-network-error',
		given:
			'TransferErrorModal mounts with error.type="network_error" — getAvailableActions returns canSkipGrooming=false. The Skip Grooming row must NOT render.',
		when: ['the modal renders its recovery-action column'],
		then: [
			// The Retry primary action is still rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Retry' },
			// No "Skip Grooming" affordance is present anywhere in the dialog.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(button:has-text("Skip Grooming")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-omits-retry-button-when-canRetry-false',
		given:
			'TransferErrorModal mounts with error.type="agent_not_installed" — getAvailableActions returns canRetry=false (the target agent must be installed before any retry can succeed). The Retry button must NOT render.',
		when: ['the modal renders its action surface'],
		then: [
			// The agent-not-installed title is still rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Agent Not Available' },
			// No "Retry" button is present anywhere in the dialog (the bottom
			// Cancel row's "Cancel" text doesn't trip the Retry-specific guard).
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(button:has-text("Retry")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-omits-details-line-when-no-details',
		given:
			'TransferErrorModal mounts with error.details === undefined (the common case for plain "Network unreachable" errors). formatDetails returns null and the details row must NOT render.',
		when: ['the modal renders its body'],
		then: [
			// Title still renders.
			{ verb: 'hasElement', target: '[role="dialog"]' },
			// No "Elapsed time:" / "Context size:" / "sessions currently active" lines.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(:has-text("Elapsed time:")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-falls-back-to-generic-title-for-unknown-type',
		given:
			'TransferErrorModal mounts with error.type="unknown" (the fallback bucket from TransferErrorType) and error.message="Something unexpected went wrong".',
		when: ['the modal renders its header'],
		then: [
			// The generic "Transfer Error" title from getErrorTitle() default branch.
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Transfer Error"]' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Transfer Error' },
			// The supplied message still renders.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Something unexpected went wrong' },
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-shows-retrying-label-when-isRetrying-true',
		given:
			'TransferErrorModal mounts with error.type="agent_busy" (canRetry=true) and isRetrying=true — the primary action button must surface "Retrying..." instead of the canonical retry label, and the retry description must NOT render.',
		when: ['the modal renders its primary action'],
		then: [
			// The "Retrying..." label is surfaced on the primary button.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Retrying...' },
			// The canonical "Try again immediately" description is suppressed
			// while the spinner is active (the renderer source gates the
			// description behind `actions.retryDescription && !isRetrying`).
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(:has-text("Try again immediately")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'transfer-error-modal-escape-key-closes-via-cancel-handler',
		given:
			'TransferErrorModal is the topmost layer with stub callbacks and the primary action button has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes via Modal primitive's layer-stack onClose=onCancel hook.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('TransferErrorModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = transferErrorModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = transferErrorModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = transferErrorModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of transferErrorModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of transferErrorModalParityCatalog) {
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
		for (const story of transferErrorModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('has no duplicate story names', () => {
		const names = transferErrorModalParityCatalog.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
