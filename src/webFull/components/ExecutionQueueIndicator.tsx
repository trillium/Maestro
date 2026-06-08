/**
 * ExecutionQueueIndicator — webFull lift
 *
 * Layer 2.5 leaf-parade lift. Verbatim copy of
 * `src/renderer/components/ExecutionQueueIndicator.tsx` (191 LOC) with
 * narrow type-resolution adapts to suit webFull's runtime shape. 0 IPC
 * namespaces touched, 0 Electron-only APIs touched, 0 `src/main/` /
 * `src/web/` / `src/renderer/` / `src/server/` files modified.
 *
 * **Reference oracle:** `src/renderer/components/ExecutionQueueIndicator.tsx`
 * — compact above-input indicator that surfaces the number of items queued
 * for sequential AI-mode execution within a session, with a click-handler
 * that opens the (renderer-side) `ExecutionQueueBrowser` modal for full
 * queue management. Pure presentational surface: a single `<button>` that
 * derives counts from `session.executionQueue` and renders a row of
 * `(icon, count summary, type-breakdown, dynamic tab-pill row, "Click to
 * view")` chrome. The component does its own dynamic-pill-width
 * measurement against `ResizeObserver` so the pill row gracefully
 * collapses to `+N` overflow when the available width can't fit them all.
 *
 * **Import-path adapts (matching the L2.5 precedent):**
 *
 * - `Theme` resolves from `'../../shared/theme-types'` rather than the
 *   renderer's `'../types'` aggregator. Established by L2.1/L2.3/L2.4/L2.5
 *   precedent — webFull has no `types/` aggregator.
 *
 * - `Session` and `QueuedItem` are NOT pulled from `'../types'`. The
 *   renderer's `Session` interface carries `executionQueue: QueuedItem[]`
 *   alongside ~80 other fields including Electron-bound surfaces (e.g.
 *   `claudeSession`, `agentSessionId` plumbing) that webFull does not
 *   model in its wire-protocol `SessionData`. Importing the renderer
 *   `Session` here would drag the entire renderer types graph into the
 *   webFull tree — the opposite of the lift's goal.
 *
 *   Instead, this lift defines a narrow `ExecutionQueueSession` type that
 *   captures the only field the indicator actually reads (`executionQueue`)
 *   and a local `QueuedItem` shape that mirrors the three fields it
 *   actually touches (`type`, `tabName`). The full renderer `QueuedItem`
 *   carries additional fields (`id`, `timestamp`, `tabId`, `text`, `images`,
 *   `command`, `commandArgs`, `commandDescription`, `readOnlyMode`); they
 *   are not part of the indicator's rendering contract and are therefore
 *   not part of the lifted module's type surface.
 *
 *   This matches the DeleteWorktreeModal / ShortcutsHelpModal precedent of
 *   pulling only the specific data shape each lifted module consumes,
 *   rather than copying the entire renderer aggregator into `src/shared/`
 *   (which would create the silent-drift surface audit risk A explicitly
 *   warns against). When/if the webFull `SessionData` grows an
 *   `executionQueue` field over the WebSocket protocol, this narrow type
 *   becomes a structural-subtype of the wider Session and callers can
 *   pass the real Session directly without changes here.
 *
 * **What's IN this lift (verbatim from the renderer):**
 *
 * - `ResizeObserver`-driven dynamic pill-row sizing — measures container
 *   width on mount + on container resize, computes how many pills fit at
 *   the renderer's fixed-element budget (340px non-pill chrome + 30px
 *   `+N` indicator), and renders 0..5 pills with optional per-pill
 *   `max-width` constraints when the budget per pill drops below 200px.
 * - Pill overflow into a styled `+N` token that mimics a regular pill
 *   when zero pills fit and demotes to a dim "+N" string when at least
 *   one pill is visible (the renderer's UX distinction between "no pills
 *   visible, so the +N token IS the pill row" and "some pills visible,
 *   so +N is just an overflow hint").
 * - Item-type breakdown showing `<MessageSquare/>{messageCount}` and/or
 *   `<Command/>{commandCount}` icons when each subtype is present.
 * - Tab-count aggregation via `reduce` keyed on `item.tabName || 'Unknown'`.
 * - Early-return-null when the queue is empty (component renders nothing).
 * - Plural pivot ("item" vs "items queued") at queue.length === 1.
 * - Verbatim Tailwind classnames and inline `theme.colors.*` lookups.
 *
 * **What's OUT (no behavior changed, only the consumer wire is deferred):**
 *
 * - The `ExecutionQueueBrowser` modal that the click handler opens —
 *   that's a separate, larger surface and is downstream-layer scope. The
 *   indicator's contract is "fire `onClick` when the user taps the
 *   indicator"; what the parent does with that callback is the parent's
 *   business.
 * - The `InputArea` wrapper that gates rendering on AI mode + queue
 *   non-empty — that's the consumer wire, also downstream-layer.
 *
 * **Theme access pattern:** kept the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift. Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * **0 IPC namespaces touched. 0 Electron-only APIs touched.**
 * Pre-flight grep `window\.maestro\.|from ['"]electron['"]|shell\.openExternal|shell\.openPath|ipcRenderer`
 * against the renderer source returned empty.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { ListOrdered, Command, MessageSquare } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';

/**
 * Minimal queued-item shape the indicator reads. The renderer's full
 * `QueuedItem` (see `src/renderer/types/index.ts`) carries additional
 * fields (`id`, `timestamp`, `tabId`, `text`, `images`, `command`,
 * `commandArgs`, `commandDescription`, `readOnlyMode`) — none of which
 * the indicator touches. Keeping this surface narrow means future wire-
 * protocol additions to webFull's `SessionData` are structurally
 * compatible without rewriting callers.
 */
export interface ExecutionQueueItem {
	type: 'message' | 'command';
	tabName?: string;
}

/**
 * Minimal session shape the indicator reads. The renderer passes its
 * full `Session` (~80 fields); webFull's `SessionData` does not yet
 * carry `executionQueue` over the wire — the indicator only needs this
 * one field, so the lift uses the narrow contract.
 */
export interface ExecutionQueueSession {
	executionQueue?: ExecutionQueueItem[];
}

export interface ExecutionQueueIndicatorProps {
	session: ExecutionQueueSession;
	theme: Theme;
	onClick: () => void; // Opens the ExecutionQueueBrowser modal
}

/**
 * Compact indicator showing the number of items queued for execution.
 * Appears above the input area when items are queued.
 * Clicking opens the ExecutionQueueBrowser modal for full queue management.
 */
export function ExecutionQueueIndicator({ session, theme, onClick }: ExecutionQueueIndicatorProps) {
	const queue = session.executionQueue || [];
	const containerRef = useRef<HTMLButtonElement>(null);
	const [maxVisiblePills, setMaxVisiblePills] = useState(3);

	// Count items by type
	const messageCount = queue.filter((item) => item.type === 'message').length;
	const commandCount = queue.filter((item) => item.type === 'command').length;

	// Group by tab to show tab-specific counts
	const tabCounts = queue.reduce(
		(acc, item) => {
			const tabName = item.tabName || 'Unknown';
			acc[tabName] = (acc[tabName] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>
	);

	const tabNames = Object.keys(tabCounts);

	// Calculate how many pills we can show and their max width based on available space
	const [maxPillWidth, setMaxPillWidth] = useState<number | null>(null);

	const calculateMaxPills = useCallback(() => {
		if (!containerRef.current) return;

		const containerWidth = containerRef.current.clientWidth;

		// Fixed elements take roughly:
		// - Icon: ~20px
		// - "X items queued": ~100px
		// - Tab count icon: ~30px
		// - Type breakdown: ~60px
		// - "Click to view": ~80px
		// - Gaps and padding: ~50px
		// Total fixed: ~340px
		const fixedWidth = 340;

		// "+N" indicator is roughly 30px
		const plusIndicatorWidth = 30;

		const availableWidth = containerWidth - fixedWidth - plusIndicatorWidth;

		// Calculate how many pills to show and their width
		const numTabs = tabNames.length;
		if (numTabs === 0) {
			setMaxVisiblePills(0);
			setMaxPillWidth(null);
			return;
		}

		// Minimum pill width (padding + some text)
		const minPillWidth = 60;
		// Maximum pills to show
		const maxPossiblePills = Math.min(5, numTabs);

		// Try to fit as many pills as possible, starting from max
		let pillsToShow = maxPossiblePills;
		let pillWidth: number | null = null;

		for (let n = maxPossiblePills; n >= 1; n--) {
			const widthPerPill = availableWidth / n;
			if (widthPerPill >= minPillWidth) {
				pillsToShow = n;
				// Only set max width if we need to constrain (when there's overflow potential)
				pillWidth = widthPerPill > 200 ? null : widthPerPill;
				break;
			}
		}

		// If even 1 pill doesn't fit, show 0 pills
		if (availableWidth < minPillWidth) {
			pillsToShow = 0;
			pillWidth = null;
		}

		setMaxVisiblePills(pillsToShow);
		setMaxPillWidth(pillWidth);
	}, [tabNames.length]);

	// Use ResizeObserver to recalculate when container size changes
	useEffect(() => {
		if (!containerRef.current) return;

		const observer = new ResizeObserver(() => {
			calculateMaxPills();
		});

		observer.observe(containerRef.current);

		// Initial calculation
		calculateMaxPills();

		return () => observer.disconnect();
	}, [calculateMaxPills, queue.length, tabNames.length]);

	if (queue.length === 0) {
		return null;
	}

	return (
		<button
			ref={containerRef}
			onClick={onClick}
			className="w-full mb-2 px-3 py-2 rounded-lg border flex items-center gap-2 text-sm transition-all hover:opacity-90"
			style={{
				backgroundColor: theme.colors.bgActivity,
				borderColor: theme.colors.border,
				color: theme.colors.textMain,
			}}
		>
			<ListOrdered className="w-4 h-4 flex-shrink-0" style={{ color: theme.colors.warning }} />

			<span className="text-left whitespace-nowrap">
				<span className="font-semibold">{queue.length}</span>{' '}
				{queue.length === 1 ? 'item' : 'items'} queued
			</span>

			{/* Item type breakdown */}
			<div className="flex items-center gap-2 text-xs opacity-70 flex-shrink-0">
				{messageCount > 0 && (
					<span className="flex items-center gap-1">
						<MessageSquare className="w-3 h-3" />
						{messageCount}
					</span>
				)}
				{commandCount > 0 && (
					<span className="flex items-center gap-1">
						<Command className="w-3 h-3" />
						{commandCount}
					</span>
				)}
			</div>

			{/* Spacer to push pills to the right */}
			<div className="flex-1" />

			{/* Tab pills - dynamically show as many as fit, then +N more */}
			<div className="flex items-center gap-1 flex-shrink-0">
				{tabNames.slice(0, maxVisiblePills).map((tabName) => {
					const countSuffix = tabCounts[tabName] > 1 ? ` (${tabCounts[tabName]})` : '';
					const fullText = tabName + countSuffix;
					return (
						<span
							key={tabName}
							className="px-1.5 py-0.5 rounded text-xs font-mono overflow-hidden text-ellipsis"
							style={{
								backgroundColor: theme.colors.accent + '30',
								color: theme.colors.textMain,
								maxWidth: maxPillWidth ? `${maxPillWidth}px` : undefined,
								whiteSpace: 'nowrap',
							}}
							title={fullText}
						>
							{fullText}
						</span>
					);
				})}
				{tabNames.length > maxVisiblePills && (
					<span
						className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
						style={{
							backgroundColor: maxVisiblePills === 0 ? theme.colors.accent + '30' : 'transparent',
							color: maxVisiblePills === 0 ? theme.colors.textMain : theme.colors.textDim,
						}}
					>
						+{tabNames.length - maxVisiblePills}
					</span>
				)}
			</div>

			<span className="text-xs opacity-50 flex-shrink-0 whitespace-nowrap">Click to view</span>
		</button>
	);
}
