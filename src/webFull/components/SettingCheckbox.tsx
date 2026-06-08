/**
 * SettingCheckbox
 *
 * Lifted from `src/renderer/components/SettingCheckbox.tsx` (86 LOC, 0 IPC,
 * 0 Electron-only API per pre-flight grep) as part of the Layer 2.5
 * leaf-parade lift wave. Tiny UI primitive — a labelled icon + clickable
 * row containing a title / optional description / toggle switch on the
 * right. Pure stateless render: parent owns `checked` state and receives
 * change events via `onChange(next: boolean)`.
 *
 * Pre-flight on the renderer source returned empty:
 *
 *   grep -E "window\.maestro\.|from 'electron'|shell\.openExternal|shell\.openPath|ipcRenderer"
 *
 * Composition shape: no Modal, no layer-stack, no MODAL_PRIORITIES, no
 * focus-trap. Self-contained block: an outer `<div>` with a `<label>`
 * carrying icon + section label, then a clickable role="button" row
 * containing a title block (title + optional description) and a
 * pill-shape `<button role="switch">` on the right. Click and Enter /
 * Space on the row both toggle; clicking the switch directly also
 * toggles (with `stopPropagation()` so the outer row's onClick doesn't
 * fire twice). Threads `theme` as a prop per the L2.1 / L2.4 / L2.5
 * convention.
 *
 * Import-path adapts (two):
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard
 *     L2.5 swap — webFull has no `types/` aggregator).
 *   - `LucideIcon` from `'lucide-react'` unchanged — already a webFull-tree
 *     dep (used by L2.1 Modal / ConfirmModal / Settings primitives and the
 *     L2.5 AgentErrorModal / ContextWarningSash / AutoRunnerHelpModal lifts).
 *
 * No transitive project deps beyond `react` + the `lucide-react` icon
 * type. Lifted body-verbatim — identical JSX, classNames, inline style
 * values, key handlers, ARIA attributes (`role="button"`, `tabIndex={0}`,
 * `role="switch"`, `aria-checked`).
 */

import React from 'react';
import type { Theme } from '../../shared/theme-types';
import type { LucideIcon } from 'lucide-react';

export interface SettingCheckboxProps {
	/** The icon to display next to the section label */
	icon: LucideIcon;
	/** The section label shown above the checkbox */
	sectionLabel: string;
	/** The main title text shown next to the checkbox */
	title: string;
	/** Optional description text shown below the title */
	description?: string;
	/** Whether the checkbox is checked */
	checked: boolean;
	/** Callback when the checkbox state changes */
	onChange: (checked: boolean) => void;
	/** The current theme */
	theme: Theme;
}

/**
 * A reusable toggle component for settings with a consistent layout:
 * - Section label with icon
 * - Clickable container with title, description, and toggle switch on the right
 */
export function SettingCheckbox({
	icon: Icon,
	sectionLabel,
	title,
	description,
	checked,
	onChange,
	theme,
}: SettingCheckboxProps): React.ReactElement {
	return (
		<div>
			<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
				<Icon className="w-3 h-3" />
				{sectionLabel}
			</label>
			<div
				className="flex items-center justify-between p-3 rounded border cursor-pointer hover:bg-opacity-10"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				onClick={() => onChange(!checked)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onChange(!checked);
					}
				}}
			>
				<div className="flex-1 pr-3">
					<div className="font-medium" style={{ color: theme.colors.textMain }}>
						{title}
					</div>
					{description && (
						<div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
							{description}
						</div>
					)}
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onChange(!checked);
					}}
					className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
					style={{
						backgroundColor: checked ? theme.colors.accent : theme.colors.bgActivity,
					}}
					role="switch"
					aria-checked={checked}
				>
					<span
						className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
							checked ? 'translate-x-5' : 'translate-x-0.5'
						}`}
					/>
				</button>
			</div>
		</div>
	);
}
