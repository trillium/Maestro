/**
 * Parity catalog — ParticipantCard
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION
 * (referenced from ISA.md ISC-44.x), every feature port ships with a
 * catalog of (Given, When, Then) stories using the fixed assertion
 * vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * `ParticipantCard` is a presentational primitive for a single group-chat
 * participant row. It takes `theme`, `participant`, `state`, `color`,
 * `groupChatId`, `onContextReset`, `onRemove`, and `liveOutput`. It
 * touches 0 IPC namespaces and 0 Electron-only APIs — the only non-pure
 * imports are `safeClipboardWrite` (browser `navigator.clipboard` only),
 * `getStatusColor` (pure renderer helper), and `formatCost` (pure shared
 * formatter). The parity contract is therefore observable-behavior-only:
 * the row renders status / identity / context-usage / activity affordances
 * driven entirely from the supplied props, and threads reset / remove
 * side effects out through callbacks the parent owns.
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

export const participantCardParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'participant-card-renders-name-and-idle-status',
		given:
			'ParticipantCard mounts with participant={ name: "claude-1", agentId: "claude-code", agentSessionId: "abcd1234ef" } and state="idle".',
		when: ['the card mounts'],
		then: [
			// Name is rendered in the header row.
			{ verb: 'hasText', target: 'div.rounded-lg.border', value: 'claude-1' },
			// Agent type label is rendered on the right of the stats row.
			{ verb: 'hasText', target: 'div.rounded-lg.border', value: 'claude-code' },
			// Status dot present with idle (no animate-pulse) and the Idle title attr.
			{ verb: 'hasElement', target: 'div[title="Idle"]' },
		],
		happyPath: true,
	},
	{
		name: 'participant-card-renders-session-id-pill-when-agent-session-known',
		given:
			'ParticipantCard mounts with participant.agentSessionId="deadbeef-cafe-feed-0000-0123456789ab".',
		when: ['the card renders its identity pill row'],
		then: [
			// First 8 chars of the session ID, uppercased, are shown in the pill.
			{ verb: 'hasText', target: 'button[title*="Session:"]', value: 'DEADBEEF' },
			// The pill is a clickable button (copy-to-clipboard).
			{ verb: 'hasElement', target: 'button[title*="Click to copy"]' },
		],
		happyPath: true,
	},
	{
		name: 'participant-card-renders-ssh-remote-pill-when-ssh-name-set',
		given:
			'ParticipantCard mounts with participant.sshRemoteName="mini2" and participant.agentSessionId set.',
		when: ['the card renders its pills row'],
		then: [
			// SSH pill has the SSH-remote tooltip and shows the remote name uppercased.
			{ verb: 'hasElement', target: 'span[title="SSH Remote: mini2"]' },
			{ verb: 'hasText', target: 'span[title="SSH Remote: mini2"]', value: 'MINI2' },
		],
		happyPath: true,
	},
	{
		name: 'participant-card-renders-context-gauge-with-usage-percent',
		given: 'ParticipantCard mounts with participant.contextUsage=42 (typical mid-range fill).',
		when: ['the card renders its context-usage section'],
		then: [
			// "Context" label is shown.
			{ verb: 'hasText', target: 'div.rounded-lg.border', value: 'Context' },
			// The percentage readout is present.
			{ verb: 'hasText', target: 'div.rounded-lg.border', value: '42%' },
		],
		happyPath: true,
	},
	{
		name: 'participant-card-renders-cost-pill-when-total-cost-positive',
		given:
			'ParticipantCard mounts with participant.totalCost=1.2345 (cost-tracking on, positive cumulative spend).',
		when: ['the card renders its action-button row'],
		then: [
			// Cost pill has the "Total cost" title and renders the formatted
			// amount stripped of the leading currency symbol (slice(1)).
			{ verb: 'hasElement', target: 'span[title="Total cost"]' },
			// Some digits from the formatted cost appear in the pill.
			{ verb: 'hasText', target: 'span[title="Total cost"]', value: '1.' },
		],
		happyPath: true,
	},
	// ============ Negative / edge paths ============
	{
		name: 'participant-card-renders-pending-pill-when-agent-session-missing',
		given:
			'ParticipantCard mounts with participant.agentSessionId=undefined (session not yet established).',
		when: ['the card renders its identity pill row'],
		then: [
			// The italic "pending" placeholder pill is rendered.
			{ verb: 'hasText', target: 'div.rounded-lg.border', value: 'pending' },
			// The copy-button variant is NOT rendered.
			{
				verb: 'hasElement',
				target: 'div.rounded-lg.border:not(:has(button[title*="Click to copy"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'participant-card-omits-ssh-pill-when-not-remote',
		given:
			'ParticipantCard mounts with participant.sshRemoteName=undefined (local agent, no SSH remote).',
		when: ['the card renders its pills row'],
		then: [
			// No SSH-pill tooltip is present anywhere in the card.
			{
				verb: 'hasElement',
				target: 'div.rounded-lg.border:not(:has(span[title^="SSH Remote:"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'participant-card-omits-cost-pill-when-zero-total-cost',
		given:
			'ParticipantCard mounts with participant.totalCost=0 (no spend yet, the renderer source guards on >0).',
		when: ['the card renders its action-button row'],
		then: [
			// No "Total cost" pill is rendered.
			{
				verb: 'hasElement',
				target: 'div.rounded-lg.border:not(:has(span[title="Total cost"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'participant-card-omits-reset-and-remove-buttons-without-group-chat-id',
		given:
			'ParticipantCard mounts with onContextReset and onRemove callbacks provided but groupChatId=undefined (renderer source gates both action buttons behind a truthy groupChatId).',
		when: ['the card renders its action-button row'],
		then: [
			// Reset button is NOT rendered.
			{
				verb: 'hasElement',
				target: 'div.rounded-lg.border:not(:has(button[title^="Reset context"]))',
			},
			// Remove button is NOT rendered.
			{
				verb: 'hasElement',
				target:
					'div.rounded-lg.border:not(:has(button[title="Remove participant from group chat"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'participant-card-pulses-status-dot-when-state-is-busy-or-connecting',
		given:
			'ParticipantCard mounts with state="busy" (the renderer source pulses the dot for busy or connecting states only).',
		when: ['the card renders its header row'],
		then: [
			// Status dot has the animate-pulse class.
			{ verb: 'hasElement', target: 'div.animate-pulse[title="Working"]' },
		],
		happyPath: false,
	},
	{
		name: 'participant-card-renders-peek-output-fallback-when-no-live-output',
		given:
			'ParticipantCard mounts with liveOutput=undefined and the user has clicked the Peek button so peekOpen=true.',
		when: ['the user toggles the peek panel open with no live output yet'],
		then: [
			// The fallback text is shown inside the peek <pre> panel.
			{ verb: 'hasText', target: 'pre.font-mono', value: '(no live output yet)' },
		],
		happyPath: false,
	},
];

describe('ParticipantCard — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = participantCardParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = participantCardParityCatalog.filter((s) => s.happyPath).length;
		const negative = participantCardParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of participantCardParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of participantCardParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of participantCardParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('every story name is unique', () => {
		const names = participantCardParityCatalog.map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});
});
