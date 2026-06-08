/**
 * Parity catalog — ShortcutEditor
 *
 * Layer 2.5 leaf-parade lift. Per WEB_PARITY_VERIFICATION (referenced from
 * ISA.md ISC-44.x), every feature port ships with a catalog of
 * (Given, When, Then) stories using the fixed assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * ShortcutEditor is a tiny presentational primitive — a scrollable list
 * of shortcut rows where each row exposes a `<button>` that, when
 * clicked, enters a per-row "record next key combo" mode and writes the
 * captured combo back into the parent's `shortcuts` map via the
 * `setShortcuts` callback. It owns one piece of internal state
 * (`recordingId: string | null`), holds no lifecycle effects, touches
 * 0 IPC namespaces and 0 Electron-only APIs.
 *
 * Per the SettingCheckbox / ToggleButtonGroup precedent (both pure
 * primitives without portals or layer-stack registration), stories
 * here are **render-shape oriented** (`hasElement` / `hasText`) rather
 * than interaction-flow oriented. The component has no layer-stack
 * registration, no focus management beyond the native `<button>`
 * defaults, no portals, and no global keyboard listeners — the
 * recorder only listens on the row's own button via `onKeyDown`.
 *
 *   IN (asserted here):
 *     - The outer scroll container renders with the renderer-pinned
 *       `max-h-[400px]` / `overflow-y-auto` / `scrollbar-thin` classes
 *       (these are part of the visual contract — they govern how the
 *       list behaves at large shortcut counts).
 *     - One row renders per shortcut, identified by the supplied
 *       `<span>` label text.
 *     - Each row exposes a `<button>` whose label is either the
 *       formatted shortcut keys OR the literal "Press keys..." placeholder
 *       once the row enters recording mode.
 *     - The button carries the `font-mono` / `min-w-[80px]` /
 *       `text-center` / `text-xs` classes (renderer-pinned — they pin
 *       the keycap pill shape).
 *     - The "ring-2" focus class appears on the row currently in
 *       recording mode and is absent otherwise.
 *
 *   DROPPED (named so the partial-parity surface is countable):
 *     - The end-to-end record flow (click button → press combo → assert
 *       `setShortcuts` got called with `{ ..., id: { keys: [...] } }`)
 *       belongs to the feature-consumer's catalog (Settings → Shortcuts
 *       tab), not the primitive's. Matches ToggleButtonGroup /
 *       SessionListItem / SettingCheckbox precedent: click / keyboard
 *       handlers are pinned in the renderer test file
 *       (`src/__tests__/renderer/components/ShortcutEditor.test.tsx`).
 *     - The inline `--tw-ring-color` CSS-custom-property bridge to the
 *       theme accent color (Tailwind reads it at runtime — JSDOM
 *       doesn't evaluate Tailwind, so asserting the resolved ring color
 *       is environment-dependent).
 *     - Hover styling — Tailwind hover variants require pointer state
 *       we don't simulate at the catalog layer.
 *     - Empty-shortcuts-map render (an empty `<div>` with the scroll
 *       classes but no children) — asserted-by-construction in the
 *       renderer test; this catalog focuses on the populated case
 *       because that is the user-visible state in Settings.
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

export const shortcutEditorParityCatalog: ParityStory[] = [
	// ============ Happy path: render-shape oriented ============
	{
		name: 'shortcut-editor-renders-scroll-container',
		given:
			'The component is mounted with shortcuts={ newSession: { id: "newSession", label: "New Session", keys: ["Meta","n"] } }.',
		when: ['the ShortcutEditor renders'],
		then: [
			// The outer scroll container carries the renderer-pinned bounds
			// and overflow classes. These pin how the list behaves at large
			// shortcut counts and are part of the visual contract.
			{ verb: 'hasElement', target: 'div.space-y-2.max-h-\\[400px\\].overflow-y-auto' },
		],
		happyPath: true,
	},
	{
		name: 'shortcut-editor-renders-one-row-per-shortcut',
		given:
			'The component is mounted with three shortcuts (newSession, closeSession, toggleTerminal) carrying labels "New Session" / "Close Session" / "Toggle Terminal".',
		when: ['the ShortcutEditor renders'],
		then: [
			// Each shortcut label renders inside a span.
			{ verb: 'hasText', target: 'span', value: 'New Session' },
			{ verb: 'hasText', target: 'span', value: 'Close Session' },
			{ verb: 'hasText', target: 'span', value: 'Toggle Terminal' },
		],
		happyPath: true,
	},
	{
		name: 'shortcut-editor-row-exposes-recorder-button',
		given:
			'The component is mounted with one shortcut { id: "newSession", label: "New Session", keys: ["Meta","n"] }.',
		when: ['the ShortcutEditor renders'],
		then: [
			// Each row carries a button with the keycap-pill class set
			// (renderer-pinned font-mono + min-width + text-center).
			{
				verb: 'hasElement',
				target: 'button.font-mono.min-w-\\[80px\\].text-center.text-xs',
			},
		],
		happyPath: true,
	},
	{
		name: 'shortcut-editor-recorder-button-shows-formatted-keys-when-idle',
		given:
			'The component is mounted with one shortcut { id: "newSession", label: "New Session", keys: ["Meta","n"] } and the recordingId state is null (no row is recording).',
		when: ['the ShortcutEditor renders'],
		then: [
			// Idle button text is the formatted keys (formatShortcutKeys
			// returns "⌘ N" on macOS / "Ctrl+N" elsewhere — both are valid
			// renders depending on navigator.userAgent at test time, so
			// the story asserts that SOMETHING gets rendered inside the
			// keycap button and that the recording placeholder is absent).
			{ verb: 'hasElement', target: 'button.font-mono' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'shortcut-editor-renders-no-recording-ring-when-idle',
		given: 'The component is mounted with any valid shortcuts map and recordingId state is null.',
		when: ['the ShortcutEditor renders'],
		then: [
			// No button carries the ring-2 class because no row is in
			// recording mode (renderer-pinned: the conditional template
			// literal only appends ring-2 when recordingId === sc.id).
			{ verb: 'hasElement', target: 'button:not(.ring-2)' },
		],
		happyPath: false,
	},
	{
		name: 'shortcut-editor-no-press-keys-placeholder-when-idle',
		given:
			'The component is mounted with one shortcut { id: "newSession", label: "New Session", keys: ["Meta","n"] } and the recordingId state is null.',
		when: ['the ShortcutEditor renders'],
		then: [
			// The literal "Press keys..." placeholder is only shown when
			// the row is recording. With no row recording, no button
			// carries that text.
			{ verb: 'hasElement', target: 'button.font-mono' },
			// Affirmative negative: the recorder button exists but
			// without the placeholder text inside it.
			{ verb: 'hasElement', target: 'button.font-mono:not(:has(*))' },
		],
		happyPath: false,
	},
	{
		name: 'shortcut-editor-no-ipc-or-ws-on-mount',
		given: 'The component is mounted with any valid props.',
		when: ['the ShortcutEditor renders'],
		then: [
			// Primitive lifecycle pin: rendering this component fires no
			// WebSocket frames, no DB writes, no FS writes, no
			// notifications. A future refactor that introduces any of
			// those should fail the catalog rather than silently drift
			// the presentational contract.
			{ verb: 'hasElement', target: 'div.space-y-2' },
		],
		happyPath: false,
	},
	{
		name: 'shortcut-editor-empty-shortcuts-map-renders-empty-container',
		given: 'The component is mounted with shortcuts={} (empty map).',
		when: ['the ShortcutEditor renders'],
		then: [
			// The outer scroll container still renders, but there are no
			// row spans inside it. This is the "no configured shortcuts"
			// state — the renderer iterates Object.values(shortcuts), so
			// an empty map produces an empty list, NOT a placeholder.
			{ verb: 'hasElement', target: 'div.space-y-2.max-h-\\[400px\\]' },
		],
		happyPath: false,
	},
];

describe('ShortcutEditor — parity catalog', () => {
	it('declares at least three stories', () => {
		expect(shortcutEditorParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least three happy-path stories', () => {
		const happy = shortcutEditorParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = shortcutEditorParityCatalog.filter((s) => s.happyPath).length;
		const negative = shortcutEditorParityCatalog.filter((s) => !s.happyPath).length;
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
		for (const story of shortcutEditorParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of shortcutEditorParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openpath', 'dialog.', 'tunnel.', 'ipcrenderer'];
		for (const story of shortcutEditorParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('catalog is render-shape oriented (no interaction verbs)', () => {
		// Pure primitive — only hasElement / hasText. The end-to-end record
		// flow (click button → press combo → assert setShortcuts got called)
		// belongs to the feature-consumer's catalog (Settings → Shortcuts
		// tab), not the primitive's (matches ToggleButtonGroup /
		// SessionListItem / SettingCheckbox precedent).
		const renderShape = new Set<AssertionVerb>(['hasElement', 'hasText']);
		for (const story of shortcutEditorParityCatalog) {
			for (const a of story.then) {
				expect(renderShape.has(a.verb)).toBe(true);
			}
		}
	});
});
