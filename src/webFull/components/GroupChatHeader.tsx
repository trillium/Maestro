/**
 * GroupChatHeader.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/GroupChatHeader.tsx`
 * (143 LOC) into `src/webFull/`. Header bar for the Group Chat view: chat
 * name with participant count, total accumulated cost pill (with
 * incomplete-data marker), Stop All button (when state !== 'idle'), Info
 * action, Rename action (both via headline click and pencil icon), and an
 * optional right-panel toggle button.
 *
 * Direct sibling of the L2.5 `GroupChatMessages` lift that landed in the
 * same wave (branch `leaf-groupchat-messages`, ISC-44.layer-2.5.groupchat_messages,
 * merged in `c0d2904f0`). Continues the GroupChat module port — both lifts
 * compose into the eventual `GroupChatPanel` feature wiring, which is a
 * downstream-layer concern.
 *
 * Lift posture (per the L2.5 sibling lifts — `GroupChatMessages`,
 * `AutoRunnerHelpModal`, `ShortcutsHelpModal`, `PlaybookDeleteConfirmModal`):
 *
 * - Component body is verbatim from the renderer source. Only import paths
 *   adapt.
 * - The renderer `Theme` import (`'../types'`) → `'../../shared/theme-types'`
 *   (the renderer routes the type through `src/renderer/types/index.ts` which
 *   itself re-exports from `src/shared/theme-types`; webFull imports the
 *   type directly from the canonical source).
 * - The renderer group-chat type import (`GroupChatState`) moves from the
 *   renderer types barrel to its canonical source at
 *   `src/shared/group-chat-types.ts` (which is what the renderer barrel
 *   re-exports anyway). Same swap the L2.5 `GroupChatMessages` lift made.
 * - The `Shortcut` interface lives in the renderer types barrel only
 *   (`src/renderer/types/index.ts`, line 165) and is not yet replicated to
 *   `src/shared/`. Imported directly from `'../../renderer/types'` per the
 *   L2.5 `ShortcutsHelpModal` precedent (which uses the same import path
 *   for the same type). A future webFull-side `Shortcut` re-shim is not
 *   needed for this lift — the interface is a pure data shape with no
 *   transitive `window.maestro` references.
 * - `formatShortcutKeys` resolves against the webFull-side shim at
 *   `src/webFull/utils/shortcutFormatter.ts` (precursor infrastructure
 *   landed in the `leaf-autorunner-help` lift). The shim swaps the renderer
 *   formatter's transitive `window.maestro.platform` dependency for
 *   `navigator.userAgent`-based detection, so the call signature is
 *   unchanged. This lift is the third consumer of that shim (after
 *   `AutoRunnerHelpModal` and `GroupChatMessages`).
 *
 * IPC / Electron surface: zero. The renderer source touches no
 * `window.maestro.*`, no `electron` import, no `shell.openExternal`,
 * `shell.openPath`, or `ipcRenderer`. All side-effecting actions are
 * delivered through the prop callbacks (`onStopAll`, `onRename`,
 * `onShowInfo`, `onToggleRightPanel`), which the host wires to its own
 * runtime — feature wiring is a downstream-layer concern.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches.
 */

import { Info, Edit2, Columns, DollarSign, StopCircle } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { GroupChatState } from '../../shared/group-chat-types';
import type { Shortcut } from '../../renderer/types';
import { formatShortcutKeys } from '../utils/shortcutFormatter';

interface GroupChatHeaderProps {
	theme: Theme;
	name: string;
	participantCount: number;
	/** Total accumulated cost from all participants (including moderator) */
	totalCost?: number;
	/** True if one or more participants don't have cost data (makes total incomplete) */
	costIncomplete?: boolean;
	state: GroupChatState;
	onStopAll: () => void;
	onRename: () => void;
	onShowInfo: () => void;
	rightPanelOpen: boolean;
	onToggleRightPanel: () => void;
	shortcuts: Record<string, Shortcut>;
}

export function GroupChatHeader({
	theme,
	name,
	participantCount,
	totalCost,
	costIncomplete,
	state,
	onStopAll,
	onRename,
	onShowInfo,
	rightPanelOpen,
	onToggleRightPanel,
	shortcuts,
}: GroupChatHeaderProps): JSX.Element {
	return (
		<div
			className="flex items-center justify-between px-6 h-16 border-b shrink-0"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
		>
			<div className="flex items-center gap-3">
				<h1
					className="text-lg font-semibold cursor-pointer hover:opacity-80"
					style={{ color: theme.colors.textMain }}
					onClick={onRename}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onRename();
						}
					}}
					tabIndex={0}
					role="button"
					title="Click to rename"
				>
					Group Chat: {name}
				</h1>
				<button
					onClick={onRename}
					className="p-1 rounded hover:opacity-80"
					style={{ color: theme.colors.textDim }}
					title="Rename"
				>
					<Edit2 className="w-4 h-4" />
				</button>
			</div>

			<div className="flex items-center gap-2">
				{/* Stop All button - only shown when active */}
				{state !== 'idle' && (
					<button
						onClick={onStopAll}
						className="flex items-center gap-1 text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity cursor-pointer"
						style={{
							backgroundColor: `${theme.colors.error}20`,
							color: theme.colors.error,
							border: `1px solid ${theme.colors.error}40`,
						}}
						title="Stop all moderator and participant activity"
					>
						<StopCircle className="w-3.5 h-3.5" />
						Stop All
					</button>
				)}
				<span
					className="text-xs px-2 py-0.5 rounded-full"
					style={{
						backgroundColor: theme.colors.border,
						color: theme.colors.textDim,
					}}
				>
					{participantCount} participant{participantCount !== 1 ? 's' : ''}
				</span>
				{/* Total cost pill - only show when there's a cost */}
				{totalCost !== undefined && totalCost > 0 && (
					<span
						className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
						style={{
							backgroundColor: `${theme.colors.success}20`,
							color: theme.colors.success,
						}}
						title={
							costIncomplete
								? 'Total accumulated cost (incomplete: not all agents report cost data)'
								: 'Total accumulated cost'
						}
					>
						<DollarSign className="w-3 h-3" />
						{totalCost.toFixed(2)}
						{costIncomplete && '*'}
					</span>
				)}
				<button
					onClick={onShowInfo}
					className="p-2 rounded hover:opacity-80"
					style={{ color: theme.colors.textDim }}
					title="Info"
				>
					<Info className="w-5 h-5" />
				</button>
				{!rightPanelOpen && (
					<button
						onClick={onToggleRightPanel}
						className="p-2 rounded hover:bg-white/5"
						title={`Show right panel (${formatShortcutKeys(shortcuts.toggleRightPanel.keys)})`}
					>
						<Columns className="w-4 h-4" />
					</button>
				)}
			</div>
		</div>
	);
}
