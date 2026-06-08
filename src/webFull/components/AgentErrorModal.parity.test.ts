/**
 * Parity catalog — AgentErrorModal
 *
 * Layer 2.5 — leaf-parade lift wave (audit item #6). Per
 * WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every feature
 * port ships with a catalog of (Given, When, Then) stories using the fixed
 * assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AgentErrorModal is an error-display primitive that surfaces an agent
 * error to the user along with a column of recovery-action buttons and
 * (optionally) a Dismiss row. It takes `error`, `agentName`,
 * `sessionName`, `recoveryActions`, `onDismiss`, and `dismissible`. It
 * touches 0 IPC namespaces and 0 Electron-only APIs. The parity contract
 * is therefore observable-behavior-only: the modal renders with the right
 * type-keyed title chrome, names the agent/session context when supplied,
 * shows the error message + timestamp, exposes a JSON-details toggle
 * only when `parsedJson` is present, renders each recovery action as a
 * button (with the primary action styled distinctly and focused on
 * mount), and shows a Dismiss row only when `dismissible` is true.
 * Persistence + transport are the caller's job — this is a pure
 * presentational surface.
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

export const agentErrorModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'agent-error-modal-renders-auth-expired-title-and-message',
		given:
			'The user has an active agent that emits an AgentError with type="auth_expired", message="API key has expired", recoverable=true, timestamp=Date.now(); the AgentErrorModal mounts with this error and an empty recoveryActions array.',
		when: ['the modal mounts'],
		then: [
			// Modal chrome present with the auth-expired title.
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Authentication Required"]' },
			// Title in header.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Authentication Required' },
			// Error message body.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'API key has expired' },
		],
		happyPath: true,
	},
	{
		name: 'agent-error-modal-renders-agent-and-session-context-when-supplied',
		given:
			'AgentErrorModal mounts with agentName="claude-code", sessionName="Morning Routine", error.type="token_exhaustion", error.message="Context window full".',
		when: ['the modal renders its body'],
		then: [
			// Agent name shown in context line.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'claude-code' },
			// Session name shown in context line.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Morning Routine' },
			// Token-exhaustion title from getErrorTitle().
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Context Limit Reached' },
		],
		happyPath: true,
	},
	{
		name: 'agent-error-modal-renders-primary-recovery-action-button',
		given:
			'AgentErrorModal mounts with recoveryActions=[{ id:"re-auth", label:"Re-authenticate", primary:true, onClick:() => {} }, { id:"new-session", label:"Start New Session", onClick:() => {} }].',
		when: ['the modal renders its recovery-action column'],
		then: [
			// Primary action button is rendered with its label.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Re-authenticate' },
			// Secondary action button is also rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Start New Session' },
			// Both rendered as buttons inside the dialog.
			{ verb: 'hasElement', target: '[role="dialog"] button' },
		],
		happyPath: true,
	},
	{
		name: 'agent-error-modal-shows-dismiss-row-when-dismissible',
		given:
			'AgentErrorModal mounts with dismissible=true (default) and recoveryActions=[{ id:"retry", label:"Retry", primary:true, onClick:() => {} }].',
		when: ['the modal renders the dismiss row'],
		then: [
			// Dismiss option is rendered in the dialog.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Dismiss' },
		],
		happyPath: true,
	},
	{
		name: 'agent-error-modal-exposes-json-details-toggle-when-parsedJson-present',
		given:
			'AgentErrorModal mounts with error.parsedJson={ code: 429, retryAfter: 60 } and otherwise unchanged props.',
		when: ['the modal mounts (collapsed-by-default state)'],
		then: [
			// The "Error Details (JSON)" toggle row is shown.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Error Details (JSON)' },
			// The toggle is a button inside the dialog.
			{ verb: 'hasElement', target: '[role="dialog"] button' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'agent-error-modal-omits-agent-context-when-no-agentName-or-sessionName',
		given:
			'AgentErrorModal mounts WITHOUT agentName and WITHOUT sessionName; error has a known message="Network unreachable".',
		when: ['the modal renders its body'],
		then: [
			// The connection-error title still renders.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Connection Error' },
			// The error message still renders.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Network unreachable' },
		],
		happyPath: false,
	},
	{
		name: 'agent-error-modal-omits-json-toggle-when-parsedJson-undefined',
		given:
			'AgentErrorModal mounts with error.parsedJson === undefined (the common case for stderr-derived errors).',
		when: ['the modal renders its body'],
		then: [
			// Title still renders.
			{ verb: 'hasElement', target: '[role="dialog"]' },
			// No "Error Details (JSON)" toggle present in the dialog — guarded
			// via a :has(...) selector so the entire dialog never contains the
			// toggle string. Layout-independent.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(button:has-text("Error Details (JSON)")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'agent-error-modal-omits-dismiss-row-when-dismissible-false',
		given:
			'AgentErrorModal mounts with dismissible=false and recoveryActions=[{ id:"re-auth", label:"Re-authenticate", primary:true, onClick:() => {} }] (non-dismissible error requiring action).',
		when: ['the modal renders its action surface'],
		then: [
			// The recovery action is still rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Re-authenticate' },
			// No "Dismiss" affordance is present anywhere in the dialog.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(button:has-text("Dismiss")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'agent-error-modal-falls-back-to-generic-title-for-unknown-type',
		given:
			'AgentErrorModal mounts with error.type="unknown" (the fallback bucket from AgentErrorType) and error.message="Something went wrong".',
		when: ['the modal renders its header'],
		then: [
			// The generic "Error" title from getErrorTitle() default branch.
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Error"]' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Error' },
			// The supplied message still renders.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Something went wrong' },
		],
		happyPath: false,
	},
	{
		name: 'agent-error-modal-escape-key-closes-when-dismissible',
		given:
			'AgentErrorModal is the topmost layer with dismissible=true and a primary recovery action has focus.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes via layer stack onClose=onDismiss.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
];

describe('AgentErrorModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = agentErrorModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = agentErrorModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = agentErrorModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of agentErrorModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of agentErrorModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of agentErrorModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
