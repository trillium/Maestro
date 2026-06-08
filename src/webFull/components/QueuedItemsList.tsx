/**
 * QueuedItemsList — webFull lift
 *
 * Layer 2.5 leaf-parade lift. Verbatim copy of
 * `src/renderer/components/QueuedItemsList.tsx` (279 LOC) with one
 * narrow type-resolution adapt. 0 IPC namespaces touched, 0 Electron-only
 * APIs touched, 0 `src/main/` / `src/web/` / `src/renderer/` / `src/server/`
 * files modified.
 *
 * **Reference oracle:** `src/renderer/components/QueuedItemsList.tsx` —
 * presentational queued-items panel that displays per-tab execution-queue
 * items (commands and messages) with expand/collapse for long messages,
 * an inline image-count indicator, a Remove button gated behind an
 * in-component confirmation modal, and HTML5 drag-and-drop reordering.
 * Pure render component — all side effects are delivered via prop
 * callbacks (`onRemoveQueuedItem`, `onReorderItems`) that the host wires
 * to its own runtime.
 *
 * **Why this lift is a precondition for `GroupChatInput`:** the renderer
 * `GroupChatInput.tsx` imports `QueuedItemsList` directly (line 32 of the
 * renderer source) and renders it inline above its textarea (line 456).
 * Per the leaf-parade audit #7 cited in the brief, `QueuedItemsList` is
 * one of two blocking deps that must lift before `GroupChatInput` can
 * itself be lifted with all sibling imports resolving inside the webFull
 * tree. Landing this leaf reduces the `GroupChatInput` blocking-deps
 * count from 2 → 1.
 *
 * **Pre-flight contract (matches audit):**
 * `grep -E "window\.maestro\.|from ['"]electron['"]" src/renderer/components/QueuedItemsList.tsx`
 * → empty. No module-load-time IPC, no Electron API surface, no clipboard
 * touch, no settings store self-source.
 *
 * **Import-path adapts (one — matching the L2.5 precedent):**
 *
 * - `Theme` resolves from `'../../shared/theme-types'` rather than the
 *   renderer's `'../types'` aggregator. Standard L2.5 swap — webFull has
 *   no `types/` aggregator (see `ExecutionQueueIndicator`, `ThemePicker`,
 *   `ContextWarningSash` precedents).
 *
 * - `QueuedItem` is NOT pulled from `'../types'`. The renderer's
 *   `QueuedItem` shape (10 fields: `id`, `timestamp`, `tabId`, `type`,
 *   `text`, `images`, `command`, `commandArgs`, `commandDescription`,
 *   `tabName`, `readOnlyMode`) is defined inline here as a narrow lifted
 *   type, matching the `ExecutionQueueIndicator` precedent of pulling
 *   only the specific data shape each lifted module consumes rather than
 *   copying the entire renderer aggregator into `src/shared/` (which
 *   would create the silent-drift surface audit risk A explicitly warns
 *   against). Unlike the indicator, this view actually touches more of
 *   the QueuedItem fields (`id`, `tabId`, `type`, `text`, `images`,
 *   `command`) so the local shape is wider than the indicator's narrow
 *   type — but still strictly narrower than the renderer's full
 *   `QueuedItem` (the `commandArgs`, `commandDescription`, `tabName`,
 *   `readOnlyMode`, `timestamp` fields are not read by this component).
 *   When/if the webFull `SessionData` grows an `executionQueue` field
 *   over the WebSocket protocol carrying the full `QueuedItem` shape,
 *   the narrow local type becomes a structural-subtype of the wider
 *   shape and callers can pass real items directly without changes.
 *
 * **What's IN this lift (verbatim from the renderer):**
 *
 * - QUEUED separator pill with item count.
 * - Per-item card with `borderLeft` colour discriminating command (success
 *   green) vs message (accent) types, drag-handle (`GripVertical`) shown
 *   only on hover when more than one item is queued, and Remove (`X`)
 *   button gated behind a confirmation modal.
 * - Long-message expand/collapse — `displayText.length > 200` gates the
 *   "Show all (N lines)" / "Show less" toggle that flips per-item state
 *   tracked in a `Set<string>` keyed by item id.
 * - Image-attachment indicator pluralizing on `item.images.length`.
 * - HTML5 drag-and-drop reordering via the four-handler dance
 *   (`onDragStart`, `onDragOver`, `onDragEnd`, `onDragLeave`) routing
 *   index pairs through `onReorderItems(fromIndex, toIndex)`. Visual
 *   feedback: dragged item dims to 0.4 opacity; drop target gets a
 *   translateY(4px) bump + a coloured top boxShadow line. Drag is
 *   gated on `onReorderItems` presence AND `filteredQueue.length > 1`.
 * - Confirmation modal with `Enter` to confirm, `Escape` to cancel,
 *   auto-focus on `Remove` button, click-outside dismisses.
 * - `activeTabId` filter: when provided, only items where `item.tabId ===
 *   activeTabId` are shown.
 * - Early-return `null` when the filtered queue is empty.
 * - `React.memo` wrapper + `displayName = 'QueuedItemsList'`.
 *
 * **What's OUT (no behavior changed, only the consumer wire is deferred):**
 *
 * - The host that produces `executionQueue` items and wires
 *   `onRemoveQueuedItem` / `onReorderItems` to the relevant store / WS
 *   broadcast — that's the feature host's contract, downstream-layer
 *   scope.
 *
 * **Theme access pattern:** kept the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift. Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * **0 IPC namespaces touched. 0 Electron-only APIs touched.**
 * Pre-flight grep `window\.maestro\.|from ['"]electron['"]|shell\.openExternal|shell\.openPath|ipcRenderer`
 * against the renderer source returned empty (exit 1).
 */

import React, { useState, useCallback, useRef, memo } from 'react';
import { X, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';

/**
 * Minimal queued-item shape this view reads. The renderer's full
 * `QueuedItem` (see `src/renderer/types/index.ts` line 211) carries
 * additional fields (`timestamp`, `commandArgs`, `commandDescription`,
 * `tabName`, `readOnlyMode`) — none of which this view touches. Keeping
 * the surface narrow means future wire-protocol additions to webFull's
 * `SessionData` are structurally compatible without rewriting callers,
 * matching the `ExecutionQueueIndicator` precedent.
 */
export type QueuedItemType = 'message' | 'command';

export interface QueuedItem {
	id: string;
	tabId: string;
	type: QueuedItemType;
	// For messages
	text?: string;
	images?: string[];
	// For commands
	command?: string;
}

interface QueuedItemsListProps {
	executionQueue: QueuedItem[];
	theme: Theme;
	onRemoveQueuedItem?: (itemId: string) => void;
	onReorderItems?: (fromIndex: number, toIndex: number) => void;
	activeTabId?: string; // If provided, only show queued items for this tab
}

/**
 * QueuedItemsList displays the execution queue with:
 * - Queued message separator with count
 * - Individual queued items (commands/messages)
 * - Long message expand/collapse functionality
 * - Image attachment indicators
 * - Remove button with confirmation modal
 * - Drag-and-drop reordering
 */
export const QueuedItemsList = memo(
	({
		executionQueue,
		theme,
		onRemoveQueuedItem,
		onReorderItems,
		activeTabId,
	}: QueuedItemsListProps) => {
		// Filter to only show items for the active tab if activeTabId is provided
		const filteredQueue = activeTabId
			? executionQueue.filter((item) => item.tabId === activeTabId)
			: executionQueue;
		// Queue removal confirmation state
		const [queueRemoveConfirmId, setQueueRemoveConfirmId] = useState<string | null>(null);

		// Track which queued messages are expanded (for viewing full content)
		const [expandedQueuedMessages, setExpandedQueuedMessages] = useState<Set<string>>(new Set());

		// Drag state
		const [dragIndex, setDragIndex] = useState<number | null>(null);
		const [dropIndex, setDropIndex] = useState<number | null>(null);
		const dragItemRef = useRef<number | null>(null);

		// Can only drag if we have reorder handler and more than 1 item
		const canDrag = !!onReorderItems && filteredQueue.length > 1;

		// Toggle expanded state for a queued message
		const toggleExpanded = useCallback((itemId: string) => {
			setExpandedQueuedMessages((prev) => {
				const newSet = new Set(prev);
				if (newSet.has(itemId)) {
					newSet.delete(itemId);
				} else {
					newSet.add(itemId);
				}
				return newSet;
			});
		}, []);

		// Handle keyboard events on confirmation modal
		const handleModalKeyDown = useCallback(
			(e: React.KeyboardEvent) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					if (onRemoveQueuedItem && queueRemoveConfirmId) {
						onRemoveQueuedItem(queueRemoveConfirmId);
					}
					setQueueRemoveConfirmId(null);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					setQueueRemoveConfirmId(null);
				}
			},
			[onRemoveQueuedItem, queueRemoveConfirmId]
		);

		// Handle confirm removal
		const handleConfirmRemove = useCallback(() => {
			if (onRemoveQueuedItem && queueRemoveConfirmId) {
				onRemoveQueuedItem(queueRemoveConfirmId);
			}
			setQueueRemoveConfirmId(null);
		}, [onRemoveQueuedItem, queueRemoveConfirmId]);

		// Drag handlers
		const handleDragStart = useCallback((index: number) => {
			dragItemRef.current = index;
			setDragIndex(index);
		}, []);

		const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
			e.preventDefault();
			if (dragItemRef.current !== null && dragItemRef.current !== index) {
				setDropIndex(index);
			}
		}, []);

		const handleDragEnd = useCallback(() => {
			if (dragItemRef.current !== null && dropIndex !== null && dragItemRef.current !== dropIndex) {
				onReorderItems?.(dragItemRef.current, dropIndex);
			}
			dragItemRef.current = null;
			setDragIndex(null);
			setDropIndex(null);
		}, [dropIndex, onReorderItems]);

		const handleDragLeave = useCallback(() => {
			setDropIndex(null);
		}, []);

		if (!filteredQueue || filteredQueue.length === 0) {
			return null;
		}

		return (
			<>
				{/* QUEUED separator */}
				<div className="mx-6 my-3 flex items-center gap-3">
					<div className="flex-1 h-px" style={{ backgroundColor: theme.colors.border }} />
					<span
						className="text-xs font-bold tracking-wider"
						style={{ color: theme.colors.warning }}
					>
						QUEUED ({filteredQueue.length})
					</span>
					<div className="flex-1 h-px" style={{ backgroundColor: theme.colors.border }} />
				</div>

				{/* Queued items */}
				{filteredQueue.map((item, index) => {
					const displayText = item.type === 'command' ? (item.command ?? '') : (item.text ?? '');
					const isLongMessage = displayText.length > 200;
					const isQueuedExpanded = expandedQueuedMessages.has(item.id);
					const isDragging = dragIndex === index;
					const isDropTarget = dropIndex === index;

					return (
						<div
							key={item.id}
							draggable={canDrag}
							onDragStart={() => handleDragStart(index)}
							onDragOver={(e) => handleDragOver(e, index)}
							onDragEnd={handleDragEnd}
							onDragLeave={handleDragLeave}
							className="mx-6 mb-2 p-3 rounded-lg relative group transition-all"
							style={{
								backgroundColor:
									item.type === 'command'
										? theme.colors.success + '20'
										: theme.colors.accent + '20',
								borderLeft: `3px solid ${item.type === 'command' ? theme.colors.success : theme.colors.accent}`,
								opacity: isDragging ? 0.4 : 0.6,
								transform: isDropTarget ? 'translateY(4px)' : 'none',
								boxShadow: isDropTarget ? `0 -2px 0 0 ${theme.colors.accent}` : 'none',
								cursor: canDrag ? 'grab' : 'default',
							}}
						>
							{/* Drag handle - only show when draggable */}
							{canDrag && (
								<div
									className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity"
									style={{ color: theme.colors.textDim }}
								>
									<GripVertical className="w-4 h-4" />
								</div>
							)}

							{/* Remove button */}
							<button
								onClick={() => setQueueRemoveConfirmId(item.id)}
								className="absolute top-2 right-2 p-1 rounded hover:bg-black/20 transition-colors"
								style={{ color: theme.colors.textDim }}
								title="Remove from queue"
							>
								<X className="w-4 h-4" />
							</button>

							{/* Item content */}
							<div
								className={`text-sm pr-8 whitespace-pre-wrap break-words ${canDrag ? 'pl-4' : ''}`}
								style={{ color: theme.colors.textMain }}
							>
								{item.type === 'command' && (
									<span style={{ color: theme.colors.success, fontWeight: 600 }}>
										{item.command}
									</span>
								)}
								{item.type === 'message' &&
									(isLongMessage && !isQueuedExpanded
										? displayText.substring(0, 200) + '...'
										: displayText)}
							</div>

							{/* Show more/less toggle for long messages */}
							{item.type === 'message' && isLongMessage && (
								<button
									onClick={() => toggleExpanded(item.id)}
									className="flex items-center gap-1 mt-2 text-xs px-2 py-1 rounded hover:opacity-70 transition-opacity"
									style={{
										color: theme.colors.accent,
										backgroundColor: theme.colors.bgActivity,
									}}
								>
									{isQueuedExpanded ? (
										<>
											<ChevronUp className="w-3 h-3" />
											Show less
										</>
									) : (
										<>
											<ChevronDown className="w-3 h-3" />
											Show all ({displayText.split('\n').length} lines)
										</>
									)}
								</button>
							)}

							{/* Images indicator */}
							{item.images && item.images.length > 0 && (
								<div className="mt-1 text-xs" style={{ color: theme.colors.textDim }}>
									{item.images.length} image{item.images.length > 1 ? 's' : ''} attached
								</div>
							)}
						</div>
					);
				})}

				{/* Queue removal confirmation modal */}
				{queueRemoveConfirmId && (
					<div
						className="fixed inset-0 flex items-center justify-center z-50"
						style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
						onClick={() => setQueueRemoveConfirmId(null)}
						onKeyDown={handleModalKeyDown}
					>
						<div
							className="p-4 rounded-lg shadow-xl max-w-md mx-4"
							style={{ backgroundColor: theme.colors.bgMain }}
							onClick={(e) => e.stopPropagation()}
							tabIndex={-1}
							ref={(el) => el?.focus()}
						>
							<h3 className="text-lg font-semibold mb-2" style={{ color: theme.colors.textMain }}>
								Remove Queued Message?
							</h3>
							<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
								This message will be removed from the queue and will not be sent.
							</p>
							<div className="flex gap-2 justify-end">
								<button
									onClick={() => setQueueRemoveConfirmId(null)}
									className="px-3 py-1.5 rounded text-sm"
									style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
								>
									Cancel
								</button>
								<button
									onClick={handleConfirmRemove}
									className="px-3 py-1.5 rounded text-sm"
									style={{ backgroundColor: theme.colors.error, color: 'white' }}
									autoFocus
								>
									Remove
								</button>
							</div>
						</div>
					</div>
				)}
			</>
		);
	}
);

QueuedItemsList.displayName = 'QueuedItemsList';
