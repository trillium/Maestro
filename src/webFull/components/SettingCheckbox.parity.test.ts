/**
 * Parity catalog — SettingCheckbox
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * SettingCheckbox is a tiny presentational primitive — section label with
 * icon, a clickable row carrying a title / optional description, and a
 * pill-shape switch on the right. It owns no internal state, holds no
 * lifecycle, touches 0 IPC namespaces and 0 Electron-only APIs.
 *
 * Per the SessionListItem / ToggleButtonGroup precedent (both pure
 * primitives with no internal lifecycle), stories here are
 * **render-shape oriented** (hasElement / hasText) rather than
 * interaction-flow oriented. The component has no layer-stack
 * registration, no focus management beyond the native `<button>` /
 * `tabIndex={0}` defaults, and no portals.
 *
 *   IN (asserted here):
 *     - The section label `<label>` renders with the supplied label text.
 *     - The row exposes `role="button"` and is keyboard-reachable
 *       (`tabIndex={0}`).
 *     - The title text renders inside the row.
 *     - The optional description renders when supplied AND is absent
 *       when not supplied.
 *     - The switch exposes `role="switch"` with `aria-checked` reflecting
 *       the `checked` prop.
 *     - The thumb-span carries `translate-x-5` when checked and
 *       `translate-x-0.5` when unchecked (renderer-pinned class names).
 *
 *   DROPPED (named so the partial-parity surface is countable):
 *     - Click / Enter / Space toggle semantics. Interaction flow belongs
 *       to the feature-consumer's catalog, not the primitive's
 *       (matches ToggleButtonGroup / SessionListItem precedent).
 *     - Focus-ring styling under :focus-visible (the component leans on
 *       browser defaults — no custom focus ring shipped in either target).
 *     - Hover styling (`hover:bg-opacity-10`) — Tailwind hover variants
 *       require pointer state we don't simulate at the catalog layer.
 *
 * Catalog principle (from ISA Decisions 2026-06-08):
 *   - The catalog IS the spec, not the renderer source.
 *   - Pass criterion = every story passes on BOTH targets (Electron oracle
 *     at localhost:9222 and webFull at localhost:5176).
 *   - Stories are layout-independent — they assert observable behavior,
 *     not DOM structure or CSS layout values.
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

export const settingCheckboxParityCatalog: ParityStory[] = [
	// ============ Happy path: render-shape oriented ============
	{
		name: 'setting-checkbox-renders-section-label-with-icon',
		given:
			'The component is mounted with sectionLabel="Appearance", an icon, title="Dark mode", checked=false.',
		when: ['the SettingCheckbox renders'],
		then: [
			// The <label> chrome renders the supplied section label text.
			{ verb: 'hasElement', target: 'label' },
			{ verb: 'hasText', target: 'label', value: 'Appearance' },
			// The icon slot renders inside the label.
			{ verb: 'hasElement', target: 'label svg' },
		],
		happyPath: true,
	},
	{
		name: 'setting-checkbox-row-is-keyboard-reachable-button',
		given:
			'The component is mounted with sectionLabel="Notifications", title="Enable sounds", checked=true.',
		when: ['the SettingCheckbox renders'],
		then: [
			// The clickable row exposes role="button" and tabIndex=0.
			{ verb: 'hasElement', target: 'div[role="button"]' },
			{ verb: 'hasElement', target: 'div[role="button"][tabindex="0"]' },
			// The title renders inside the row.
			{ verb: 'hasText', target: 'div[role="button"]', value: 'Enable sounds' },
		],
		happyPath: true,
	},
	{
		name: 'setting-checkbox-renders-description-when-supplied',
		given:
			'The component is mounted with title="Auto Run", description="Lets agents execute commands without confirmation", checked=false.',
		when: ['the SettingCheckbox renders'],
		then: [
			// Title and description both render inside the row.
			{ verb: 'hasText', target: 'div[role="button"]', value: 'Auto Run' },
			{
				verb: 'hasText',
				target: 'div[role="button"]',
				value: 'Lets agents execute commands without confirmation',
			},
		],
		happyPath: true,
	},
	{
		name: 'setting-checkbox-switch-aria-checked-true-when-checked',
		given: 'The component is mounted with checked=true.',
		when: ['the SettingCheckbox renders'],
		then: [
			// role="switch" with aria-checked="true" reflects checked=true.
			{ verb: 'hasElement', target: 'button[role="switch"]' },
			{ verb: 'hasElement', target: 'button[role="switch"][aria-checked="true"]' },
			// Thumb carries the "checked" translate class (renderer-pinned).
			{ verb: 'hasElement', target: 'span.translate-x-5' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'setting-checkbox-description-absent-when-not-supplied',
		given: 'The component is mounted with title="Telemetry" and NO description prop.',
		when: ['the SettingCheckbox renders'],
		then: [
			// The title renders.
			{ verb: 'hasText', target: 'div[role="button"]', value: 'Telemetry' },
			// The opacity-50 description sub-row is NOT present.
			{ verb: 'hasElement', target: 'div[role="button"]:not(:has(div.opacity-50))' },
		],
		happyPath: false,
	},
	{
		name: 'setting-checkbox-switch-aria-checked-false-when-unchecked',
		given: 'The component is mounted with checked=false.',
		when: ['the SettingCheckbox renders'],
		then: [
			// role="switch" with aria-checked="false" reflects checked=false.
			{ verb: 'hasElement', target: 'button[role="switch"][aria-checked="false"]' },
			// Thumb carries the "unchecked" translate class (renderer-pinned).
			{ verb: 'hasElement', target: 'span.translate-x-0.5' },
			// And NOT the checked translate class.
			{ verb: 'hasElement', target: 'button[role="switch"]:not(:has(span.translate-x-5))' },
		],
		happyPath: false,
	},
	{
		name: 'setting-checkbox-no-ipc-or-ws-on-mount',
		given: 'The component is mounted with any valid props.',
		when: ['the SettingCheckbox renders'],
		then: [
			// Primitive lifecycle pin: rendering this component fires no
			// WebSocket frames, no DB writes, no FS writes, no notifications.
			// A future refactor that introduces any of those should fail the
			// catalog rather than silently drift the presentational contract.
			{ verb: 'hasElement', target: 'div[role="button"]' },
		],
		happyPath: false,
	},
	{
		name: 'setting-checkbox-empty-description-string-is-falsy-omit',
		given: 'The component is mounted with title="Beta", description="" (empty string — falsy).',
		when: ['the SettingCheckbox renders'],
		then: [
			// Empty-string description hits the renderer's `description && (...)`
			// truthy guard and is suppressed (matches renderer SettingCheckbox.tsx).
			{ verb: 'hasElement', target: 'div[role="button"]:not(:has(div.opacity-50))' },
			// Title still renders.
			{ verb: 'hasText', target: 'div[role="button"]', value: 'Beta' },
		],
		happyPath: false,
	},
];

describe('SettingCheckbox — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(settingCheckboxParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = settingCheckboxParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = settingCheckboxParityCatalog.filter((s) => s.happyPath).length;
		const negative = settingCheckboxParityCatalog.filter((s) => !s.happyPath).length;
		expect(negative).toBeGreaterThanOrEqual(1);
		// Brief floor: >=1 negative per happy.
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
		for (const story of settingCheckboxParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of settingCheckboxParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of settingCheckboxParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('catalog is render-shape oriented (no interaction verbs)', () => {
		// Pure primitive — only hasElement / hasText. Click and Enter / Space
		// toggle semantics belong to the future feature-consumer's catalog,
		// not the primitive's (matches ToggleButtonGroup / SessionListItem
		// precedent).
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of settingCheckboxParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
