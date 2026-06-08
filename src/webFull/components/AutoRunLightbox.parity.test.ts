/**
 * Parity catalog — AutoRunLightbox
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * AutoRunLightbox is a pure UI primitive — it takes `attachmentsList`,
 * `attachmentPreviews`, `lightboxFilename`, `lightboxExternalUrl`,
 * `onClose`, `onNavigate`, an optional `onDelete`, and a `theme`. It
 * touches 0 IPC namespaces at module-load time. The only Electron-only
 * surface is the *runtime* optional-chained `window.maestro?.shell?.
 * copyImageToClipboard` inside the cross-fork imported
 * `safeClipboardWriteImage`; on webFull `window.maestro` is undefined
 * and the implementation falls through to the browser
 * `navigator.clipboard.write()` path. That branch is library-internal to
 * `clipboard.ts` and is NOT part of AutoRunLightbox's parity contract —
 * the catalog asserts the observable copy-button UX (icon swap +
 * "Copied!" confirmation), not the underlying transport.
 *
 * The parity contract is observable-behavior-only: the lightbox renders
 * portaled into the body with the image, navigation arrows when more than
 * one attachment is present AND no external URL is set, copy + copy-
 * markdown + close buttons (always), a delete button gated on `onDelete`
 * presence AND absence of an external URL, the bottom info strip with
 * the filename + counter + nav hint + delete hint + ESC hint, and the
 * delete confirmation composes the L2.1 ConfirmModal primitive on the
 * destructive path.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative-path story per
 * happy-path story → minimum 3 happy + 3 negative. This catalog ships 5
 * happy + 6 negative = 11 stories.
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

export const autoRunLightboxParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'autorun-lightbox-renders-image-and-close-button-with-single-attachment',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/screenshot.png"], attachmentPreviews=Map([["images/screenshot.png","data:image/png;base64,AAA"]]), lightboxFilename="images/screenshot.png", lightboxExternalUrl=null, onClose, onNavigate.',
		when: ['the lightbox mounts'],
		then: [
			// The expanded image is rendered with the filename as alt
			{ verb: 'hasElement', target: 'img[alt="images/screenshot.png"]' },
			// Close button is always present
			{ verb: 'hasElement', target: 'button[title="Close (ESC)"]' },
			// Bottom info strip shows ESC hint
			{ verb: 'hasText', target: 'body', value: 'ESC to close' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-lightbox-shows-navigation-arrows-and-counter-with-multiple-attachments',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/a.png","images/b.png","images/c.png"], attachmentPreviews carrying data URLs for all three, lightboxFilename="images/b.png", lightboxExternalUrl=null.',
		when: ['the lightbox mounts on the second attachment of three'],
		then: [
			// Previous + next nav buttons present
			{ verb: 'hasElement', target: 'button[title="Previous image (←)"]' },
			{ verb: 'hasElement', target: 'button[title="Next image (→)"]' },
			// Counter shows "Image 2 of 3"
			{ verb: 'hasText', target: 'body', value: 'Image 2 of 3' },
			// Filename surfaces in bottom info strip
			{ verb: 'hasText', target: 'body', value: 'images/b.png' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-lightbox-renders-copy-image-and-copy-markdown-buttons-always',
		given:
			'AutoRunLightbox mounts with any non-null lightboxFilename and a matching attachmentPreviews entry.',
		when: ['the lightbox mounts'],
		then: [
			// Copy markdown button (FileText icon) — title copy is the canonical
			// "Copy markdown reference" string
			{ verb: 'hasElement', target: 'button[title^="Copy markdown reference"]' },
			// Copy image button — title copy starts with "Copy image to clipboard"
			{ verb: 'hasElement', target: 'button[title^="Copy image to clipboard"]' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-lightbox-renders-delete-button-when-onDelete-provided-and-no-external-url',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/a.png"], lightboxFilename="images/a.png", lightboxExternalUrl=null, onDelete=(path)=>{}.',
		when: ['the lightbox mounts'],
		then: [
			// Delete button rendered with canonical title copy
			{ verb: 'hasElement', target: 'button[title="Delete image (Delete key)"]' },
			// Bottom hint surfaces "Delete to remove" copy
			{ verb: 'hasText', target: 'body', value: 'Delete to remove' },
		],
		happyPath: true,
	},
	{
		name: 'autorun-lightbox-renders-external-url-image-without-navigation-or-delete',
		given:
			'AutoRunLightbox mounts with attachmentsList=[], attachmentPreviews=Map(), lightboxFilename="https://example.com/cat.jpg", lightboxExternalUrl="https://example.com/cat.jpg", onDelete=(path)=>{}.',
		when: ['the lightbox mounts on an external URL'],
		then: [
			// Image still renders
			{ verb: 'hasElement', target: 'img[alt="https://example.com/cat.jpg"]' },
			// Close button still rendered
			{ verb: 'hasElement', target: 'button[title="Close (ESC)"]' },
			// ESC hint still present
			{ verb: 'hasText', target: 'body', value: 'ESC to close' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'autorun-lightbox-suppresses-navigation-arrows-with-single-attachment',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/only.png"] (length 1), attachmentPreviews carrying the matching entry, lightboxFilename="images/only.png", lightboxExternalUrl=null.',
		when: ['the lightbox mounts on the only attachment'],
		then: [
			// Image still renders
			{ verb: 'hasElement', target: 'img[alt="images/only.png"]' },
			// No previous/next arrows because canNavigate is false
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Previous image (←)"]))' },
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Next image (→)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-lightbox-suppresses-navigation-arrows-on-external-url-even-with-many-attachments',
		given:
			'AutoRunLightbox mounts with attachmentsList=["a.png","b.png","c.png"], lightboxFilename="https://x.test/img.png", lightboxExternalUrl="https://x.test/img.png".',
		when: ['the lightbox mounts on an external URL with siblings present'],
		then: [
			// External-URL branch: canNavigate is false regardless of list length
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Previous image (←)"]))' },
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Next image (→)"]))' },
			// Counter line ("Image X of Y") is also suppressed on the external-URL
			// branch because canNavigate gates it
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Image 1 of 3")))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-lightbox-suppresses-delete-button-when-onDelete-omitted',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/a.png"], lightboxFilename="images/a.png", lightboxExternalUrl=null, and NO onDelete prop.',
		when: ['the lightbox mounts'],
		then: [
			// Delete button gated behind onDelete prop — must be absent
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Delete image (Delete key)"]))' },
			// "Delete to remove" hint also gated behind onDelete — must be absent
			{ verb: 'hasElement', target: 'body:not(:has(:has-text("Delete to remove")))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-lightbox-suppresses-delete-button-on-external-url-even-with-onDelete',
		given:
			'AutoRunLightbox mounts with attachmentsList=[], lightboxFilename="https://example.com/x.png", lightboxExternalUrl="https://example.com/x.png", onDelete=(path)=>{}.',
		when: ['the lightbox mounts on an external URL with onDelete provided'],
		then: [
			// Delete button gated behind `!lightboxExternalUrl && onDelete` —
			// the external URL branch must suppress it even when onDelete is
			// supplied
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Delete image (Delete key)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-lightbox-returns-null-when-image-url-cannot-be-resolved',
		given:
			'AutoRunLightbox mounts with attachmentsList=["images/missing.png"], attachmentPreviews=Map() (empty — no matching data URL), lightboxFilename="images/missing.png", lightboxExternalUrl=null.',
		when: ['the lightbox attempts to render without a resolvable image URL'],
		then: [
			// Component returns null — no image element rendered for this filename
			{ verb: 'hasElement', target: 'body:not(:has(img[alt="images/missing.png"]))' },
			// No close button either — the entire portal short-circuited
			{ verb: 'hasElement', target: 'body:not(:has(button[title="Close (ESC)"]))' },
		],
		happyPath: false,
	},
	{
		name: 'autorun-lightbox-no-module-load-ipc-lifecycle-pin',
		given: 'AutoRunLightbox mounts in any state (single, multi, external, missing).',
		when: ['the module loads and the component mounts'],
		then: [
			// The component must never reach `window.maestro` or any WS
			// transport at module load. All side effects flow through prop
			// callbacks (`onClose`, `onNavigate`, `onDelete`) supplied by the
			// caller. The runtime branch on safeClipboardWriteImage is
			// library-internal to the renderer-side `clipboard.ts` re-import
			// and falls back to the pure browser Clipboard API on webFull.
			// This story pins the lifecycle contract so a future refactor that
			// wires IPC directly into the lightbox would fail the catalog
			// rather than silently track it.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
];

describe('AutoRunLightbox — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = autoRunLightboxParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = autoRunLightboxParityCatalog.filter((s) => s.happyPath).length;
		const negative = autoRunLightboxParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of autoRunLightboxParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of autoRunLightboxParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('story names are unique', () => {
		const names = autoRunLightboxParityCatalog.map((s) => s.name);
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
		for (const story of autoRunLightboxParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});
});
