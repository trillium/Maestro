/**
 * ThemeTab — webFull rewrite of renderer ThemeTab
 *
 * Layer 3.3 — Settings Theme-tab port. Per the feat/settings-subtabs-lift
 * brief, the renderer's `src/renderer/components/Settings/tabs/ThemeTab.tsx`
 * is 167 LOC with ZERO `window.maestro.*` IPC sites — it reads
 * `activeThemeId`, `customThemeColors`, and `customThemeBaseId` from the
 * renderer-side `useSettings()` hook (Zustand backed, talks to
 * `window.maestro.settings.{get,set}` IPC) and writes back through the
 * same hook. The only external surface is the `CustomThemeBuilder`
 * component, which is already lifted to `src/webFull/components/CustomThemeBuilder.tsx`.
 *
 * By the lift-vs-rewrite rule (≤1 IPC + already-lifted children → safe to
 * lift) this is technically a lift. We REWRITE-WITH-PRIMITIVES anyway for
 * consistency with the existing Layer 3.x catalog approach (Layer 3.1
 * General, 3.2 Display + Shortcuts all chose the rewrite pattern). The
 * rewrite uses the generic `useSettings()` hook from `src/webFull/hooks/`
 * since the webFull `useSettings` does NOT expose named field-level
 * accessors like the renderer one — only the generic `settings` map and
 * `setSetting(key, value)` writer.
 *
 * Coverage:
 *   - activeThemeId               — current theme selection (string key)
 *   - customThemeColors           — optional custom theme color overrides
 *   - customThemeBaseId           — base theme to derive custom theme from
 *   - Tab key navigation across   — local keydown handler
 *     theme grid (dark/light/vibe + custom)
 *   - Auto-focus on mount         — local useEffect with 50ms timer
 *
 * No deferred features. Zero IPC. Pure settings-store consumer.
 *
 * Out of scope (intentional):
 *   - The renderer's `onThemeImportError` / `onThemeImportSuccess` props
 *     are toast-bus hooks. webFull does not yet have an equivalent toast
 *     bus; the props are accepted and threaded through to
 *     `CustomThemeBuilder` for callers that want to wire their own
 *     notification surface. Default behavior: silently dropped, which
 *     matches webFull's "no surprises" rule for missing infra.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Moon, Sun, Sparkles, Check } from 'lucide-react';
import type { Theme, ThemeId, ThemeColors } from '../../../../shared/theme-types';
import { useSettings } from '../../../hooks/useSettings';
import { CustomThemeBuilder } from '../../CustomThemeBuilder';

export interface ThemeTabProps {
	theme: Theme;
	/** All available themes, keyed by id. Passed down from SettingsModal. */
	themes: Record<string, Theme>;
	/** Optional toast hook for custom-theme import errors. */
	onThemeImportError?: (message: string) => void;
	/** Optional toast hook for custom-theme import successes. */
	onThemeImportSuccess?: (message: string) => void;
}

/**
 * Coerce an unknown value to a non-empty string id, or fall back. Used
 * for `activeThemeId` / `customThemeBaseId` narrowing.
 */
function readStringId(s: Record<string, unknown>, key: string, fallback: string): string {
	const v = s[key];
	return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/**
 * Coerce an unknown value to a `ThemeColors`-shaped object. When the
 * stored value is missing or shape-broken, fall back to the active
 * theme's own colors so the builder always has a valid color set to
 * render against. Matches the renderer's behavior where the settings
 * store seeds `customThemeColors` from whatever theme was active when
 * the user first opened the Custom builder.
 */
function readThemeColors(
	s: Record<string, unknown>,
	key: string,
	fallback: ThemeColors
): ThemeColors {
	const v = s[key];
	if (!v || typeof v !== 'object' || Array.isArray(v)) return fallback;
	const obj = v as Record<string, unknown>;
	// Spread the fallback first, then overlay any string-valued keys from the
	// stored object. This is intentionally lenient — the CustomThemeBuilder
	// owns full validation of color values via its CSS `color` test.
	const out: ThemeColors = { ...fallback };
	const keys: (keyof ThemeColors)[] = [
		'bgMain',
		'bgSidebar',
		'bgActivity',
		'border',
		'textMain',
		'textDim',
		'accent',
		'accentDim',
		'accentText',
		'accentForeground',
		'success',
		'warning',
		'error',
	];
	for (const k of keys) {
		const val = obj[k as string];
		if (typeof val === 'string' && val.length > 0) {
			out[k] = val;
		}
	}
	return out;
}

export function ThemeTab({
	theme,
	themes,
	onThemeImportError,
	onThemeImportSuccess,
}: ThemeTabProps) {
	const { settings, setSetting } = useSettings();

	// Field accessors — keep narrowing isolated so the JSX stays clean.
	const activeThemeId = readStringId(settings, 'activeThemeId', 'dark') as ThemeId;
	const customThemeBaseId = readStringId(settings, 'customThemeBaseId', 'dark') as ThemeId;
	// Seed `customThemeColors` from the currently-active theme so the builder
	// has a complete `ThemeColors` shape when the user first opens the tab.
	const customThemeColors = readThemeColors(settings, 'customThemeColors', theme.colors);

	const themePickerRef = useRef<HTMLDivElement>(null);

	// Auto-focus theme picker on mount — mirrors the renderer's 50ms delay
	// so the focus race against modal-open animations resolves cleanly.
	useEffect(() => {
		const timer = setTimeout(() => themePickerRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	const setActiveThemeId = useCallback(
		(id: ThemeId) => {
			void setSetting('activeThemeId', id);
		},
		[setSetting]
	);
	const setCustomThemeColors = useCallback(
		(colors: ThemeColors) => {
			void setSetting('customThemeColors', colors);
		},
		[setSetting]
	);
	const setCustomThemeBaseId = useCallback(
		(id: ThemeId) => {
			void setSetting('customThemeBaseId', id);
		},
		[setSetting]
	);

	// Group themes by mode (exclude 'custom' theme - it's handled separately).
	// Same grouping the renderer does — keeps the ordering stable for keyboard
	// navigation across the dark → light → vibe → custom cycle.
	const groupedThemes = Object.values(themes).reduce(
		(acc: Record<string, Theme[]>, t: Theme) => {
			if (t.id === 'custom') return acc;
			if (!acc[t.mode]) acc[t.mode] = [];
			acc[t.mode].push(t);
			return acc;
		},
		{} as Record<string, Theme[]>
	);

	const handleThemePickerKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		e.preventDefault();
		e.stopPropagation();
		const allThemes = [
			...(groupedThemes['dark'] || []),
			...(groupedThemes['light'] || []),
			...(groupedThemes['vibe'] || []),
		];
		const allThemeIds = [...allThemes.map((t) => t.id), 'custom'];
		let currentIndex = allThemeIds.findIndex((id: string) => id === activeThemeId);
		if (currentIndex === -1) currentIndex = 0;

		let newThemeId: string;
		if (e.shiftKey) {
			const prevIndex = currentIndex === 0 ? allThemeIds.length - 1 : currentIndex - 1;
			newThemeId = allThemeIds[prevIndex];
		} else {
			const nextIndex = (currentIndex + 1) % allThemeIds.length;
			newThemeId = allThemeIds[nextIndex];
		}
		setActiveThemeId(newThemeId as ThemeId);

		// Scroll the newly selected theme button into view — small delay so
		// React commits the new selection's `data-theme-id` highlight before
		// we look it up.
		setTimeout(() => {
			const themeButton = themePickerRef.current?.querySelector(`[data-theme-id="${newThemeId}"]`);
			themeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}, 0);
	};

	return (
		<div
			ref={themePickerRef}
			className="space-y-6 outline-none"
			tabIndex={0}
			onKeyDown={handleThemePickerKeyDown}
			role="group"
			aria-label="Theme picker"
			data-testid="webfull-theme-tab"
		>
			{(['dark', 'light', 'vibe'] as const).map((mode) => (
				<div key={mode}>
					<div
						className="text-xs font-bold uppercase mb-3 flex items-center gap-2"
						style={{ color: theme.colors.textDim }}
					>
						{mode === 'dark' ? (
							<Moon className="w-3 h-3" />
						) : mode === 'light' ? (
							<Sun className="w-3 h-3" />
						) : (
							<Sparkles className="w-3 h-3" />
						)}
						{mode} Mode
					</div>
					<div className="grid grid-cols-2 gap-3" data-testid={`webfull-theme-group-${mode}`}>
						{groupedThemes[mode]?.map((t: Theme) => (
							<button
								key={t.id}
								data-theme-id={t.id}
								onClick={() => setActiveThemeId(t.id)}
								className={`p-3 rounded-lg border text-left transition-all ${
									activeThemeId === t.id ? 'ring-2' : ''
								}`}
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor: t.colors.bgSidebar,
										'--tw-ring-color': t.colors.accent,
									} as React.CSSProperties
								}
								tabIndex={-1}
								data-testid={`webfull-theme-button-${t.id}`}
								aria-pressed={activeThemeId === t.id}
							>
								<div className="flex justify-between items-center mb-2">
									<span className="text-sm font-bold" style={{ color: t.colors.textMain }}>
										{t.name}
									</span>
									{activeThemeId === t.id && (
										<Check className="w-4 h-4" style={{ color: t.colors.accent }} />
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

			{/* Custom Theme Builder — already lifted to webFull. Same prop surface
			    the renderer uses. */}
			<div data-theme-id="custom" data-testid="webfull-theme-custom">
				<CustomThemeBuilder
					theme={theme}
					customThemeColors={customThemeColors}
					setCustomThemeColors={setCustomThemeColors}
					customThemeBaseId={customThemeBaseId}
					setCustomThemeBaseId={setCustomThemeBaseId}
					isSelected={activeThemeId === 'custom'}
					onSelect={() => setActiveThemeId('custom' as ThemeId)}
					onImportError={onThemeImportError}
					onImportSuccess={onThemeImportSuccess}
				/>
			</div>
		</div>
	);
}

export default ThemeTab;
