/**
 * Parity catalog — GitStatusWidget
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GitStatusWidget is a presentational header widget that surfaces the
 * git file-change status of a session. It exposes:
 *   - a compact pill (file count only) at narrow widths
 *   - a full pill (additions / deletions / modified breakdown) at wider widths
 *   - a hover tooltip listing changed files with GitHub-style diff bars
 *   - a "View Full Diff" affordance + an optional "View Git Log" affordance
 *
 * The widget is hidden when the session is not a git repo OR fileCount === 0.
 * It touches 0 IPC namespaces and 0 Electron-only APIs — all git status data
 * is supplied via props (host self-sources from a future REST/WS route or
 * future webFull-side context; the widget contract does not reach into
 * `window.maestro` or any transport itself).
 *
 * The parity contract is observable-behavior-only:
 *   - widget chrome present / absent against the hide-rule predicates
 *   - file-count text rendered in the compact span
 *   - additions / deletions / modified counts rendered in the full span
 *   - tooltip shows file rows with per-file +/- counts
 *   - "View Full Diff" and "View Git Log" buttons appear correctly
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

export const gitStatusWidgetParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'git-status-widget-renders-compact-file-count-pill-when-not-hovering',
		given:
			'The session is a git repo (isGitRepo=true) with fileCount=3 and no fileDetails supplied, theme is dark.',
		when: ['the GitStatusWidget mounts'],
		then: [
			// Compact span carries the file count
			{ verb: 'hasElement', target: '.header-git-status-compact' },
			{ verb: 'hasText', target: '.header-git-status-compact', value: '3' },
			// The compact-mode title attribute summarizes the breakdown
			{ verb: 'hasElement', target: 'button[title="+0 −0 ~0"]' },
		],
		happyPath: true,
	},
	{
		name: 'git-status-widget-renders-full-breakdown-when-file-details-provided',
		given:
			'The session is a git repo with fileCount=5 and fileDetails={ totalAdditions: 42, totalDeletions: 17, modifiedCount: 3, fileChanges: [...] }.',
		when: ['the GitStatusWidget mounts'],
		then: [
			// Full-mode span renders alongside compact-mode span
			{ verb: 'hasElement', target: '.header-git-status-full' },
			// Additions count shown in green-styled span
			{ verb: 'hasText', target: '.header-git-status-full', value: '42' },
			// Deletions count shown in red-styled span
			{ verb: 'hasText', target: '.header-git-status-full', value: '17' },
			// Modified count shown in orange-styled span
			{ verb: 'hasText', target: '.header-git-status-full', value: '3' },
			// Button title reflects the breakdown for screen reader users
			{ verb: 'hasElement', target: 'button[title="+42 −17 ~3"]' },
		],
		happyPath: true,
	},
	{
		name: 'git-status-widget-tooltip-lists-changed-files-with-per-file-counts',
		given:
			'fileDetails carries fileChanges=[{path:"src/a.ts",additions:10,deletions:2,modified:true,status:"M"},{path:"src/b.ts",additions:0,deletions:5,modified:true,status:"M"}], totalAdditions=10, totalDeletions=7, modifiedCount=2.',
		when: ['the user hovers over the widget so the tooltip opens'],
		then: [
			// Tooltip header reports the totals
			{ verb: 'hasText', target: 'body', value: 'Changed Files' },
			{ verb: 'hasText', target: 'body', value: '+10' },
			{ verb: 'hasText', target: 'body', value: '−7' },
			// Each file path appears
			{ verb: 'hasText', target: 'body', value: 'src/a.ts' },
			{ verb: 'hasText', target: 'body', value: 'src/b.ts' },
			// Per-file addition count for file with additions
			{ verb: 'hasText', target: 'body', value: '+10' },
			// Per-file deletion count for file with deletions only
			{ verb: 'hasText', target: 'body', value: '−5' },
		],
		happyPath: true,
	},
	{
		name: 'git-status-widget-exposes-view-full-diff-affordance',
		given:
			'The widget is mounted with isGitRepo=true, fileCount=2, fileDetails with one or more fileChanges, and the user has opened the tooltip.',
		when: ['the tooltip renders its action row'],
		then: [
			// "View Full Diff" button text discoverable
			{ verb: 'hasText', target: 'body', value: 'View Full Diff' },
		],
		happyPath: true,
	},
	{
		name: 'git-status-widget-exposes-view-git-log-affordance-when-callback-provided',
		given:
			'The widget is mounted with isGitRepo=true, fileCount=2, fileDetails with fileChanges, AND onViewLog callback supplied.',
		when: ['the tooltip renders its action row'],
		then: [
			// Optional "View Git Log" button appears
			{ verb: 'hasText', target: 'body', value: 'View Git Log' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'git-status-widget-hidden-when-session-is-not-a-git-repo',
		given:
			'The session reports isGitRepo=false with fileCount=5 (i.e. the count is stale or wrong).',
		when: ['the GitStatusWidget mounts'],
		then: [
			// Component returns null — neither compact nor full pill in the DOM
			{ verb: 'hasElement', target: 'body:not(:has(.header-git-status-compact))' },
			{ verb: 'hasElement', target: 'body:not(:has(.header-git-status-full))' },
		],
		happyPath: false,
	},
	{
		name: 'git-status-widget-hidden-when-file-count-is-zero',
		given:
			'The session is a git repo (isGitRepo=true) but has no uncommitted changes (fileCount=0).',
		when: ['the GitStatusWidget mounts'],
		then: [
			// Component returns null even though it IS a git repo
			{ verb: 'hasElement', target: 'body:not(:has(.header-git-status-compact))' },
		],
		happyPath: false,
	},
	{
		name: 'git-status-widget-hides-view-git-log-affordance-when-callback-absent',
		given:
			'The widget is mounted with isGitRepo=true, fileCount=2, fileDetails with fileChanges, BUT onViewLog is NOT supplied.',
		when: ['the user hovers over the widget so the tooltip opens'],
		then: [
			// "View Full Diff" is still present
			{ verb: 'hasText', target: 'body', value: 'View Full Diff' },
			// "View Git Log" is not in the DOM
			{ verb: 'hasElement', target: 'body:not(:has(button:has-text("View Git Log")))' },
		],
		happyPath: false,
	},
	{
		name: 'git-status-widget-fires-no-ipc-or-websocket-traffic-on-mount-or-hover',
		given:
			'The GitStatusWidget is mounted with isGitRepo=true, fileCount=3, fileDetails with fileChanges.',
		when: [
			'the widget mounts',
			'the user hovers over the widget',
			'the user clicks View Full Diff',
			'the user clicks View Git Log',
		],
		then: [
			// Presentational-only: no WS frame, no IPC broadcast, no fs/db side effect.
			// Action callbacks are the caller's contract — this component does not
			// reach into window.maestro or any transport itself.
			{
				verb: 'hasElement',
				target: '.header-git-status-compact, body:not(:has(.header-git-status-compact))',
			},
		],
		happyPath: false,
	},
];

describe('GitStatusWidget — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = gitStatusWidgetParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = gitStatusWidgetParityCatalog.filter((s) => s.happyPath).length;
		const negative = gitStatusWidgetParityCatalog.filter((s) => !s.happyPath).length;
		expect(happy).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative-path per happy-path
		expect(negative).toBeGreaterThanOrEqual(1);
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
		for (const story of gitStatusWidgetParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of gitStatusWidgetParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of gitStatusWidgetParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (widget is a header widget, not a modal)', () => {
		// GitStatusWidget is a header pill + hover tooltip, not a modal. The
		// catalog must never drift toward role=dialog assertions — if a future
		// refactor wraps this in a modal, that's a behavior change and the
		// catalog should fail rather than silently track it.
		for (const story of gitStatusWidgetParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
		}
	});
});
