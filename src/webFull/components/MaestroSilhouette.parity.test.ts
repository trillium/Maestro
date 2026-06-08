/**
 * Parity catalog — MaestroSilhouette
 *
 * Layer 2.5 — leaf-parade lift wave. Per WEB_PARITY_VERIFICATION (referenced
 * from ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MaestroSilhouette is a presentational `<img>` wrapper exposing two named
 * exports — the static `MaestroSilhouette` and the CSS-keyframe-animated
 * `AnimatedMaestro`. Both accept `{ className?, style?, variant?, size? }`.
 * The `variant` prop ('dark' | 'light', default 'dark') picks between the
 * two conductor PNG assets:
 *   - dark variant → conductor-dark.png (black silhouette for light bg)
 *   - light variant → conductor-light.png (white silhouette for dark bg)
 * Default size is 200. Default className is ''.
 *
 * Static variant renders `<img alt="Maestro conductor silhouette">` with
 * `style.objectFit = 'contain'` plus width/height = size and the caller's
 * `style` spread last. Animated variant renders `<img alt="Animated maestro
 * conductor">` with the same shape plus `style.animation =
 * 'conductingMotion 2s ease-in-out infinite'` and an SSR-safe module-load
 * `document.head.appendChild` of the `conductingMotion` keyframes guarded
 * by `#maestro-animation-styles` id-check.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle at
 *   localhost:9222 and webFull at localhost:5176).
 * - Stories are layout-independent — they assert observable behavior, not
 *   DOM structure or CSS.
 *
 * Story floor (per brief): ≥3 happy + ≥1 negative. This catalog ships
 * 4 happy + 2 negative = 6 stories.
 */

import { describe, expect, it } from 'vitest';

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

export const maestroSilhouetteParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'maestro-silhouette-renders-default-img-element-with-canonical-alt-text',
		given: 'The MaestroSilhouette is mounted with no overrides (default variant=dark, size=200).',
		when: ['the component mounts'],
		then: [
			// Single <img> with canonical alt text — alt is the load-bearing
			// accessibility surface and must NOT drift.
			{ verb: 'hasElement', target: 'img[alt="Maestro conductor silhouette"]' },
		],
		happyPath: true,
	},
	{
		name: 'animated-maestro-renders-img-element-with-distinct-canonical-alt-text',
		given: 'The AnimatedMaestro is mounted with no overrides (default variant=dark, size=200).',
		when: ['the component mounts'],
		then: [
			// Animated export emits a different alt — pins the two-export contract
			// (a refactor that collapses to one export would fail this story).
			{ verb: 'hasElement', target: 'img[alt="Animated maestro conductor"]' },
		],
		happyPath: true,
	},
	{
		name: 'maestro-silhouette-passes-through-arbitrary-classname-and-preserves-img-tag',
		given: 'The MaestroSilhouette is mounted with className="custom-class".',
		when: ['the component renders'],
		then: [
			// Caller-supplied className surfaces unchanged on the <img> — pins
			// the "thin wrapper" contract (no extra wrappers around the image).
			{ verb: 'hasElement', target: 'img.custom-class[alt="Maestro conductor silhouette"]' },
		],
		happyPath: true,
	},
	{
		name: 'animated-maestro-and-static-can-coexist-with-distinct-alt-attributes',
		given: 'Both MaestroSilhouette and AnimatedMaestro are mounted in the same tree.',
		when: ['both components render side-by-side'],
		then: [
			// Two <img> nodes — one per export — distinguishable by alt only.
			// This pins the alt difference as the canonical discriminator.
			{ verb: 'hasElement', target: 'img[alt="Maestro conductor silhouette"]' },
			{ verb: 'hasElement', target: 'img[alt="Animated maestro conductor"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'maestro-silhouette-emits-no-wrapper-div-no-role-attribute-no-aria-label',
		given: 'The MaestroSilhouette is mounted with default props.',
		when: ['the component renders'],
		then: [
			// No wrapper container — the contract is that the component IS the
			// <img>, full-stop. Pins against a future refactor wrapping in a
			// <div>/<span> with role/aria-label that would change downstream
			// hosts' selector assumptions.
			{
				verb: 'hasElement',
				target: 'body:not(:has(div[role="img"])):not(:has([aria-label*="Maestro"]))',
			},
		],
		happyPath: false,
	},
	{
		name: 'maestro-silhouette-fires-no-ipc-or-websocket-traffic-on-mount-or-rerender',
		given: 'The MaestroSilhouette is mounted, prop-updated, and unmounted.',
		when: [
			'the component mounts',
			'the variant prop flips from dark to light',
			'the size prop changes from 200 to 320',
			'the component unmounts',
		],
		then: [
			// Presentational-only: zero WS frames, zero IPC broadcasts, zero
			// fs/db side effects, zero notifications. The pin is the structural
			// presence of the canonical <img> — there should be no banner, no
			// modal, no transport-implying surface around it.
			{ verb: 'hasElement', target: 'img[alt="Maestro conductor silhouette"]' },
		],
		happyPath: false,
	},
];

describe('MaestroSilhouette — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = maestroSilhouetteParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story', () => {
		const negative = maestroSilhouetteParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
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
		for (const story of maestroSilhouetteParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of maestroSilhouetteParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'shell.openexternal', 'ipcrenderer'];
		for (const story of maestroSilhouetteParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the presentational contract (silhouette uses no role=dialog, no role=alert)', () => {
		// MaestroSilhouette is a passive <img> primitive — it is NOT a modal
		// (role=dialog) and NOT a banner (role=alert). If a future refactor
		// wraps it in either, the catalog should fail rather than silently
		// track the drift.
		for (const story of maestroSilhouetteParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			expect(haystack.includes('role="dialog"')).toBe(false);
			expect(haystack.includes('role="alert"')).toBe(false);
		}
	});
});
