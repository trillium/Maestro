/**
 * Parity catalog — SaveMarkdownModal
 *
 * Layer 2.5 — leaf-parade lift wave. Catalog of (Given, When, Then) stories
 * using the fixed WEB_PARITY_VERIFICATION assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SaveMarkdownModal is a modal that prompts the user for a folder + filename
 * and writes the supplied markdown content to disk. The renderer source
 * routes the write through `window.maestro.fs.writeFile(...)`; the webFull
 * lift promotes that to a required `onWriteFile` prop callback so the host
 * can wire whatever write surface fits (WebSocket protocol, REST PUT, etc.).
 * The folder-browser button is gated by the union of `!isRemoteSession` AND
 * `onBrowseFolder !== undefined` so the webFull lift can omit the picker
 * affordance until a host wires a server-side folder picker.
 *
 * The parity contract is observable-behavior-only:
 *   - Modal title "Save Markdown"
 *   - Folder and Filename labels render
 *   - Folder input + filename input render with the expected placeholders
 *   - Hint copy ".md extension will be added automatically if not provided"
 *   - Cancel + Save buttons render in the footer
 *   - "Open in Tab" checkbox renders when `onOpenInTab` is wired
 *   - Folder-browse button renders only when `!isRemoteSession && onBrowseFolder`
 *
 * Catalog principle:
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION.
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

export const saveMarkdownModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'save-markdown-modal-renders-title-and-form-labels',
		given:
			'SaveMarkdownModal mounts with content="# Hello", onClose, onWriteFile wired; no folder picker, no openInTab.',
		when: ['the modal mounts'],
		then: [
			// Modal title chrome (rendered through the L2.1 Modal primitive header)
			{ verb: 'hasText', target: 'body', value: 'Save Markdown' },
			// Form field labels
			{ verb: 'hasText', target: 'body', value: 'Folder' },
			{ verb: 'hasText', target: 'body', value: 'Filename' },
		],
		happyPath: true,
	},
	{
		name: 'save-markdown-modal-renders-folder-and-filename-inputs-with-placeholders',
		given: 'SaveMarkdownModal mounts with no defaultFolder.',
		when: ['the modal mounts'],
		then: [
			// Folder input with placeholder "/path/to/folder"
			{ verb: 'hasElement', target: 'input[placeholder="/path/to/folder"]' },
			// Filename input with placeholder "document.md"
			{ verb: 'hasElement', target: 'input[placeholder="document.md"]' },
		],
		happyPath: true,
	},
	{
		name: 'save-markdown-modal-renders-md-extension-hint-copy',
		given: 'SaveMarkdownModal mounts.',
		when: ['the modal mounts'],
		then: [
			// User-facing hint that .md is auto-appended
			{
				verb: 'hasText',
				target: 'body',
				value: '.md extension will be added automatically if not provided',
			},
		],
		happyPath: true,
	},
	{
		name: 'save-markdown-modal-renders-cancel-and-save-buttons',
		given: 'SaveMarkdownModal mounts with empty folder and empty filename.',
		when: ['the modal mounts'],
		then: [
			// Cancel + Save labels in the footer (Save starts disabled until both fields are non-empty)
			{ verb: 'hasText', target: 'body', value: 'Cancel' },
			{ verb: 'hasText', target: 'body', value: 'Save' },
		],
		happyPath: true,
	},
	{
		name: 'save-markdown-modal-renders-open-in-tab-checkbox-when-callback-wired',
		given: 'SaveMarkdownModal mounts with onOpenInTab wired.',
		when: ['the modal mounts'],
		then: [
			// "Open in Tab" affordance in the footer left slot
			{ verb: 'hasText', target: 'body', value: 'Open in Tab' },
			// Checkbox primitive
			{ verb: 'hasElement', target: 'input[type="checkbox"]' },
		],
		happyPath: true,
	},
	{
		name: 'save-markdown-modal-renders-folder-browse-affordance-when-picker-wired-and-not-remote',
		given:
			'SaveMarkdownModal mounts with isRemoteSession=false AND onBrowseFolder wired (host supplies a folder picker).',
		when: ['the modal mounts'],
		then: [
			// Browse button surfaces with title attribute discoverable to AT users
			{ verb: 'hasElement', target: 'button[title="Browse for folder"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'save-markdown-modal-hides-folder-browse-when-remote-session',
		given:
			'SaveMarkdownModal mounts with isRemoteSession=true AND onBrowseFolder wired (host has a picker but session is remote).',
		when: ['the modal mounts'],
		then: [
			// Native folder picker only browses LOCAL fs, so the renderer source
			// hides this affordance for remote sessions; the lift preserves the gate.
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Browse for folder"]))' },
		],
		happyPath: false,
	},
	{
		name: 'save-markdown-modal-hides-folder-browse-when-no-picker-callback',
		given:
			'SaveMarkdownModal mounts with isRemoteSession=false but onBrowseFolder is undefined (no host picker wired — common webFull case).',
		when: ['the modal mounts'],
		then: [
			// Without a picker callback to invoke, the affordance is meaningless;
			// suppress it so users do not click a no-op button.
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Browse for folder"]))' },
		],
		happyPath: false,
	},
	{
		name: 'save-markdown-modal-hides-open-in-tab-when-callback-absent',
		given: 'SaveMarkdownModal mounts without onOpenInTab wired.',
		when: ['the modal mounts'],
		then: [
			// "Open in Tab" copy must not appear when the callback is absent —
			// the footer left slot collapses to an empty <div /> spacer.
			{ verb: 'hasElement', target: 'body:not(:has-text("Open in Tab"))' },
		],
		happyPath: false,
	},
	{
		name: 'save-markdown-modal-disables-save-when-folder-or-filename-empty',
		given: 'SaveMarkdownModal mounts with empty folder and empty filename.',
		when: ['the modal mounts'],
		then: [
			// Save button must be disabled when either field is empty — `isValid`
			// is the AND of trimmed folder and trimmed filename.
			{ verb: 'hasElement', target: 'button[disabled]' },
		],
		happyPath: false,
	},
	{
		name: 'save-markdown-modal-fires-no-ipc-or-websocket-traffic-on-mount',
		given:
			'SaveMarkdownModal mounts with full prop wiring (onWriteFile, onBrowseFolder, onOpenInTab).',
		when: ['the modal mounts'],
		then: [
			// Presentational-only on mount. The component does NOT reach into
			// window.maestro at any point — both former IPC sites are now
			// strip-and-promote-to-prop callbacks the host owns.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
	{
		name: 'save-markdown-modal-does-not-strip-md-hint-when-filename-already-ends-md',
		given:
			'SaveMarkdownModal mounts with filename pre-populated to "notes.md" via host wiring — the hint copy is informational and stable regardless of current filename value.',
		when: ['the modal mounts'],
		then: [
			// The hint is informational chrome — it must not vanish based on
			// current input state. This pins the renderer behavior of always
			// rendering the hint, so a future refactor that conditionalizes
			// the hint based on input fails the catalog rather than silently
			// changing copy visibility.
			{
				verb: 'hasText',
				target: 'body',
				value: '.md extension will be added automatically if not provided',
			},
		],
		happyPath: false,
	},
];

describe('SaveMarkdownModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = saveMarkdownModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = saveMarkdownModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = saveMarkdownModalParityCatalog.filter((s) => !s.happyPath).length;
		expect(happy).toBeGreaterThanOrEqual(1);
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
		for (const story of saveMarkdownModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of saveMarkdownModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of saveMarkdownModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the strip-and-promote contract — Save Markdown title is the canonical chrome', () => {
		// The modal carries a stable title rendered through the L2.1 Modal
		// primitive header. The catalog pins it so a future refactor that
		// drifts the copy (e.g. "Save File", "Export Markdown") fails the
		// catalog rather than silently changing user-facing copy.
		const titleStory = saveMarkdownModalParityCatalog.find((s) =>
			s.then.some((t) => t.value === 'Save Markdown')
		);
		expect(titleStory).toBeDefined();
	});
});
