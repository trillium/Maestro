/**
 * ThemePicker
 *
 * Lifted from `src/renderer/components/ThemePicker.tsx` as part of the
 * Layer 2.5 leaf-parade wave. Implementation is verbatim except for one
 * import-path adjustment matching the L2.5 precedent:
 * - `Theme` and `ThemeId` from `'../types'` → `'../../shared/theme-types'`
 *   (the renderer routes these through `src/renderer/types/index.ts`,
 *   which itself re-exports from `src/shared/theme-types`; webFull
 *   imports the canonical source directly because it has no `types/`
 *   aggregator with this re-export shape).
 *
 * Pre-flight (per brief):
 *   grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer" \
 *     src/renderer/components/ThemePicker.tsx
 *   → empty (exit 1). No direct Electron / IPC surface.
 *
 * Transitive deps (all pure):
 * - `react` — universal.
 * - `lucide-react` `Moon` / `Sun` — already webFull-tree deps (used by
 *   sibling L2.5 lifts).
 * - `Theme`, `ThemeId` — pure types from `src/shared/theme-types`.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop
 * convention, consistent with the L2.1 Modal/FormInput primitives and
 * the L2.4 / L2.5 sibling lifts. Callers in webFull will call
 * `const { theme } = useTheme()` at the feature-component level and
 * thread the theme down — same pattern as every other lifted leaf.
 *
 * Scope (per brief): 70 LOC, 0 IPC, pure presentational primitive that
 * renders a two-column grid of theme swatches grouped by mode (dark /
 * light) with the active selection ringed in the current accent colour.
 * Click handler is a plain `(id) => void` callback — no IPC, no
 * Electron, no `window.maestro`. The actual `setActiveThemeId` plumbing
 * (settings store write, broadcast) lives upstream of this component
 * and stays in the renderer / will be lifted in its own brief.
 */

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import type { Theme, ThemeId } from '../../shared/theme-types';

interface ThemePickerProps {
	theme: Theme;
	themes: Record<ThemeId, Theme>;
	activeThemeId: ThemeId;
	setActiveThemeId: (id: ThemeId) => void;
}

export function ThemePicker({ theme, themes, activeThemeId, setActiveThemeId }: ThemePickerProps) {
	const grouped = Object.values(themes).reduce(
		(acc, t) => {
			if (!acc[t.mode]) acc[t.mode] = [];
			acc[t.mode].push(t);
			return acc;
		},
		{} as Record<string, Theme[]>
	);

	return (
		<div className="space-y-6">
			{['dark', 'light'].map((mode) => (
				<div key={mode}>
					<div
						className="text-xs font-bold uppercase mb-3 flex items-center gap-2"
						style={{ color: theme.colors.textDim }}
					>
						{mode === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
						{mode} Mode
					</div>
					<div className="grid grid-cols-2 gap-3">
						{grouped[mode]?.map((t) => (
							<button
								key={t.id}
								onClick={() => setActiveThemeId(t.id)}
								className={`p-3 rounded-lg border text-left transition-all ${activeThemeId === t.id ? 'ring-2' : ''}`}
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor: t.colors.bgSidebar,
										'--tw-ring-color': theme.colors.accent,
									} as React.CSSProperties
								}
							>
								<div className="flex justify-between items-center mb-2">
									<span className="text-sm font-bold" style={{ color: t.colors.textMain }}>
										{t.name}
									</span>
									{activeThemeId === t.id && (
										<div
											className="w-2 h-2 rounded-full"
											style={{ backgroundColor: theme.colors.accent }}
										/>
									)}
								</div>
								<div className="flex h-3 rounded overflow-hidden">
									<div className="flex-1" style={{ backgroundColor: t.colors.bgMain }} />
									<div className="flex-1" style={{ backgroundColor: t.colors.bgActivity }} />
									<div className="flex-1" style={{ backgroundColor: t.colors.accent }} />
								</div>
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
