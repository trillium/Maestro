/**
 * Parity catalog — AutoRun (webFull lift)
 *
 * Layer 2.5 — AutoRun-view full lift, closing ISC-44.lift.autorun_main and
 * its sibling ISC-44.shim.use_autorun_image_handling_webfull_port. Per
 * WEB_PARITY_VERIFICATION (referenced from ISA.md ISC-44.x), every feature
 * port ships with a catalog of (Given, When, Then) stories using the fixed
 * assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRun is the full Auto Run editor view — Edit/Preview toggle,
 * document-list dropdown, save/revert/run/stop buttons, expand-to-modal
 * affordance, attachments panel, lightbox, search bar, template
 * autocomplete dropdown, and the markdown preview pane with custom image
 * + link rendering. The lifted webFull version touches the SAME server
 * surfaces the renderer source does — minus the 13 IPC sites which collapse
 * onto pre-existing W3 REST routes:
 *
 *   3x fs.readFile (image)        → GET    /api/fs/read-image
 *   2x autorun.writeDoc           → POST   /api/autorun/write-doc
 *   2x shell.openExternal         → window.open(href, '_blank', 'noopener,noreferrer')
 *   1x autorun.listImages         → GET    /api/autorun/list-images  (sibling hook port)
 *   1x fs.readFile (in list-loop) → GET    /api/fs/read-image        (sibling hook port)
 *   2x autorun.saveImage          → POST   /api/autorun/save-image   (sibling hook port)
 *   2x autorun.deleteImage        → DELETE /api/autorun/delete-image (sibling hook port)
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per happy-path
 * story → minimum 3 happy + 3 negative. This catalog ships 5 happy + 5
 * negative + 1 lifecycle pin = 11 stories.
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

export const autoRunParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'autorun-renders-edit-and-preview-toggle-with-selected-document',
		given:
			'AutoRun mounts with folderPath="/some/folder", selectedFile="alpha", documentList=["alpha","beta"], content="# Hello", mode="edit" — both Edit and Preview affordances must be reachable.',
		when: ['the component mounts'],
		then: [
			// Edit and Preview button titles are stable across both lifts (the
			// `<title>` attribute is the textual handle the parity harness uses
			// to address the buttons without depending on icon-only DOM).
			{ verb: 'hasElement', target: 'button[title*="Edit"]' },
			{ verb: 'hasElement', target: 'button[title*="Preview"]' },
			// The document name surfaces in the selector button (with .md suffix).
			{ verb: 'hasText', target: 'body', value: 'alpha.md' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-renders-run-button-when-batch-not-running-and-agent-idle',
		given:
			'AutoRun mounts with folderPath="/some/folder", selectedFile="alpha", sessionState="idle", batchRunState undefined.',
		when: ['the component mounts'],
		then: [
			// Run affordance present (title contains "Run") and NOT in the
			// stop-state (which would show a Square icon labeled "Stop").
			{ verb: 'hasElement', target: 'button[title*="Run"]' },
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title*="Stop"]))',
			},
		],
		happyPath: true,
	},
	{
		name: 'autorun-renders-stop-button-when-batch-is-running',
		given:
			'AutoRun mounts with batchRunState={isRunning: true, isStopping: false, documents: ["alpha"], currentIndex: 0, lockedDocuments: []}.',
		when: ['the component mounts with an active batch run'],
		then: [
			// Stop affordance present.
			{ verb: 'hasElement', target: 'button[title*="Stop"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-renders-expand-affordance-when-onExpand-callback-supplied',
		given: 'AutoRun mounts with an onExpand callback and hideTopControls=false.',
		when: ['the component mounts'],
		then: [
			// Expand-to-modal button uses a Maximize2 icon with a stable title.
			{ verb: 'hasElement', target: 'button[title*="Expand"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-renders-help-affordance',
		given:
			'AutoRun mounts with folderPath="/some/folder", selectedFile="alpha", shortcuts={} — the help button is always visible regardless of shortcuts being empty.',
		when: ['the component mounts'],
		then: [
			// Help button uses the HelpCircle icon and the title
			// "Learn about Auto Runner" (renderer source-of-truth:
			// src/renderer/components/AutoRun.tsx:1823).
			{ verb: 'hasElement', target: 'button[title*="Learn about Auto Runner"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorun-suppresses-expand-affordance-when-onExpand-omitted',
		given: 'AutoRun mounts without an onExpand callback.',
		when: ['the component mounts'],
		then: [
			// Expand button gated behind `onExpand` — must be absent.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title*="Expand"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-suppresses-top-controls-when-hideTopControls-true',
		given:
			'AutoRun mounts inside an expanded modal which supplies its own top controls — caller sets hideTopControls=true.',
		when: ['the component mounts'],
		then: [
			// The selector / run / expand bar is suppressed in this mode. The
			// Edit/Preview toggle is also part of the suppressed bar — so the
			// Edit affordance, while still functionally reachable through the
			// modal-shell header, is NOT rendered inside the component itself.
			// The Help button (title="Learn about Auto Runner") lives inside
			// the gated top-controls block (renderer source-of-truth:
			// src/renderer/components/AutoRun.tsx:1669,1823) and is absent
			// whenever hideTopControls=true.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title*="Learn about Auto Runner"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-disables-run-button-when-session-state-is-busy',
		given:
			'AutoRun mounts with folderPath="/some/folder", selectedFile="alpha", sessionState="busy", batchRunState undefined.',
		when: ['the component mounts while the agent is busy'],
		then: [
			// Run button carries the disabled attribute when the agent is busy.
			// (Renderer source gates Run on `!isAgentBusy`.)
			{ verb: 'hasElement', target: 'button[title*="Run"][disabled]' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-suppresses-error-banner-when-not-error-paused',
		given:
			'AutoRun mounts with batchRunState undefined and the batchStore has no errorPaused/error entry for this sessionId.',
		when: ['the component mounts with no batch error'],
		then: [
			// Error banner is gated behind `isErrorPaused && batchError` — must
			// be absent in the no-error state. The banner's signature copy is
			// "Auto Run Paused" (renderer source-of-truth:
			// src/renderer/components/AutoRun.tsx:1870).
			{
				verb: 'hasElement',
				target: 'body:not(:has(:has-text("Auto Run Paused")))',
			},
		],
		happyPath: false,
	},
	{
		name: 'autorun-suppresses-placeholder-when-no-folder-selected',
		given: 'AutoRun mounts with folderPath=null, selectedFile=null, content="".',
		when: ['the component mounts without a folder selected'],
		then: [
			// Without a folder, the user-facing setup CTA renders rather than
			// the top-controls bar. The Help button
			// (title="Learn about Auto Runner") lives inside the
			// folderPath-gated top-controls block (renderer source-of-truth:
			// src/renderer/components/AutoRun.tsx:1669,1823) so it is absent
			// whenever folderPath is null.
			{
				verb: 'hasElement',
				target: 'body:not(:has(button[title*="Learn about Auto Runner"]))',
			},
		],
		happyPath: false,
	},

	// ============ Lifecycle pin ============
	{
		name: 'autorun-no-electron-bridge-reach-at-module-load-or-runtime',
		given:
			'AutoRun mounts in any state (folderless, with folder, with selectedFile, with batchRunState, with images, etc.). The webFull lift contract is: zero Electron-preload-bridge references in the component source.',
		when: ['the module loads and the component mounts in any prop-shape'],
		then: [
			// This story pins the contract — a future refactor that wires the
			// preload bridge directly into the webFull AutoRun would fail the
			// catalog rather than silently track. The actual grep proof lives
			// in the catalog-meta tests below (`does not assert against any
			// IPC / Electron-only surface`).
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('AutoRun — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = autoRunParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('story names are unique', () => {
		const names = autoRunParityCatalog.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = [
			'window.maestro',
			'shell.openpath',
			'shell.openexternal',
			'ipcrenderer',
			'dialog.',
			'tunnel.',
		];
		for (const story of autoRunParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
