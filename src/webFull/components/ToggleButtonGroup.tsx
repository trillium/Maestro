/**
 * ToggleButtonGroup
 *
 * Lifted from src/renderer/components/ToggleButtonGroup.tsx as part of the
 * Layer 2.5 leaf-parade wave (Architect audit #6 — 83 LOC, 0 IPC, 0
 * Electron-only API). Implementation is verbatim except for one import path:
 *
 * - `Theme` now resolves from `../../shared/theme-types` (renderer routes
 *   through `src/renderer/types/index.ts`; webFull imports the type directly).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1/L2.4/L2.5 lifted primitives. Callers in webFull
 * call `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * Distinguishing feature vs the L2.5 modal-shape siblings (PlaybookDelete,
 * RenameGroup, DeleteWorktree, etc.): this is a pure stateless UI primitive
 * with no modal lifecycle, no layer-stack registration, no focus management.
 * It renders a horizontal row of segmented toggle buttons with the active
 * option highlighted. Generic over the option value type (string | number).
 * Per-option custom colour overrides (`activeColor`, `ringColor`,
 * `activeTextColor`) are preserved verbatim so existing renderer call-sites
 * port without behavioural change. Memoised at the export boundary via
 * `React.memo` to match the renderer's render-perf posture.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { memo } from 'react';
import type { Theme } from '../../shared/theme-types';

export interface ToggleButtonOption<T extends string | number> {
	value: T;
	label?: string;
	/** Custom active background color (defaults to theme.colors.accentDim) */
	activeColor?: string;
	/** Custom ring color when active (defaults to theme.colors.accent or activeColor) */
	ringColor?: string;
	/** Custom text color when active (defaults to theme.colors.textMain) */
	activeTextColor?: string;
}

interface ToggleButtonGroupProps<T extends string | number> {
	/** Array of options - can be simple values or objects with custom styling */
	options: (T | ToggleButtonOption<T>)[];
	/** Currently selected value */
	value: T;
	/** Callback when selection changes */
	onChange: (value: T) => void;
	/** Theme for styling */
	theme: Theme;
	/** Optional custom labels map (alternative to ToggleButtonOption.label) */
	labels?: Record<string, string>;
}

function ToggleButtonGroupInner<T extends string | number>({
	options,
	value,
	onChange,
	theme,
	labels,
}: ToggleButtonGroupProps<T>) {
	return (
		<div className="flex gap-2">
			{options.map((opt) => {
				// Normalize option to object form
				const option: ToggleButtonOption<T> =
					typeof opt === 'object' && opt !== null && 'value' in opt ? opt : { value: opt as T };

				const optValue = option.value;
				const isActive = value === optValue;

				// Determine display label: option.label > labels map > string value
				let displayLabel: string;
				if (option.label) {
					displayLabel = option.label;
				} else if (labels && String(optValue) in labels) {
					displayLabel = labels[String(optValue)];
				} else {
					displayLabel = String(optValue);
				}

				// Determine colors
				const activeColor = option.activeColor ?? theme.colors.accentDim;
				const ringColor = option.ringColor ?? option.activeColor ?? theme.colors.accent;
				const activeTextColor =
					option.activeTextColor ?? (option.activeColor ? 'white' : theme.colors.textMain);

				return (
					<button
						key={String(optValue)}
						onClick={() => onChange(optValue)}
						className={`flex-1 py-2 px-3 rounded border transition-all ${isActive ? 'ring-2' : ''}`}
						style={
							{
								borderColor: theme.colors.border,
								backgroundColor: isActive ? activeColor : 'transparent',
								'--tw-ring-color': ringColor,
								color: isActive ? activeTextColor : theme.colors.textMain,
							} as React.CSSProperties
						}
					>
						{displayLabel}
					</button>
				);
			})}
		</div>
	);
}

export const ToggleButtonGroup = memo(ToggleButtonGroupInner) as typeof ToggleButtonGroupInner;
