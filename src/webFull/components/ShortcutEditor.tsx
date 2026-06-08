/**
 * ShortcutEditor
 *
 * Lifted from `src/renderer/components/ShortcutEditor.tsx` (73 LOC, 0 IPC,
 * 0 Electron-only API per pre-flight grep) as part of the Layer 2.5
 * leaf-parade lift wave. Tiny UI primitive — a scrollable list of
 * shortcuts with a clickable "record new key combination" button per row.
 * Body-verbatim render: identical JSX, classNames, inline style values,
 * key handlers, ARIA-implicit element types.
 *
 * Pre-flight on the renderer source returned empty:
 *
 *   grep -E "window\.maestro\.|from 'electron'|shell\.openExternal|shell\.openPath|ipcRenderer"
 *
 * Composition shape: no Modal, no layer-stack, no MODAL_PRIORITIES, no
 * focus-trap, no portals, no lifecycle effects. Self-contained block: an
 * outer scrollable `<div>` containing one row `<div>` per shortcut, each
 * row containing a `<span>` label and a `<button>` recorder. The button
 * is the only stateful surface — clicking it enters a per-row recording
 * mode, and the next key event (other than Escape, which cancels, or a
 * pure modifier, which is ignored) is captured into `shortcuts[id].keys`
 * via the `setShortcuts` callback. Owns local `recordingId` state only;
 * the parent owns the canonical shortcut map.
 *
 * Import-path adapts (two — same pattern as `SettingCheckbox`,
 * `ShortcutsHelpModal`, `ThemePicker`):
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard
 *     L2.5 swap — webFull has no `types/` aggregator).
 *   - `Shortcut` from `'../types'` → `'../../renderer/types'` (same swap
 *     used by `ShortcutsHelpModal` — `Shortcut` is a pure structural type
 *     `{ id: string; label: string; keys: string[] }` with no runtime
 *     dependencies that touch `window.maestro` / Electron preload; the
 *     renderer types module is type-only-import-safe).
 *   - `formatShortcutKeys` from `'../utils/shortcutFormatter'` →
 *     `'../utils/shortcutFormatter'` (the webFull shim already exists at
 *     `src/webFull/utils/shortcutFormatter.ts`, mirrors the renderer's
 *     public API, and routes platform detection through
 *     `navigator.userAgent` instead of `window.maestro.platform`). This
 *     is the same shim used by the L2.5 `ShortcutsHelpModal` and
 *     `AutoRunnerHelpModal` lifts.
 *
 * No transitive project deps beyond `react`. Lifted body-verbatim —
 * identical JSX, classNames, inline style values (including the inline
 * CSS custom property `--tw-ring-color` for the `ring-2` focus ring),
 * key handlers, recorded-key tuple shape (Meta / Ctrl / Alt / Shift
 * prefix order + raw `e.key` for the non-modifier; arrow keys preserved
 * as `ArrowLeft` / `ArrowRight` / etc.).
 */

import React, { useState } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { Shortcut } from '../../renderer/types';
import { formatShortcutKeys } from '../utils/shortcutFormatter';

export interface ShortcutEditorProps {
	theme: Theme;
	shortcuts: Record<string, Shortcut>;
	setShortcuts: (shortcuts: Record<string, Shortcut>) => void;
}

export function ShortcutEditor({ theme, shortcuts, setShortcuts }: ShortcutEditorProps) {
	const [recordingId, setRecordingId] = useState<string | null>(null);

	const handleRecord = (e: React.KeyboardEvent, actionId: string) => {
		e.preventDefault();
		e.stopPropagation();

		// If Escape is pressed, cancel recording without changing the shortcut
		if (e.key === 'Escape') {
			setRecordingId(null);
			return;
		}

		const keys = [];
		if (e.metaKey) keys.push('Meta');
		if (e.ctrlKey) keys.push('Ctrl');
		if (e.altKey) keys.push('Alt');
		if (e.shiftKey) keys.push('Shift');

		// Skip if only modifier keys are pressed
		if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;

		// Keep arrow keys as-is (ArrowLeft, ArrowRight, etc.)
		keys.push(e.key);
		setShortcuts({
			...shortcuts,
			[actionId]: { ...shortcuts[actionId], keys },
		});
		setRecordingId(null);
	};

	return (
		<div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
			{Object.values(shortcuts).map((sc) => (
				<div
					key={sc.id}
					className="flex items-center justify-between p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{sc.label}
					</span>
					<button
						onClick={() => setRecordingId(sc.id)}
						onKeyDown={(e) => recordingId === sc.id && handleRecord(e, sc.id)}
						className={`px-3 py-1.5 rounded border text-xs font-mono min-w-[80px] text-center transition-colors ${recordingId === sc.id ? 'ring-2' : ''}`}
						style={
							{
								borderColor: recordingId === sc.id ? theme.colors.accent : theme.colors.border,
								backgroundColor:
									recordingId === sc.id ? theme.colors.accentDim : theme.colors.bgActivity,
								color: recordingId === sc.id ? theme.colors.accent : theme.colors.textDim,
								'--tw-ring-color': theme.colors.accent,
							} as React.CSSProperties
						}
					>
						{recordingId === sc.id ? 'Press keys...' : formatShortcutKeys(sc.keys)}
					</button>
				</div>
			))}
		</div>
	);
}
