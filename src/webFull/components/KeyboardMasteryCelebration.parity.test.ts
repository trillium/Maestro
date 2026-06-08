/**
 * Parity catalog — KeyboardMasteryCelebration
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * KeyboardMasteryCelebration is a large celebration modal that fires when
 * the user reaches a new keyboard mastery level (one of: Beginner = 0,
 * Student = 1, Performer = 2, Virtuoso = 3, Maestro = 4). It accepts
 * `theme`, `level`, `onClose`, and two optional props (`shortcuts`,
 * `disableConfetti`). It touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * The parity contract is observable-behavior-only: the modal renders with
 * the right title text ("Level Up!" for levels 0-3 vs "Keyboard Maestro!"
 * for level 4), surfaces the level name + description from the renderer's
 * canonical `KEYBOARD_MASTERY_LEVELS` constant, renders the progression
 * dot-row (one dot per level, filled up through the current level with
 * gold for the Maestro dot), renders the encouragement message (next-level
 * pointer for levels 0-3, "mastered all" copy for level 4), renders the
 * shortcut hint with the platform-aware ⌘/Ctrl glyph, exposes a Continue
 * button that flips to "Onwards!" during the close animation, and
 * dismisses via Continue / Enter / Escape / backdrop click without
 * committing any state changes outside `onClose`.
 *
 * The Maestro variation (level === 4) swaps: title text → "Keyboard
 * Maestro!", icon → `Trophy`, accent → gold, dismiss-button gradient →
 * purple→gold (instead of purple→pink), encouragement copy → "You've
 * mastered all keyboard shortcuts!" (instead of "Keep using shortcuts to
 * reach <next level>!"), plus an extra delayed gold-star confetti burst.
 * The celebration-on-close pattern: clicking the dismiss button (or
 * pressing Enter/Escape) sets `isClosing`, fires a second confetti burst,
 * then calls `onClose()` after an 800ms animation delay — this is
 * intentional source fidelity and is pinned as a negative-path story so
 * future refactors don't strip the animation transition.
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

export const keyboardMasteryCelebrationParityCatalog: ParityStory[] = [
	// ============ Happy path: standard "Level Up!" variation (level 0-3) ============
	{
		name: 'keyboard-mastery-celebration-standard-shows-level-up-chrome',
		given:
			'The user has just crossed into a non-Maestro mastery tier (e.g. level = 2, the Performer tier with description "Getting comfortable").',
		when: ['the KeyboardMasteryCelebration modal mounts with the standard variation'],
		then: [
			// Dialog chrome with the canonical aria-label
			{
				verb: 'hasElement',
				target: '[role="dialog"][aria-label="Keyboard Mastery Level Up"]',
			},
			// Standard title text — Level Up! (NOT Keyboard Maestro!)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Level Up!' },
			// The level name from KEYBOARD_MASTERY_LEVELS surfaces in the header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Performer' },
			// The level description from KEYBOARD_MASTERY_LEVELS surfaces in the body
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Getting comfortable' },
			// Dismiss button labelled "Continue" (NOT "Onwards!" — that's the closing state)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Continue' },
		],
		happyPath: true,
	},
	{
		name: 'keyboard-mastery-celebration-renders-next-level-encouragement',
		given:
			'The KeyboardMasteryCelebration modal is open at level = 1 (Student tier — next level is Performer).',
		when: ['the body renders the encouragement message + shortcut hint'],
		then: [
			// Encouragement copy points the user at the next level by name
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'Keep using shortcuts to reach Performer',
			},
			// Shortcut hint copy anchors the help-shortcut reference
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: 'to see all shortcuts and your progress',
			},
			// Dismiss hint copy at the bottom of the modal
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Press Enter or Escape to dismiss' },
		],
		happyPath: true,
	},
	{
		name: 'keyboard-mastery-celebration-renders-progress-dot-row',
		given:
			'The KeyboardMasteryCelebration modal is open at any non-Maestro level (e.g. level = 3).',
		when: ['the progression indicator block renders'],
		then: [
			// Five level dots render — one per KEYBOARD_MASTERY_LEVELS entry. They
			// are <div> elements with the w-8 h-1.5 rounded-full class shape and
			// are children of the dialog. Pin existence via a div.w-8 selector
			// scoped inside the dialog (presentational anchor, not interactive).
			{
				verb: 'hasElement',
				target: '[role="dialog"] div.w-8',
			},
		],
		happyPath: true,
	},
	{
		name: 'keyboard-mastery-celebration-maestro-variation-fires-at-level-4',
		given:
			'The user has just reached the highest mastery tier (level = 4, the Maestro tier with description "Complete mastery").',
		when: ['the KeyboardMasteryCelebration modal mounts'],
		then: [
			// Title flips to "Keyboard Maestro!" (NOT "Level Up!")
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Keyboard Maestro!' },
			// Maestro variation: subhead reads "the highest level" (NOT the level name)
			{ verb: 'hasText', target: '[role="dialog"]', value: 'the highest level' },
			// Encouragement copy flips to the "mastered all" message (NOT "Keep using ...")
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: "You've mastered all keyboard shortcuts!",
			},
		],
		happyPath: true,
	},
	{
		name: 'keyboard-mastery-celebration-boundary-level-zero-renders-beginner',
		given:
			'The KeyboardMasteryCelebration modal is open at level = 0 (the Beginner tier — the lowest non-Maestro level, an explicit boundary pin).',
		when: ['the standard variation renders'],
		then: [
			// The Beginner level name surfaces — this story guards against a
			// future refactor that uses `if (level)` instead of an explicit
			// `level === 4` check, which would suppress the Beginner case or
			// misroute it through the Maestro branch.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Beginner' },
			// The Beginner level description from KEYBOARD_MASTERY_LEVELS
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Just starting out' },
			// Title is still "Level Up!" — confirms level=0 takes the standard path
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Level Up!' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'keyboard-mastery-celebration-continue-button-closes-modal',
		given: 'The KeyboardMasteryCelebration modal is open.',
		when: [
			'the user clicks the Continue button',
			'the closing-confetti burst plays for the 800ms transition window',
		],
		then: [
			// After the close-animation timeout fires `onClose`, the dialog unmounts.
			// Pinned at end-of-transition: no [role="dialog"] under body.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'keyboard-mastery-celebration-escape-key-closes-modal',
		given:
			'The KeyboardMasteryCelebration modal is the topmost layer with focus trapped (focusTrap: strict).',
		when: [
			'the user presses Escape',
			'the closing-confetti burst plays for the 800ms transition window',
		],
		then: [
			// Escape routes through the layer-stack onEscape handler bound to handleClose.
			// Modal closes after the same 800ms animation delay.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'keyboard-mastery-celebration-backdrop-click-closes-modal',
		given:
			'The KeyboardMasteryCelebration modal is open with the dark backdrop overlay rendered at z-index 99997.',
		when: [
			'the user clicks the backdrop outside the modal card',
			'the closing-confetti burst plays for the 800ms transition window',
		],
		then: [
			// Backdrop has onClick={handleClose}; card has onClick={(e) => e.stopPropagation()}.
			// Click on backdrop closes; click on card does NOT close.
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'keyboard-mastery-celebration-no-next-level-copy-at-maestro',
		given:
			'The KeyboardMasteryCelebration modal opens at level = 4 (Maestro). The "Keep using shortcuts to reach X" copy belongs only to the non-Maestro branch.',
		when: ['the encouragement message renders'],
		then: [
			// At Maestro level, the "Keep using shortcuts to reach" copy MUST NOT
			// render — there is no next level. Pin via a negation selector so the
			// absence is an observable assertion.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(p:text("Keep using shortcuts to reach the next level")))',
			},
			// Mastered-all copy IS rendered (sanity pin that we landed on the
			// Maestro branch, not the standard branch with an empty next-level).
			{
				verb: 'hasText',
				target: '[role="dialog"]',
				value: "You've mastered all keyboard shortcuts!",
			},
		],
		happyPath: false,
	},
	{
		name: 'keyboard-mastery-celebration-no-level-up-copy-at-maestro',
		given:
			'The KeyboardMasteryCelebration modal opens at level = 4. The "Level Up!" title belongs only to the non-Maestro branch (levels 0-3).',
		when: ['the header renders'],
		then: [
			// At Maestro level, the "Level Up!" title MUST NOT render — the
			// header title flips to "Keyboard Maestro!" exclusively.
			{
				verb: 'hasElement',
				target: '[role="dialog"]:not(:has(h1:text("Level Up!")))',
			},
			// And the Maestro title IS rendered — sanity pin that we landed on
			// the Maestro branch.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Keyboard Maestro!' },
		],
		happyPath: false,
	},
];

describe('KeyboardMasteryCelebration — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(keyboardMasteryCelebrationParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = keyboardMasteryCelebrationParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = keyboardMasteryCelebrationParityCatalog.filter((s) => s.happyPath).length;
		const negative = keyboardMasteryCelebrationParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of keyboardMasteryCelebrationParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of keyboardMasteryCelebrationParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of keyboardMasteryCelebrationParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
