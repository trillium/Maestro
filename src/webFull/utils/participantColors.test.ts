/**
 * Tests for `src/webFull/utils/participantColors.ts` — the L2.5 lift of the
 * renderer-side participant color util.
 *
 * Utility tests (NOT a parity catalog — utilities don't render). Verifies:
 * - `generateParticipantColor` is deterministic for a given (index, theme)
 * - HSL output shape is well-formed
 * - Moderator reserved color (index 0) is stable
 * - `buildParticipantColorMap` shape (key set, color shape, ordering)
 * - Edge cases: empty input, single participant, more participants than palette size
 * - `buildParticipantColorMapWithPreferences` reserves Moderator + honors prefs
 * - `MODERATOR_COLOR_INDEX` / `COLOR_PALETTE_SIZE` palette constants
 * - `normalizeMentionName` / `mentionMatches` re-exports route through shared
 */

import { describe, it, expect } from 'vitest';
import {
	generateParticipantColor,
	buildParticipantColorMap,
	buildParticipantColorMapWithPreferences,
	MODERATOR_COLOR_INDEX,
	COLOR_PALETTE_SIZE,
	normalizeMentionName,
	mentionMatches,
} from './participantColors';
import { THEMES } from '../../shared/themes';

const darkTheme = THEMES['dracula'];
const lightTheme = THEMES['github-light'];

const HSL_RE = /^hsl\((\d+),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)$/;

describe('generateParticipantColor', () => {
	it('is deterministic for the same (index, theme) pair', () => {
		const a = generateParticipantColor(0, darkTheme);
		const b = generateParticipantColor(0, darkTheme);
		const c = generateParticipantColor(0, darkTheme);
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('emits a well-formed HSL string for every palette index', () => {
		for (let i = 0; i < COLOR_PALETTE_SIZE; i++) {
			const color = generateParticipantColor(i, darkTheme);
			expect(color).toMatch(HSL_RE);
		}
	});

	it('produces visually distinct hues across the base palette (dark theme)', () => {
		const hues = new Set<string>();
		for (let i = 0; i < COLOR_PALETTE_SIZE; i++) {
			const match = generateParticipantColor(i, darkTheme).match(HSL_RE);
			expect(match).not.toBeNull();
			hues.add(match![1]);
		}
		// All palette-size hues should be distinct integers
		expect(hues.size).toBe(COLOR_PALETTE_SIZE);
	});

	it('reserves index 0 for the Moderator (hue 210, blue)', () => {
		const moderatorColor = generateParticipantColor(MODERATOR_COLOR_INDEX, darkTheme);
		const match = moderatorColor.match(HSL_RE);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('210');
	});

	it('produces different saturation/lightness for light vs dark themes', () => {
		const darkColor = generateParticipantColor(1, darkTheme);
		const lightColor = generateParticipantColor(1, lightTheme);
		// Same hue (palette is shared), different saturation/lightness profile
		const darkMatch = darkColor.match(HSL_RE)!;
		const lightMatch = lightColor.match(HSL_RE)!;
		expect(darkMatch[1]).toBe(lightMatch[1]); // same hue
		// At least one of saturation or lightness should differ
		expect(`${darkMatch[2]}/${darkMatch[3]}`).not.toBe(`${lightMatch[2]}/${lightMatch[3]}`);
	});

	it('wraps the palette and varies saturation/lightness on subsequent rounds', () => {
		const round0 = generateParticipantColor(0, darkTheme);
		const round1 = generateParticipantColor(COLOR_PALETTE_SIZE, darkTheme); // same hue, round 1
		expect(round0).not.toBe(round1);
		const r0Match = round0.match(HSL_RE)!;
		const r1Match = round1.match(HSL_RE)!;
		expect(r0Match[1]).toBe(r1Match[1]); // same hue (palette wrap)
	});

	it('clamps saturation/lightness at the documented floors/ceilings', () => {
		// Round 10+ should hit the floor saturation (25) and clamps
		const farOut = generateParticipantColor(COLOR_PALETTE_SIZE * 10, darkTheme);
		const match = farOut.match(HSL_RE)!;
		const sat = Number(match[2]);
		const light = Number(match[3]);
		expect(sat).toBeGreaterThanOrEqual(25);
		expect(sat).toBeLessThanOrEqual(65);
		expect(light).toBeGreaterThanOrEqual(40);
		expect(light).toBeLessThanOrEqual(70);
	});
});

describe('buildParticipantColorMap', () => {
	it('returns an empty record for an empty participant list', () => {
		const result = buildParticipantColorMap([], darkTheme);
		expect(result).toEqual({});
	});

	it('produces a single-entry map for one participant', () => {
		const result = buildParticipantColorMap(['Alice'], darkTheme);
		expect(Object.keys(result)).toEqual(['Alice']);
		expect(result['Alice']).toMatch(HSL_RE);
	});

	it('produces one entry per participant name, ordered by input', () => {
		const names = ['Alice', 'Bob', 'Carol', 'Dave'];
		const result = buildParticipantColorMap(names, darkTheme);
		expect(Object.keys(result)).toEqual(names);
		for (const name of names) {
			expect(result[name]).toMatch(HSL_RE);
		}
	});

	it('handles more participants than the base palette size without crashing', () => {
		const names = Array.from({ length: COLOR_PALETTE_SIZE + 5 }, (_, i) => `P${i}`);
		const result = buildParticipantColorMap(names, darkTheme);
		expect(Object.keys(result)).toHaveLength(COLOR_PALETTE_SIZE + 5);
		for (const name of names) {
			expect(result[name]).toMatch(HSL_RE);
		}
	});

	it('assigns colors in order — index N maps to generateParticipantColor(N, theme)', () => {
		const names = ['First', 'Second', 'Third'];
		const result = buildParticipantColorMap(names, darkTheme);
		expect(result['First']).toBe(generateParticipantColor(0, darkTheme));
		expect(result['Second']).toBe(generateParticipantColor(1, darkTheme));
		expect(result['Third']).toBe(generateParticipantColor(2, darkTheme));
	});
});

describe('buildParticipantColorMapWithPreferences', () => {
	it('reserves the Moderator color index 0 when a Moderator participant is present', () => {
		const result = buildParticipantColorMapWithPreferences(
			[{ name: 'Moderator' }, { name: 'Alice', sessionPath: '/p/alice' }],
			darkTheme,
			{}
		);
		expect(result.colors['Moderator']).toBe(
			generateParticipantColor(MODERATOR_COLOR_INDEX, darkTheme)
		);
		// Alice must not have grabbed index 0
		expect(result.newPreferences['/p/alice']).not.toBe(MODERATOR_COLOR_INDEX);
	});

	it('honors existing color preferences for participants with a sessionPath', () => {
		const result = buildParticipantColorMapWithPreferences(
			[{ name: 'Alice', sessionPath: '/p/alice' }],
			darkTheme,
			{ '/p/alice': 3 }
		);
		expect(result.colors['Alice']).toBe(generateParticipantColor(3, darkTheme));
	});

	it('skips the Moderator-reserved index when assigning new participants without prefs', () => {
		const result = buildParticipantColorMapWithPreferences(
			[
				{ name: 'Moderator' },
				{ name: 'Alice', sessionPath: '/p/alice' },
				{ name: 'Bob', sessionPath: '/p/bob' },
			],
			darkTheme,
			{}
		);
		expect(result.newPreferences['/p/alice']).not.toBe(MODERATOR_COLOR_INDEX);
		expect(result.newPreferences['/p/bob']).not.toBe(MODERATOR_COLOR_INDEX);
		expect(result.newPreferences['/p/alice']).not.toBe(result.newPreferences['/p/bob']);
	});

	it('returns empty maps for an empty participant list', () => {
		const result = buildParticipantColorMapWithPreferences([], darkTheme, {});
		expect(result.colors).toEqual({});
		expect(result.newPreferences).toEqual({});
	});

	it('does not let a non-Moderator preference claim the Moderator-reserved index 0', () => {
		const result = buildParticipantColorMapWithPreferences(
			[{ name: 'Alice', sessionPath: '/p/alice' }],
			darkTheme,
			{ '/p/alice': MODERATOR_COLOR_INDEX }
		);
		// Alice's preferred index 0 is rejected; she falls through to second-pass assignment at >=1
		const aliceColor = result.colors['Alice'];
		expect(aliceColor).not.toBe(generateParticipantColor(MODERATOR_COLOR_INDEX, darkTheme));
		expect(result.newPreferences['/p/alice']).toBeGreaterThanOrEqual(1);
	});
});

describe('palette constants', () => {
	it('exposes MODERATOR_COLOR_INDEX = 0', () => {
		expect(MODERATOR_COLOR_INDEX).toBe(0);
	});

	it('exposes COLOR_PALETTE_SIZE matching the base hue table length', () => {
		expect(COLOR_PALETTE_SIZE).toBeGreaterThan(0);
		// Sanity check against the documented palette of 10 base hues
		expect(COLOR_PALETTE_SIZE).toBe(10);
	});
});

describe('re-exports from shared/group-chat-types', () => {
	it('re-exports `normalizeMentionName` as a function', () => {
		expect(typeof normalizeMentionName).toBe('function');
	});

	it('re-exports `mentionMatches` as a function', () => {
		expect(typeof mentionMatches).toBe('function');
	});
});
