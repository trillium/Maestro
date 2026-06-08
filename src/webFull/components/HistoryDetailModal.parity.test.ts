/**
 * Parity catalog — HistoryDetailModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of (Given,
 * When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * HistoryDetailModal is a history-entry detail-view primitive that surfaces
 * a single `HistoryEntry` (AUTO or USER) with its full chrome: agent name +
 * session name + type pill + success/failure indicator + session ID octet
 * with Copy/Resume buttons + timestamp + Validated toggle in the header,
 * an optional stats panel (context usage bar + token breakdown + elapsed
 * time + cost), a scrollable markdown body, and a footer (Delete +
 * Prev/Next nav + Close). It additionally renders an INTERNAL Delete
 * confirmation modal when the user clicks Delete. Touches 0 IPC
 * namespaces and 0 Electron-only APIs — every side effect (`onClose`,
 * `onResumeSession`, `onDelete`, `onUpdate`, `onNavigate`, `onFileClick`)
 * flows through caller-owned prop callbacks. The parity contract is
 * therefore observable-behavior-only: the modal renders with the right
 * chrome based on entry type + supplied props; navigation buttons gate
 * on `canNavigate`; the success indicator surfaces the AUTO-entry
 * outcome; the session ID octet surfaces when `agentSessionId` is
 * present; the Resume button is gated on `onResumeSession`; the
 * Validated toggle is gated on `entry.type === 'AUTO' && entry.success
 * && onUpdate`; the Delete button is gated on `onDelete`.
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

export const historyDetailModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'history-detail-modal-renders-auto-entry-with-success-and-type-pill',
		given:
			'The user opens a HistoryEntry with type="AUTO", success=true, validated=false, summary="Refactored auth module", fullResponse="Refactored auth module — extracted JWT validation into a helper.", sessionName="Auth Sprint", timestamp=Date.now(); the HistoryDetailModal mounts with stub onClose.',
		when: ['the modal mounts'],
		then: [
			// Session name shown in header
			{ verb: 'hasText', target: '.fixed', value: 'Auth Sprint' },
			// AUTO type pill shown
			{ verb: 'hasText', target: '.fixed', value: 'AUTO' },
			// Markdown-rendered body content present
			{ verb: 'hasText', target: '.fixed', value: 'Refactored auth module' },
			// Close button labeled "Close" in footer
			{ verb: 'hasText', target: '.fixed', value: 'Close' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-user-entry-with-type-pill',
		given:
			'HistoryDetailModal mounts with HistoryEntry { type: "USER", summary: "Asked about JWT validation", fullResponse: "Asked about JWT validation", sessionName: "Auth Sprint" }.',
		when: ['the modal renders its header'],
		then: [
			// USER type pill shown
			{ verb: 'hasText', target: '.fixed', value: 'USER' },
			// Body content present
			{ verb: 'hasText', target: '.fixed', value: 'Asked about JWT validation' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-session-id-octet-and-resume-button-when-supplied',
		given:
			'HistoryDetailModal mounts with HistoryEntry { type: "AUTO", success: true, agentSessionId: "abc12345-6789-defg-hijk-lmnopqrstuvw" } and onResumeSession=() => {}.',
		when: ['the modal renders its session-id pill cluster'],
		then: [
			// Session ID octet (first segment, uppercase).
			{ verb: 'hasText', target: '.fixed', value: 'ABC12345' },
			// Resume button is rendered when onResumeSession is supplied.
			{ verb: 'hasText', target: '.fixed', value: 'Resume' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-prev-next-navigation-when-canNavigate-true',
		given:
			'HistoryDetailModal mounts with filteredEntries=[entry0, entry1, entry2], currentIndex=1, onNavigate=() => {}, entry=entry1 — the canNavigate predicate is true and the middle index allows both prev and next.',
		when: ['the modal renders its footer'],
		then: [
			// Prev button rendered.
			{ verb: 'hasText', target: '.fixed', value: 'Prev' },
			// Next button rendered.
			{ verb: 'hasText', target: '.fixed', value: 'Next' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-delete-button-when-onDelete-supplied',
		given:
			'HistoryDetailModal mounts with onDelete=() => {} and any HistoryEntry. The Delete button must render in the footer.',
		when: ['the modal renders its footer'],
		then: [
			// Delete button rendered.
			{ verb: 'hasText', target: '.fixed', value: 'Delete' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-validated-toggle-for-auto-success-with-onUpdate',
		given:
			'HistoryDetailModal mounts with HistoryEntry { type: "AUTO", success: true, validated: false } and onUpdate=async () => true. The Validated toggle must render with "Validated" label.',
		when: ['the modal renders the validated affordance'],
		then: [
			// Validated toggle button rendered with label.
			{ verb: 'hasText', target: '.fixed', value: 'Validated' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-delete-confirmation-modal-when-delete-clicked',
		given:
			'HistoryDetailModal is mounted with onDelete=() => {}. The user clicks the Delete button.',
		when: ['the user clicks the Delete button'],
		then: [
			// Confirmation modal header.
			{ verb: 'hasText', target: '.fixed', value: 'Delete History Entry' },
			// Confirmation prompt copy includes the warning.
			{ verb: 'hasText', target: '.fixed', value: 'Are you sure you want to delete' },
			// Confirmation Cancel button.
			{ verb: 'hasText', target: '.fixed', value: 'Cancel' },
		],
		happyPath: true,
	},
	{
		name: 'history-detail-modal-renders-agent-name-header-when-provided',
		given:
			'HistoryDetailModal mounts with HistoryEntry that carries `agentName: "claude-code"` (from Director\'s Notes unified history shape). The agent name renders as the prominent header above the session name.',
		when: ['the modal renders its header'],
		then: [
			// Agent name surfaced in header.
			{ verb: 'hasText', target: '.fixed', value: 'claude-code' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'history-detail-modal-omits-prev-next-when-canNavigate-false',
		given:
			'HistoryDetailModal mounts WITHOUT filteredEntries / currentIndex / onNavigate — the canNavigate predicate evaluates to false; the Prev/Next buttons must NOT render.',
		when: ['the modal renders its footer'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No Prev button.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Prev")))',
			},
			// No Next button.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Next")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-omits-delete-button-when-onDelete-undefined',
		given:
			'HistoryDetailModal mounts WITHOUT onDelete. The Delete button must NOT render in the footer.',
		when: ['the modal renders its footer'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No Delete button.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Delete")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-omits-session-id-octet-when-no-agentSessionId',
		given:
			'HistoryDetailModal mounts with HistoryEntry that has NO agentSessionId. The session-id pill cluster must NOT render — no octet, no Copy, no Resume.',
		when: ['the modal renders its header pill row'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No Resume button (Resume is gated behind agentSessionId AND onResumeSession).
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Resume")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-omits-validated-toggle-when-onUpdate-undefined',
		given:
			'HistoryDetailModal mounts with HistoryEntry { type: "AUTO", success: true } but WITHOUT onUpdate. The Validated toggle must NOT render.',
		when: ['the modal renders the validated affordance'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No Validated label.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Validated")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-omits-validated-toggle-for-user-entries',
		given:
			'HistoryDetailModal mounts with HistoryEntry { type: "USER" } and onUpdate=async () => true. The Validated toggle is gated behind `type === "AUTO" && success && onUpdate` — USER entries must NOT render it.',
		when: ['the modal renders the validated affordance'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No Validated label.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(button:has-text("Validated")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-omits-stats-panel-when-no-usage-or-elapsed',
		given:
			'HistoryDetailModal mounts with HistoryEntry that has NO usageStats AND NO elapsedTimeMs. The stats panel (context usage bar + tokens + elapsed + cost) must NOT render.',
		when: ['the modal renders its body region'],
		then: [
			// Modal still renders.
			{ verb: 'hasElement', target: '.fixed' },
			// No "Context" label from the stats panel.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(:has-text("Context")))',
			},
			// No "Tokens" label from the stats panel.
			{
				verb: 'hasElement',
				target: '.fixed:not(:has(:has-text("Tokens")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-arrow-keys-noop-when-delete-confirm-showing',
		given:
			'HistoryDetailModal is mounted with full navigation props (filteredEntries / currentIndex / onNavigate) and the user has clicked Delete so the internal confirmation modal is open. ArrowLeft / ArrowRight must NOT navigate while the confirm is showing — the keyboard handler short-circuits on `showDeleteConfirm`.',
		when: ['the user presses ArrowLeft', 'the user presses ArrowRight'],
		then: [
			// Delete confirmation modal still visible (not dismissed or skipped past).
			{ verb: 'hasText', target: '.fixed', value: 'Delete History Entry' },
		],
		happyPath: false,
	},
	{
		name: 'history-detail-modal-escape-key-closes-via-layer-stack',
		given:
			'HistoryDetailModal is the topmost layer with stub onClose. The Modal registers `onEscape: () => onCloseRef.current()` on the layer stack.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes — no more `.history-detail-content` container in the body.
			{ verb: 'hasElement', target: 'body:not(:has(.history-detail-content))' },
		],
		happyPath: false,
	},
];

describe('HistoryDetailModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = historyDetailModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = historyDetailModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = historyDetailModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of historyDetailModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of historyDetailModalParityCatalog) {
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
		for (const story of historyDetailModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('has no duplicate story names', () => {
		const names = historyDetailModalParityCatalog.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
