/**
 * useColumnModeKeymap — convert the user-configurable column-mode shortcuts
 * into a CodeMirror 6 `KeyBinding[]`.
 *
 * Reads the live `columnModeAddCursorAbove` and `columnModeAddCursorBelow`
 * entries from `useSettings().shortcuts` (mirrors the access pattern in
 * `Settings/tabs/ShortcutsTab.tsx`) and maps each chord to CM6's
 * `addCursorAbove` / `addCursorBelow` commands. Falls back to the bundled
 * `DEFAULT_SHORTCUTS` entry if the user's settings haven't been migrated to
 * include the new keys yet.
 *
 * Maestro stores shortcuts as `string[]` (e.g. `['Alt', 'Meta', 'ArrowUp']`).
 * CodeMirror's keymap parser expects a hyphen-joined chord (e.g.
 * `'Mod-Alt-ArrowUp'`) with `Mod` being the platform meta key — Cmd on macOS,
 * Ctrl elsewhere — which is exactly what Maestro represents with `Meta`.
 */

import { useMemo } from 'react';
import { addCursorAbove, addCursorBelow } from '@codemirror/commands';
import type { KeyBinding } from '@codemirror/view';

import { useSettings } from '../../../hooks';
import { DEFAULT_SHORTCUTS } from '../../../constants/shortcuts';

const MAESTRO_TO_CM6_MODIFIER: Record<string, string> = {
	Meta: 'Mod',
	Alt: 'Alt',
	Shift: 'Shift',
	Control: 'Ctrl',
	Ctrl: 'Ctrl',
};

function keysToChord(keys: string[]): string | null {
	if (keys.length === 0) return null;
	const parts = keys.map((key) => MAESTRO_TO_CM6_MODIFIER[key] ?? key);
	return parts.join('-');
}

export function useColumnModeKeymap(): KeyBinding[] {
	const { shortcuts } = useSettings();

	return useMemo(() => {
		const bindings: KeyBinding[] = [];

		const aboveKeys =
			shortcuts.columnModeAddCursorAbove?.keys ?? DEFAULT_SHORTCUTS.columnModeAddCursorAbove.keys;
		const aboveChord = keysToChord(aboveKeys);
		if (aboveChord) {
			bindings.push({ key: aboveChord, run: addCursorAbove, preventDefault: true });
		}

		const belowKeys =
			shortcuts.columnModeAddCursorBelow?.keys ?? DEFAULT_SHORTCUTS.columnModeAddCursorBelow.keys;
		const belowChord = keysToChord(belowKeys);
		if (belowChord) {
			bindings.push({ key: belowChord, run: addCursorBelow, preventDefault: true });
		}

		return bindings;
	}, [shortcuts]);
}
