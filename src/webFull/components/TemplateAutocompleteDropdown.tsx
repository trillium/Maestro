/**
 * TemplateAutocompleteDropdown
 *
 * Lifted from `src/renderer/components/TemplateAutocompleteDropdown.tsx` as
 * part of the Layer 2.5 leaf-parade lift wave. Implementation is verbatim
 * except for two import-path adjustments matching the L2.5 precedent:
 * - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard L2.5
 *   swap — webFull has no `types/` aggregator; the type lives in the
 *   canonical shared module).
 * - `AutocompleteState` from `'../hooks'` → `'../../renderer/hooks'`
 *   directly (type-only import). The hook barrel at
 *   `src/renderer/hooks/index.ts` re-exports the interface from
 *   `useTemplateAutocomplete`, and the interface itself is a pure data shape
 *   (`{ isOpen, position, selectedIndex, searchText, filteredVariables }`)
 *   with no transitive `window.maestro` references at module-load time. This
 *   matches the L2.5 `GroupChatHeader` / `GroupChatPanel` precedent of
 *   pulling specific type-only re-exports from the canonical renderer
 *   aggregator rather than copying them into `src/shared/`, which would
 *   create the silent-drift surface audit risk A explicitly warns against.
 *
 * Component body is verbatim from the renderer source. It is a
 * `forwardRef<HTMLDivElement>` purely-presentational dropdown that renders
 * the absolute-positioned template-variable picker used by both the AI tab
 * prompt composer (`AgentPromptComposerModal`) and the Auto Run document
 * editor. Behavior is gated entirely on the `state` prop:
 *   - returns `null` when `!state.isOpen` OR
 *     `state.filteredVariables.length === 0`
 *   - renders a scrollable list of rows: each row shows a `<code>` chip with
 *     the variable name and a description `<span>`; the
 *     `state.selectedIndex` row gets `theme.colors.bgActivity` background
 *   - hover updates the row's background via direct `style.backgroundColor`
 *     mutation (preserves the renderer's exact behavior — no setState on
 *     hover)
 *   - footer shows three `<kbd>` chips: ↑↓ navigate, Tab select, Esc close
 *
 * Pre-flight grep on the renderer source returned empty (no `window.maestro`,
 * no `from 'electron'`); the component is presentational-only. All side
 * effects are delivered via the `onSelect` prop callback that the host
 * wires.
 */

import { forwardRef } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { AutocompleteState } from '../../renderer/hooks';

interface TemplateAutocompleteDropdownProps {
	theme: Theme;
	state: AutocompleteState;
	onSelect: (variable: string) => void;
}

/**
 * Dropdown component that displays template variable suggestions.
 * Used by both AgentPromptComposerModal and AutoRun document editor.
 */
export const TemplateAutocompleteDropdown = forwardRef<
	HTMLDivElement,
	TemplateAutocompleteDropdownProps
>(function TemplateAutocompleteDropdown({ theme, state, onSelect }, ref) {
	if (!state.isOpen || state.filteredVariables.length === 0) {
		return null;
	}

	return (
		<div
			ref={ref}
			className="absolute z-50 rounded-lg border shadow-xl overflow-hidden"
			style={{
				top: state.position.top,
				left: state.position.left,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				minWidth: '280px',
				maxWidth: '380px',
				maxHeight: '240px',
			}}
		>
			<div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: '240px' }}>
				{state.filteredVariables.map((item, index) => (
					<div
						key={item.variable}
						data-index={index}
						className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
						style={{
							backgroundColor:
								index === state.selectedIndex ? theme.colors.bgActivity : 'transparent',
						}}
						onClick={() => onSelect(item.variable)}
						onMouseEnter={(e) => {
							// Update visual selection on hover
							const target = e.currentTarget;
							target.style.backgroundColor = theme.colors.bgActivity;
						}}
						onMouseLeave={(e) => {
							// Reset unless this is the selected item
							const target = e.currentTarget;
							if (index !== state.selectedIndex) {
								target.style.backgroundColor = 'transparent';
							}
						}}
					>
						<code
							className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
							style={{
								backgroundColor: theme.colors.bgMain,
								color: theme.colors.accent,
							}}
						>
							{item.variable}
						</code>
						<span className="text-xs truncate" style={{ color: theme.colors.textDim }}>
							{item.description}
						</span>
					</div>
				))}
			</div>
			<div
				className="px-3 py-1.5 border-t text-xs"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
					backgroundColor: theme.colors.bgMain,
				}}
			>
				<kbd
					className="px-1 py-0.5 rounded text-[10px]"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					↑↓
				</kbd>{' '}
				navigate{' '}
				<kbd
					className="px-1 py-0.5 rounded text-[10px]"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					Tab
				</kbd>{' '}
				select{' '}
				<kbd
					className="px-1 py-0.5 rounded text-[10px]"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					Esc
				</kbd>{' '}
				close
			</div>
		</div>
	);
});
