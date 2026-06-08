/**
 * Parity catalog — AutoRunnerHelpModal
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRunnerHelpModal is a pure presentational documentation modal. It
 * accepts `theme` + `onClose` and renders thirteen labelled sections
 * (Introduction, Setting Up, Document Format, Creating Tasks, Image
 * Attachments, Running Single, Running Multiple, Template Variables, Reset
 * on Completion, Loop Mode, Playbooks, History & Tracking, Read-Only Mode,
 * Stopping, Keyboard Shortcuts) plus a single "Got it" dismiss button in
 * the footer. It touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * The parity contract is therefore observable-behavior-only: the modal
 * renders with the right header, surfaces the documentation copy a user
 * relies on to understand Auto Run, exposes the keyboard-shortcut tutor
 * rows that depend on the platform-aware `formatShortcutKeys` helper, and
 * dismisses via Got it / Escape / backdrop click without committing any
 * state changes (this modal is read-only — `onClose` is the only callback).
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

export const autoRunnerHelpModalParityCatalog: ParityStory[] = [
	// ============ Happy path: modal chrome + dismiss affordance ============
	{
		name: 'autorunner-help-modal-shows-title-and-got-it-button',
		given: 'The user opens the Auto Run help from the Auto Run panel header.',
		when: ['the AutoRunnerHelpModal mounts'],
		then: [
			// Dialog chrome with the help title
			{ verb: 'hasElement', target: '[role="dialog"][aria-label="Auto Run Guide"]' },
			// Title in header
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Auto Run Guide' },
			// Dismiss button labelled "Got it"
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Got it' },
		],
		happyPath: true,
	},
	{
		name: 'autorunner-help-modal-renders-core-documentation-sections',
		given: 'The AutoRunnerHelpModal is open.',
		when: ['the modal renders its body'],
		then: [
			// Section headings the user scans to learn the feature
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Setting Up a Runner Docs Folder' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Document Format' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Creating Tasks' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Running a Single Document' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Running Multiple Documents' },
		],
		happyPath: true,
	},
	{
		name: 'autorunner-help-modal-renders-advanced-feature-sections',
		given: 'The AutoRunnerHelpModal is open.',
		when: ['the modal renders its body'],
		then: [
			// Advanced feature headings — these are the load-bearing differentiators
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Template Variables' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Reset on Completion' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Loop Mode' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Playbooks' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Read-Only Mode' },
		],
		happyPath: true,
	},
	{
		name: 'autorunner-help-modal-surfaces-playbook-concept-inline',
		given: 'The AutoRunnerHelpModal is open with the introduction section visible.',
		when: ['the user reads the introduction copy'],
		then: [
			// The "Playbook" concept is introduced inline so the rest of the doc has a name to refer to.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Playbook' },
			// And the body section header is also rendered.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Sharing Playbooks:' },
			// And the Playbook Exchange callout — gateway to community-contributed content.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Playbook Exchange' },
		],
		happyPath: true,
	},
	{
		name: 'autorunner-help-modal-renders-keyboard-shortcut-tutor-labels',
		given:
			'The AutoRunnerHelpModal is open and the user scrolls to the Keyboard Shortcuts section.',
		when: ['the modal renders its keyboard-shortcut tutor rows'],
		then: [
			// Section heading anchors the tutor block
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Keyboard Shortcuts' },
			// Each row describes what the chord does — the platform-aware kbd labels themselves render
			// via formatShortcutKeys(...) which differs per platform, so the contract here is the
			// human-readable action label, not the symbol string.
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Open Auto Run tab' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Toggle Edit/Preview mode' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Insert checkbox at cursor' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Undo' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Redo' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorunner-help-modal-got-it-button-closes-modal',
		given: 'The AutoRunnerHelpModal is open.',
		when: ['the user clicks the Got it button'],
		then: [
			// Modal dismounts via onClose
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorunner-help-modal-escape-key-closes-modal',
		given: 'The AutoRunnerHelpModal is the topmost layer.',
		when: ['the user presses Escape'],
		then: [
			// Modal closes via the layer-stack onEscape route bound by ModalProps.onClose
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorunner-help-modal-backdrop-click-closes-modal',
		given: 'The AutoRunnerHelpModal is open with closeOnBackdropClick enabled.',
		when: ['the user clicks the backdrop outside the modal panel'],
		then: [
			// Modal closes — source passes closeOnBackdropClick to the Modal primitive
			{ verb: 'hasElement', target: 'body:not(:has([role="dialog"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorunner-help-modal-does-not-render-action-buttons-beyond-got-it',
		given: 'The AutoRunnerHelpModal is open.',
		when: ['the modal renders its footer'],
		then: [
			// This is a read-only help modal — it must NOT surface destructive labels like
			// Delete, Cancel, Save, Remove. Asserting their absence guards against accidental
			// composition with ModalFooter / ConfirmModal during future refactors.
			{ verb: 'hasElement', target: '[role="dialog"]:not(:has(button:text("Delete")))' },
			{ verb: 'hasElement', target: '[role="dialog"]:not(:has(button:text("Save")))' },
			{ verb: 'hasElement', target: '[role="dialog"]:not(:has(button:text("Remove")))' },
		],
		happyPath: false,
	},
	{
		name: 'autorunner-help-modal-keyboard-shortcut-rows-render-without-platform-bridge',
		given: 'The AutoRunnerHelpModal is open in the webFull runtime (no Electron preload bridge).',
		when: ['the keyboard-shortcut tutor rows render their <kbd> labels'],
		then: [
			// The webFull shortcutFormatter shim resolves platform via navigator.userAgent rather
			// than window.maestro.platform; rendering must not throw and the action labels must
			// still appear next to their kbd siblings. This pins the contract that the lift's
			// transitive platform dependency was correctly swapped at the shim boundary.
			{ verb: 'hasElement', target: '[role="dialog"] kbd' },
			{ verb: 'hasText', target: '[role="dialog"]', value: 'Open Auto Run tab' },
		],
		happyPath: false,
	},
];

describe('AutoRunnerHelpModal — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(autoRunnerHelpModalParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = autoRunnerHelpModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunnerHelpModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunnerHelpModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunnerHelpModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunnerHelpModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.'];
		for (const story of autoRunnerHelpModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
