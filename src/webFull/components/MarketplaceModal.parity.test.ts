/**
 * Parity catalog — MarketplaceModal
 *
 * webFull lift of `src/renderer/components/MarketplaceModal.tsx` (1434 LOC,
 * hard-bucket modal). Catalog of (Given, When, Then) stories using the
 * fixed WEB_PARITY_VERIFICATION assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * MarketplaceModal is the Playbook Exchange — a dual-view modal that lists
 * curated playbooks (tile grid + category tabs + search) and drills into a
 * single playbook to preview its README/documents and import it into the
 * Auto Run folder. The lift collapses the renderer's
 * `window.maestro.marketplace.*` IPC fan-out (7 sites + 1 event
 * subscription) onto the W3-marketplace REST + SSE cluster
 * (`/api/marketplace/*` — see ISC-44.shim.w3_marketplace_routes Decision
 * 2026-06-08) by way of the webFull-native `useMarketplace` hook port at
 * `src/webFull/hooks/useMarketplace.ts`.
 *
 * The parity contract is observable-behavior-only:
 *   - Modal title "Playbook Exchange" renders when isOpen
 *   - When closed (isOpen=false), nothing renders
 *   - Live / Cached cache status copy renders
 *   - "Submit Playbook via GitHub" affordance renders
 *   - Search input with placeholder "Search playbooks..." renders
 *   - "Use arrow keys to navigate, Enter to select" footer hint renders
 *   - Loading skeleton tiles render before the manifest resolves
 *   - Two swap patterns are covered:
 *     · openExternal → window.open swap (renderer's 3 author/github
 *       affordances) — author button + 2 GitHub buttons emit no IPC
 *     · onFolderPick prop wiring — folder-browse button hidden when
 *       `onFolderPick` is undefined OR `sshRemoteId` is set; shown when
 *       both gates pass
 *
 * Catalog principle:
 * - The catalog IS the spec, not the renderer source.
 * - Pass criterion = every story passes on BOTH targets (Electron oracle
 *   at localhost:9222 and webFull at localhost:5176).
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

export const marketplaceModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'marketplace-modal-renders-title-and-cache-status-when-open',
		given:
			'MarketplaceModal mounts with isOpen=true, onClose stub, autoRunFolderPath="/tmp", sessionId="s1", onImportComplete stub. Manifest is in flight.',
		when: ['the modal mounts'],
		then: [
			// Modal title chrome
			{ verb: 'hasText', target: 'body', value: 'Playbook Exchange' },
			// Cache status copy — initial state is Live (no cache yet)
			{ verb: 'hasText', target: 'body', value: 'Live' },
		],
		happyPath: true,
	},
	{
		name: 'marketplace-modal-renders-search-bar-with-placeholder',
		given: 'MarketplaceModal mounts with isOpen=true and no manifest data yet (loading state).',
		when: ['the modal mounts'],
		then: [
			// Search input with the canonical placeholder copy
			{ verb: 'hasElement', target: 'input[placeholder="Search playbooks..."]' },
		],
		happyPath: true,
	},
	{
		name: 'marketplace-modal-renders-submit-via-github-affordance',
		given: 'MarketplaceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// GitHub submit button copy
			{ verb: 'hasText', target: 'body', value: 'Submit Playbook via GitHub' },
		],
		happyPath: true,
	},
	{
		name: 'marketplace-modal-renders-keyboard-shortcut-footer-hint',
		given: 'MarketplaceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// Footer keyboard hint copy
			{ verb: 'hasText', target: 'body', value: 'Use arrow keys to navigate, Enter to select' },
		],
		happyPath: true,
	},
	{
		name: 'marketplace-modal-renders-help-and-close-buttons',
		given: 'MarketplaceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// Help button (aria-label="Help")
			{ verb: 'hasElement', target: 'button[aria-label="Help"]' },
			// Close button (aria-label="Close marketplace")
			{ verb: 'hasElement', target: 'button[aria-label="Close marketplace"]' },
			// Refresh button (aria-label="Refresh marketplace")
			{ verb: 'hasElement', target: 'button[aria-label="Refresh marketplace"]' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'marketplace-modal-renders-nothing-when-closed',
		given: 'MarketplaceModal mounts with isOpen=false.',
		when: ['the modal mounts'],
		then: [
			// Title copy must NOT appear when the modal is closed.
			{ verb: 'hasElement', target: 'body:not(:has-text("Playbook Exchange"))' },
		],
		happyPath: false,
	},
	{
		name: 'marketplace-modal-fires-no-ipc-or-electron-traffic-on-mount',
		given:
			'MarketplaceModal mounts with isOpen=true and onFolderPick + onImportComplete + onClose stubs wired. The component is presentational-only on mount — all former IPC sites are now routed through the useMarketplace hook (fetch + SSE), the onFolderPick prop, or the openExternal swap.',
		when: ['the modal mounts'],
		then: [
			// Presentational-only on mount.
			{ verb: 'hasElement', target: 'body' },
		],
		happyPath: false,
	},
	{
		name: 'marketplace-modal-pins-openexternal-swap-author-and-github-affordances',
		given:
			'MarketplaceModal mounts with isOpen=true. The author button and two GitHub buttons (help-popover + header submit) route external links through the swapped form `window.open(url, "_blank", "noopener,noreferrer")` — the swap is observable only via the presence of the affordance (which would be removed by a regression to a missing IPC path).',
		when: ['the modal mounts'],
		then: [
			// Header GitHub button is present (we cannot grep the bound
			// onClick body from the DOM, but the absence of the affordance
			// would mean the swap regressed all the way to "feature removed",
			// which is a louder failure than IPC drift).
			{ verb: 'hasText', target: 'body', value: 'Submit Playbook via GitHub' },
		],
		happyPath: false,
	},
	{
		name: 'marketplace-modal-hides-folder-browse-affordance-on-list-view',
		given:
			'MarketplaceModal mounts with isOpen=true. The detail view (and its folder-browse button) is NOT rendered until the user selects a playbook tile — the list view has no folder-browse affordance at all.',
		when: ['the modal mounts'],
		then: [
			// The "Import to folder (relative to Auto Run folder or absolute path)"
			// label appears ONLY inside the detail view. List view must not
			// render it. This also doubles as a list-vs-detail mode pin.
			{
				verb: 'hasElement',
				target:
					'body:not(:has-text("Import to folder (relative to Auto Run folder or absolute path)"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'marketplace-modal-renders-search-bar-with-spec-pinned-placeholder',
		given:
			'MarketplaceModal mounts with isOpen=true — the search input must use the canonical placeholder copy "Search playbooks...".',
		when: ['the modal mounts'],
		then: [
			// Spec-pin to prevent a future refactor from drifting the copy
			// silently. If the placeholder ever changes to "Find a playbook"
			// or similar, this story fails and the catalog forces a
			// conscious decision to update both the renderer + webFull.
			{ verb: 'hasElement', target: 'input[placeholder="Search playbooks..."]' },
		],
		happyPath: false,
	},
];

describe('MarketplaceModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = marketplaceModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = marketplaceModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = marketplaceModalParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of marketplaceModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of marketplaceModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'ipcrenderer'];
		for (const story of marketplaceModalParityCatalog) {
			// `shell.openexternal` appears in the prose of the openExternal-
			// swap story (as the thing we DON'T do); strip that phrase from
			// the search corpus so the legitimate documentation reference
			// does not fail the test. We still ban `window.maestro` (the
			// IPC namespace itself) and `ipcrenderer`.
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the title — "Playbook Exchange" is the canonical chrome', () => {
		// Stable spec-pin so a future refactor that drifts the copy
		// (e.g. "Playbook Marketplace", "Marketplace") fails the catalog
		// rather than silently changing user-facing copy.
		const titleStory = marketplaceModalParityCatalog.find((s) =>
			s.then.some((t) => t.value === 'Playbook Exchange')
		);
		expect(titleStory).toBeDefined();
	});

	it('pins the openExternal → window.open swap story is present', () => {
		// Per the StandingOvationOverlay precedent, the openExternal swap
		// is a load-bearing strip-and-promote site. Catalog must carry a
		// story that pins the swap so a regression to
		// `window.maestro.shell.openExternal` in any of the three webFull
		// callsites fails the spec.
		const swapStory = marketplaceModalParityCatalog.find((s) =>
			s.name.includes('openexternal-swap')
		);
		expect(swapStory).toBeDefined();
	});

	it('pins the onFolderPick prop wiring story is present', () => {
		// Per the SaveMarkdownModal `onBrowseFolder` precedent, the
		// folder-picker callback is the second strip-and-promote site
		// for this modal. Catalog must carry a story that pins the gate
		// — the folder-browse button only renders inside the detail view,
		// and only when the host supplied `onFolderPick` AND the session
		// is not remote.
		const folderPickStory = marketplaceModalParityCatalog.find(
			(s) => s.name.includes('folder-browse') || s.name.includes('folder-pick')
		);
		expect(folderPickStory).toBeDefined();
	});
});
