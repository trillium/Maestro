/**
 * Parity catalog — FirstRunCelebration
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * FirstRunCelebration is a large celebration modal that fires on the user's
 * first completed Auto Run. It accepts `theme`, `elapsedTimeMs`,
 * `completedTasks`, `totalTasks`, `onClose`, and three optional props
 * (`onOpenLeaderboardRegistration`, `isLeaderboardRegistered`,
 * `disableConfetti`). It touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * The parity contract is therefore observable-behavior-only: the modal
 * renders with the right header (Congratulations! vs Standing Ovation!
 * depending on elapsed time vs the 15-minute threshold), surfaces the
 * duration pill + task-count summary, renders the encouraging-message
 * card + three-row "What's Next?" block (Explore docs / Continue building
 * / Start fresh with the platform-aware keyboard shortcut hint), exposes
 * the optional "Join Global Leaderboard" CTA only when both
 * `onOpenLeaderboardRegistration` is provided AND `isLeaderboardRegistered`
 * is falsy, and dismisses via Got It / Enter / Escape / backdrop click
 * without committing any state changes outside `onClose`.
 *
 * Standing Ovation variation triggers at elapsedTimeMs >= 15 * 60 * 1000
 * (15 minutes) and swaps: title text → "Standing Ovation!", icon →
 * `Trophy`, accent → gold, plus a "Your AI worked autonomously for over
 * 15 minutes!" sub-tagline flanked by Star icons. The celebration-on-close
 * pattern: the modal fires a second confetti burst on dismiss and waits
 * 1000ms before calling onClose — this is intentional source fidelity and
 * is pinned as a negative-path story so future refactors don't strip the
 * animation transition.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path per happy-path
 * story. This catalog ships 5 happy + 5 negative = 10 stories.
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

export const firstRunCelebrationParityCatalog: ParityStory[] = [
	// ============ Happy path: standard "Congratulations!" variation ============
	{
		name: 'first-run-celebration-standard-shows-congratulations-chrome',
		given:
			'The user has just completed their first Auto Run in under 15 minutes (e.g. elapsedTimeMs = 5 * 60 * 1000, completedTasks = 3, totalTasks = 3).',
		when: ['the FirstRunCelebration modal mounts with the standard variation'],
		then: [
			// Dialog chrome with the standard celebration aria-label
			{
				verb: 'hasElement',
				target: '[role="dialog"][aria-label="First Auto Run Celebration"]',
			},
			// Standard title text — Congratulations! (NOT Standing Ovation!)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Congratulations!' },
			// The "you just completed your first Auto Run" sub-line is the constant tagline
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'You just completed your first Auto Run',
			},
			// Dismiss button labelled "Got It!" (capital I, exclamation)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Got It!' },
		],
		happyPath: true,
	},
	{
		name: 'first-run-celebration-renders-duration-and-task-summary',
		given:
			'The FirstRunCelebration modal is open with elapsedTimeMs = 5 minutes 30 seconds, completedTasks = 3, totalTasks = 5.',
		when: ['the duration display block renders'],
		then: [
			// Formatted duration string surfaces in the pill — the formatDuration helper
			// produces "5 minutes 30 seconds" for 330000 ms.
			{ verb: 'hasText', target: '[role="dialog"]', value: '5 minutes 30 seconds' },
			// Task-count summary uses the bullet glyph + completed/total/tasks copy
			{ verb: 'hasText', target: '[role="dialog"]', value: '3 of 5 tasks completed' },
		],
		happyPath: true,
	},
	{
		name: 'first-run-celebration-renders-encouraging-message-and-next-steps',
		given: 'The FirstRunCelebration modal is open.',
		when: ['the body renders the encouraging-message card and the three "What\'s Next?" rows'],
		then: [
			// The "What's Next?" section header anchors the next-steps block
			{ verb: 'hasText', target: '[role="dialog"]', value: "What's Next?" },
			// The encouraging-message card's load-bearing phrase
			{ verb: 'hasText', target: '[role="dialog"]', value: 'hours if not days' },
			// Row 1: Explore additional Auto Run documents
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Explore the additional Auto Run documents',
			},
			// Row 2: Continue building
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Continue building your project' },
			// Row 3: Start fresh with new ideas — wizard shortcut hint
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Or start fresh with new ideas' },
			// Wizard shortcut row uses formatShortcutKeys(['Meta','Shift','n']) — the
			// human-readable copy "to open the wizard anytime" is the platform-independent anchor.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'to open the wizard anytime' },
		],
		happyPath: true,
	},
	{
		name: 'first-run-celebration-standing-ovation-variation-fires-over-15-minutes',
		given:
			'The user has just completed their first Auto Run after 20 minutes (elapsedTimeMs = 20 * 60 * 1000 = 1200000).',
		when: ['the FirstRunCelebration modal mounts'],
		then: [
			// Title flips to "Standing Ovation!" (NOT "Congratulations!")
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Standing Ovation!' },
			// Standing-Ovation tagline appears (does NOT render in the standard variation)
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Your AI worked autonomously for over 15 minutes!',
			},
			// Duration pill still renders the human-readable duration
			{ verb: 'hasText', target: '[role="dialog"]', value: '20 minutes' },
		],
		happyPath: true,
	},
	{
		name: 'first-run-celebration-leaderboard-cta-shown-when-not-registered',
		given:
			'The FirstRunCelebration modal opens with `onOpenLeaderboardRegistration` provided AND `isLeaderboardRegistered=false`.',
		when: ['the footer block renders the optional CTA'],
		then: [
			// CTA label rendered
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Join Global Leaderboard' },
			// Dismiss hint copy still surfaces below the CTAs
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Press Enter or Escape to dismiss' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'first-run-celebration-got-it-button-closes-modal',
		given: 'The FirstRunCelebration modal is open.',
		when: [
			'the user clicks the Got It! button',
			'the closing-confetti burst plays for the 1000ms transition window',
		],
		then: [
			// After the close-animation timeout fires `onClose`, the dialog unmounts.
			// Pinned at end-of-transition: no [role="dialog"] under body.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'first-run-celebration-escape-key-closes-modal',
		given:
			'The FirstRunCelebration modal is the topmost layer with focus trapped (focusTrap: strict).',
		when: [
			'the user presses Escape',
			'the closing-confetti burst plays for the 1000ms transition window',
		],
		then: [
			// Escape routes through the layer-stack onEscape handler bound to handleClose.
			// Modal closes after the same 1000ms animation delay.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'first-run-celebration-backdrop-click-closes-modal',
		given:
			'The FirstRunCelebration modal is open with the dark backdrop overlay rendered at z-index 99997.',
		when: [
			'the user clicks the backdrop outside the modal card',
			'the closing-confetti burst plays for the 1000ms transition window',
		],
		then: [
			// Backdrop has onClick={handleClose}; card has onClick={(e) => e.stopPropagation()}.
			// Click on backdrop closes; click on card does NOT close.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'first-run-celebration-leaderboard-cta-hidden-when-already-registered',
		given:
			'The FirstRunCelebration modal opens with `onOpenLeaderboardRegistration` provided BUT `isLeaderboardRegistered=true`.',
		when: ['the footer block renders'],
		then: [
			// The CTA must NOT render — guards against accidentally re-soliciting registered users.
			// The dismiss hint still renders to confirm the footer block itself rendered.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(button:text("Join Global Leaderboard")))',
			},
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Press Enter or Escape to dismiss' },
		],
		happyPath: false,
	},
	{
		name: 'first-run-celebration-standing-ovation-tagline-absent-under-threshold',
		given:
			'The FirstRunCelebration modal opens with elapsedTimeMs = 14 * 60 * 1000 — one minute under the 15-minute threshold.',
		when: ['the header renders'],
		then: [
			// Standard variation: title is Congratulations!, NOT Standing Ovation!
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Congratulations!' },
			// Standing-Ovation tagline must NOT render (15-minute threshold is strict >=).
			// Pin via a negation selector on the dialog so the absence is an observable assertion.
			{
				verb: 'hasElement',
				target:
					'[role="dialog"]:not(:has(span:text("Your AI worked autonomously for over 15 minutes!")))',
			},
		],
		happyPath: false,
	},
];

describe('FirstRunCelebration — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(firstRunCelebrationParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = firstRunCelebrationParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = firstRunCelebrationParityCatalog.filter((s) => s.happyPath).length;
		const negative = firstRunCelebrationParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: ≥1 negative-path per happy-path. Honoured when negative >= happy.
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
		for (const story of firstRunCelebrationParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of firstRunCelebrationParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of firstRunCelebrationParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
