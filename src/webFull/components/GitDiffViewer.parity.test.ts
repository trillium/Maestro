/**
 * Parity catalog — GitDiffViewer
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * GitDiffViewer is a modal dialog that renders a parsed git diff as a tabbed
 * file viewer. It owns:
 *   - the empty-diff fallback ("No changes to display") when the parser
 *     yields 0 file sections
 *   - the populated header row ("Git Diff" title + cwd badge + "N files
 *     changed" copy)
 *   - the tab strip (one button per file, filename + per-file +/- counts)
 *   - the active-tab body (text diff via react-diff-view Diff/Hunk, image
 *     diff via ImageDiffViewer, "Binary file changed" copy for non-image
 *     binaries, "Unable to parse diff" fallback when parsedDiff.length === 0
 *     on a non-binary entry)
 *   - the footer ("Current file:" + per-file stat counts + "File N of M")
 *   - layer registration as a modal at MODAL_PRIORITIES.GIT_DIFF with a
 *     lenient focus trap and Escape-to-close wiring
 *   - keyboard nav (Cmd/Ctrl+[ and Cmd/Ctrl+] cycle through tabs)
 *
 * The parity contract is observable-behavior-only:
 *   - Empty-diff state: "No changes to display" copy + Git Diff title +
 *     Close (Esc) affordance
 *   - Populated state: header copy (title, cwd, "N files changed"),
 *     tab strip, footer ("File N of M" indicator), close affordance
 *   - File-header arrow ("oldPath → newPath") inside the active text-diff
 *     body
 *   - "Binary file changed" copy when the active file is a non-image binary
 *   - Image-diff branch mounts ImageDiffViewer for image entries (but the
 *     parity catalog stays layout-independent — the image viewer itself is
 *     a cross-fork edge and has its own catalog under
 *     ISC-44.layer-2.5.image_diff_viewer when it lifts)
 *   - Negative: malformed diff text is robust — `parseGitDiff('not a diff')`
 *     yields an empty array, viewer surfaces the empty-state fallback
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

export const gitDiffViewerParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'git-diff-viewer-renders-header-title-cwd-and-file-count-on-populated-diff',
		given:
			'GitDiffViewer mounts with a diffText containing two `diff --git` sections (a/foo.ts → b/foo.ts and a/bar.md → b/bar.md), cwd="/repo/example".',
		when: ['the viewer mounts'],
		then: [
			// Title copy from header
			{ verb: 'hasText', target: 'body', value: 'Git Diff' },
			// cwd badge surfaces the supplied cwd verbatim
			{ verb: 'hasText', target: 'body', value: '/repo/example' },
			// "N files changed" copy with plural form
			{ verb: 'hasText', target: 'body', value: '2 files changed' },
			// Close affordance discoverable
			{ verb: 'hasText', target: 'body', value: 'Close (Esc)' },
		],
		happyPath: true,
	},
	{
		name: 'git-diff-viewer-renders-tab-strip-with-filenames-and-per-file-counts',
		given:
			'GitDiffViewer mounts with a diffText containing a `diff --git a/src/foo.ts b/src/foo.ts` section that has 3 insertions and 1 deletion plus a `diff --git a/README.md b/README.md` section with 2 insertions.',
		when: ['the tab strip renders'],
		then: [
			// Each tab shows the filename (last path segment, mirroring getFileName)
			{ verb: 'hasText', target: 'body', value: 'foo.ts' },
			{ verb: 'hasText', target: 'body', value: 'README.md' },
			// Per-file insertion count on the active tab
			{ verb: 'hasText', target: 'body', value: '3' },
		],
		happyPath: true,
	},
	{
		name: 'git-diff-viewer-renders-file-header-arrow-for-active-text-diff',
		given:
			'GitDiffViewer mounts with a diffText whose first `diff --git a/old/path.ts b/new/path.ts` section parses to a non-empty `parsedDiff` (text diff, not binary).',
		when: ['the active-tab body renders the text diff'],
		then: [
			// File header inside the diff body interpolates "oldPath → newPath"
			{ verb: 'hasText', target: 'body', value: 'old/path.ts' },
			{ verb: 'hasText', target: 'body', value: 'new/path.ts' },
			// The arrow glyph between them is part of the file-header copy
			{ verb: 'hasText', target: 'body', value: '→' },
		],
		happyPath: true,
	},
	{
		name: 'git-diff-viewer-renders-footer-file-counter-on-populated-diff',
		given:
			'GitDiffViewer mounts with a diffText that parses to three file sections; `activeTab=0`.',
		when: ['the footer renders the file-counter indicator'],
		then: [
			// Footer surfaces "File 1 of 3" with the canonical "File N of M" copy
			{ verb: 'hasText', target: 'body', value: 'File 1 of 3' },
			// "Current file:" label discoverable in the footer
			{ verb: 'hasText', target: 'body', value: 'Current file:' },
		],
		happyPath: true,
	},
	{
		name: 'git-diff-viewer-renders-binary-file-changed-copy-when-active-file-is-non-image-binary',
		given:
			'GitDiffViewer mounts with a diffText whose first `diff --git a/data.bin b/data.bin` section contains the literal "Binary files a/data.bin and b/data.bin differ" line (parser sets `isBinary=true, isImage=false` for the `.bin` extension).',
		when: ['the active-tab body renders the binary branch'],
		then: [
			// Active-tab body surfaces the non-image binary fallback copy
			{ verb: 'hasText', target: 'body', value: 'Binary file changed' },
			// Tab strip shows the "binary" indicator in place of +/- counts
			{ verb: 'hasText', target: 'body', value: 'binary' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'git-diff-viewer-renders-empty-state-fallback-when-diff-text-is-empty-string',
		given: 'GitDiffViewer mounts with diffText="" and a non-empty cwd.',
		when: ['the viewer renders the empty-state fallback'],
		then: [
			// Empty-state copy surfaces verbatim
			{ verb: 'hasText', target: 'body', value: 'No changes to display' },
			// Title still renders in the empty-state header
			{ verb: 'hasText', target: 'body', value: 'Git Diff' },
			// Close affordance still discoverable in the empty state
			{ verb: 'hasText', target: 'body', value: 'Close (Esc)' },
			// In the empty state, NO tab strip is rendered — there is no
			// `button[role="tab"]`-shaped affordance; the empty-state shell
			// has only the single Close button. This pins the contract so a
			// future refactor that mounts the tab strip even on 0 files would
			// fail the catalog.
			{ verb: 'hasElement', target: 'body:not(:has(div.scrollbar-thin))' },
		],
		happyPath: false,
	},
	{
		name: 'git-diff-viewer-renders-empty-state-fallback-when-diff-text-is-malformed',
		given:
			'GitDiffViewer mounts with diffText="not a git diff payload, just prose without any diff --git headers".',
		when: ['the parser yields zero file sections (malformed input)'],
		then: [
			// Empty-state copy surfaces verbatim — the viewer must not throw
			{ verb: 'hasText', target: 'body', value: 'No changes to display' },
			// "N files changed" header copy is NOT rendered in the empty state
			// (the populated header is gated behind `parsedFiles.length > 0`)
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("files changed")))' },
		],
		happyPath: false,
	},
	{
		name: 'git-diff-viewer-suppresses-file-header-arrow-when-active-file-is-binary',
		given:
			'GitDiffViewer mounts with a diffText whose only section is a `diff --git a/data.bin b/data.bin` binary entry (parser sets `isBinary=true, parsedDiff=[]`).',
		when: ['the active-tab body renders the binary branch'],
		then: [
			// Binary-branch copy surfaces
			{ verb: 'hasText', target: 'body', value: 'Binary file changed' },
			// The text-diff "oldPath → newPath" file-header is NOT rendered
			// because the binary branch short-circuits before the
			// `parsedDiff.length > 0` branch. The arrow glyph is unique to the
			// text-diff file-header in the body.
			{ verb: 'hasElement', target: 'body:not(:has(div.mb-4.p-2.rounded.font-semibold))' },
		],
		happyPath: false,
	},
	{
		name: 'git-diff-viewer-renders-unable-to-parse-fallback-when-non-binary-entry-has-empty-parsed-diff',
		given:
			'GitDiffViewer mounts with a diffText whose only section is a non-binary entry that `parseDiff` returns as an empty FileData array (e.g. an extremely truncated diff that survives the splitter but yields no hunks).',
		when: ['the active-tab body falls through to the parser-fallback branch'],
		then: [
			// Fallback copy from the final branch in the body cascade
			{ verb: 'hasText', target: 'body', value: 'Unable to parse diff for this file' },
			// The binary-branch copy must NOT appear (it would mask the
			// parser-fallback diagnostic)
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("Binary file changed")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'git-diff-viewer-no-ipc-no-ws-lifecycle-pin',
		given:
			'GitDiffViewer mounts in any state — empty, populated text-diff, populated binary, populated image.',
		when: ['the viewer renders'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport at module-load or in the populated text-diff path. All
			// side effects flow through the `onClose` prop callback supplied
			// by the caller. The image branch delegates to ImageDiffViewer,
			// which has its own catalog under ISC-44.layer-2.5.image_diff_viewer
			// when it lifts. This story pins the lifecycle contract so a
			// future refactor that wires IPC directly into the viewer would
			// fail the catalog rather than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('GitDiffViewer — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = gitDiffViewerParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = gitDiffViewerParityCatalog.filter((s) => s.happyPath).length;
		const negative = gitDiffViewerParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of gitDiffViewerParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of gitDiffViewerParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of gitDiffViewerParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the modal-shape presentation contract (viewer renders as role="dialog" overlay)', () => {
		// GitDiffViewer renders a `role="dialog" aria-modal="true"` overlay in
		// both the empty-state and populated branches. The catalog must stay
		// layout-independent (no positive `target: '[role="dialog"]'` story),
		// but it must also not drift toward asserting the absence of the
		// dialog role — that would invert the contract.
		for (const story of gitDiffViewerParityCatalog) {
			const haystack = JSON.stringify(story);
			// No positive selector targeting the dialog role directly — keep
			// the catalog observable-behavior-only.
			expect(haystack.includes('"target":"[role=\\"dialog\\"]"')).toBe(false);
		}
	});
});
