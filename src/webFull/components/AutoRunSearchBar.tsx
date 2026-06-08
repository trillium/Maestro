/**
 * AutoRunSearchBar.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/AutoRunSearchBar.tsx`
 * (132 LOC) into `src/webFull/`. A small in-document search bar primitive used
 * by the Auto Run document view: text input with auto-focus, "currentIndex /
 * totalMatches" counter, prev/next navigation buttons, an explicit close
 * button, and keyboard shortcuts (Enter → next match, Shift+Enter → previous
 * match, Escape → close via the layer stack).
 *
 * Lift posture (per the established L2.5 lift convention — `AgentErrorModal`,
 * `ContextWarningSash`, `GroupChatHeader`, `MarkdownRenderer`, …):
 *
 * - Component body is verbatim from the renderer source. Only import paths
 *   adapt.
 * - The renderer `Theme` import (`'../types'`) → `'../../shared/theme-types'`
 *   (the renderer routes the type through `src/renderer/types/index.ts` which
 *   itself re-exports from `src/shared/theme-types`; webFull imports the type
 *   directly from the canonical source).
 * - `useLayerStack` import path string is identical to the renderer source
 *   (`'../contexts/LayerStackContext'`) — resolves under webFull's tsconfig
 *   to the L2.1-lifted context at `src/webFull/contexts/LayerStackContext.tsx`.
 * - `MODAL_PRIORITIES` resolves via the existing webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (which re-exports
 *   `../../renderer/constants/modalPriorities` so the priority constants
 *   stay in lockstep — same pattern used by `AgentErrorModal`,
 *   `CreateGroupModal`, `ConfirmModal`, …). Consumes
 *   `MODAL_PRIORITIES.AUTORUN_SEARCH` (706).
 *
 * IPC / Electron surface: zero. The renderer source touches no
 * `window.maestro.*`, no `electron` import, no `shell.openExternal`,
 * `shell.openPath`, or `ipcRenderer`. All side-effecting actions are
 * delivered through prop callbacks (`onSearchQueryChange`, `onNextMatch`,
 * `onPrevMatch`, `onClose`), which the host wires to its own runtime —
 * feature wiring is a downstream-layer concern.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

export interface AutoRunSearchBarProps {
	theme: Theme;
	searchQuery: string;
	onSearchQueryChange: (query: string) => void;
	currentMatchIndex: number;
	totalMatches: number;
	onNextMatch: () => void;
	onPrevMatch: () => void;
	onClose: () => void;
}

/**
 * AutoRunSearchBar - A search bar component for finding text within Auto Run documents.
 *
 * Features:
 * - Text search input with auto-focus
 * - Match counter (e.g., "1/5")
 * - Navigation buttons for next/previous match
 * - Keyboard shortcuts: Enter (next), Shift+Enter (prev), Escape (close)
 *
 * Extracted from AutoRun.tsx to reduce file size (~70 lines).
 */
export function AutoRunSearchBar({
	theme,
	searchQuery,
	onSearchQueryChange,
	currentMatchIndex,
	totalMatches,
	onNextMatch,
	onPrevMatch,
	onClose,
}: AutoRunSearchBarProps) {
	const searchInputRef = useRef<HTMLInputElement>(null);
	const { registerLayer, unregisterLayer } = useLayerStack();
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Register with layer stack so Escape closes search before modal
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.AUTORUN_SEARCH,
			blocksLowerLayers: false,
			capturesFocus: true,
			focusTrap: 'lenient',
			onEscape: () => onCloseRef.current(),
		});
		return () => unregisterLayer(id);
	}, [registerLayer, unregisterLayer]);

	// Auto-focus the search input when the component mounts
	useEffect(() => {
		searchInputRef.current?.focus();
	}, []);

	// Handle keyboard navigation within the search input
	// Note: Escape is now handled by the layer stack, not here
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				onNextMatch();
			} else if (e.key === 'Enter' && e.shiftKey) {
				e.preventDefault();
				onPrevMatch();
			}
		},
		[onNextMatch, onPrevMatch]
	);

	return (
		<div
			className="mx-2 mb-2 flex items-center gap-2 px-3 py-2 rounded"
			style={{
				backgroundColor: theme.colors.bgActivity,
				border: `1px solid ${theme.colors.accent}`,
			}}
		>
			<Search className="w-4 h-4 shrink-0" style={{ color: theme.colors.accent }} />
			<input
				ref={searchInputRef}
				type="text"
				value={searchQuery}
				onChange={(e) => onSearchQueryChange(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Search..."
				className="flex-1 bg-transparent outline-none text-sm"
				style={{ color: theme.colors.textMain }}
				autoFocus
			/>
			{searchQuery.trim() && (
				<>
					<span className="text-xs whitespace-nowrap" style={{ color: theme.colors.textDim }}>
						{totalMatches > 0 ? `${currentMatchIndex + 1}/${totalMatches}` : 'No matches'}
					</span>
					<button
						onClick={onPrevMatch}
						disabled={totalMatches === 0}
						className="p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
						style={{ color: theme.colors.textDim }}
						title="Previous match (Shift+Enter)"
					>
						<ChevronUp className="w-4 h-4" />
					</button>
					<button
						onClick={onNextMatch}
						disabled={totalMatches === 0}
						className="p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
						style={{ color: theme.colors.textDim }}
						title="Next match (Enter)"
					>
						<ChevronDown className="w-4 h-4" />
					</button>
				</>
			)}
			<button
				onClick={onClose}
				className="p-1 rounded hover:bg-white/10 transition-colors"
				style={{ color: theme.colors.textDim }}
				title="Close search (Esc)"
			>
				<X className="w-4 h-4" />
			</button>
		</div>
	);
}
