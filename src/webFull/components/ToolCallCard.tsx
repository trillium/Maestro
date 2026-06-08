/**
 * ToolCallCard — webFull lift
 *
 * Layer 2.5 leaf-parade lift. Verbatim copy of
 * `src/renderer/components/ToolCallCard.tsx` (269 LOC) with one narrow
 * type-resolution adapt. 0 IPC namespaces touched, 0 Electron-only APIs
 * touched, 0 `src/main/` / `src/web/` / `src/renderer/` / `src/server/`
 * files modified.
 *
 * **Reference oracle:** `src/renderer/components/ToolCallCard.tsx` —
 * presentational tool-execution card that surfaces tool call details from
 * OpenCode and Codex session messages. Renders a collapsed pill (tool name
 * + status icon + "Show more" affordance) by default; expands on
 * click/keyboard to show input JSON, status row with optional timestamp,
 * and output JSON, each in independently-collapsible sections that
 * truncate at 5 lines / 150px max-height by default and offer their own
 * "Show more" toggle. Both name-keys (Claude `name` and OpenCode `tool`)
 * are honoured by the exported `getToolName` helper.
 *
 * **Pre-flight contract:**
 * `grep -E "window\.maestro\.|from ['"]electron['"]" src/renderer/components/ToolCallCard.tsx`
 * → empty. No module-load-time IPC, no Electron API surface, no clipboard
 * touch, no settings store self-source. Pure render — all side effects
 * are owned internally by `useState` toggles (expanded/collapsed); no
 * callbacks fired upward.
 *
 * **Import-path adapt (one — matching the L2.5 precedent):**
 *
 * - `Theme` resolves from `'../../shared/theme-types'` rather than the
 *   renderer's `'../types'` aggregator. Standard L2.5 swap — webFull has
 *   no `types/` aggregator (see `ExecutionQueueIndicator`, `ThemePicker`,
 *   `ContextWarningSash`, `QueuedItemsList`, `GitStatusWidget`
 *   precedents).
 *
 * **Type shape kept inline:** the renderer source defines `ToolState` and
 * `ToolUseEntry` inline as session-message data shapes (the renderer does
 * NOT pull them from a shared aggregator). The lift keeps the same
 * inline definitions — they are narrow data shapes the component reads
 * directly off the session message, and the source-of-truth lives in the
 * OpenCode / Codex session parsers (`src/main/parsers/`). Re-defining
 * here matches the renderer's own pattern and matches the
 * `ExecutionQueueIndicator` / `QueuedItemsList` precedent of pulling only
 * the specific data shape each lifted module consumes rather than
 * copying the entire renderer aggregator into `src/shared/`.
 *
 * **What this lift is NOT:**
 *
 * - Not a lift of the OpenCode / Codex parsers (`src/main/parsers/`) —
 *   those run server-side and emit the `ToolUseEntry[]` payload the host
 *   passes here as a prop.
 * - Not a wiring change inside webFull `App.tsx` — feature consumers
 *   (e.g. the AI tab transcript view, group-chat transcript view) wire
 *   this in a downstream layer.
 * - Not a lift of `CollapsibleJsonViewer` — the renderer source uses its
 *   own internal `CollapsibleContent` helper that JSON.stringify's the
 *   payload and wraps it in `<pre>`. That helper is kept inline here
 *   verbatim. The L2.5 `CollapsibleJsonViewer` lift is a sibling
 *   primitive with a richer tree-render contract; the two coexist.
 *
 * **lucide-react icons** (`ChevronDown`, `ChevronRight`, `Clock`,
 * `CheckCircle2`, `Loader2`, `AlertCircle`) kept verbatim — already a
 * webFull-tree dep.
 *
 * **Theme access pattern:** kept the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift.
 */

import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, Clock, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';

/**
 * Tool call state from OpenCode/Codex sessions
 */
interface ToolState {
	status?: string;
	input?: unknown;
	output?: unknown;
}

/**
 * Tool use entry from session messages
 * Supports both Claude format (name) and OpenCode format (tool)
 */
interface ToolUseEntry {
	name?: string;
	tool?: string;
	state?: ToolState;
	// Additional fields that might be present
	id?: string;
	type?: string;
}

interface ToolCallCardProps {
	theme: Theme;
	toolUse: ToolUseEntry[];
	timestamp?: string;
	/** Whether the card starts expanded or collapsed */
	defaultExpanded?: boolean;
}

/**
 * Get tool name from tool use entry or array - supports both Claude (name) and OpenCode (tool) formats
 */
export function getToolName(toolUse: ToolUseEntry | ToolUseEntry[] | undefined): string {
	if (!toolUse) return 'unknown';
	const tool = Array.isArray(toolUse) ? toolUse[0] : toolUse;
	return tool?.name || tool?.tool || 'unknown';
}

/**
 * Get status icon based on tool state
 */
function StatusIcon({ status, theme }: { status?: string; theme: Theme }) {
	switch (status) {
		case 'completed':
		case 'success':
			return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: theme.colors.success }} />;
		case 'running':
		case 'pending':
			return (
				<Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: theme.colors.warning }} />
			);
		case 'error':
		case 'failed':
			return <AlertCircle className="w-3.5 h-3.5" style={{ color: theme.colors.error }} />;
		default:
			return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: theme.colors.success }} />;
	}
}

/**
 * Collapsible JSON content section
 */
const CollapsibleContent = memo(function CollapsibleContent({
	label,
	content,
	theme,
	defaultExpanded = false,
	maxCollapsedLines = 5,
}: {
	label: string;
	content: unknown;
	theme: Theme;
	defaultExpanded?: boolean;
	maxCollapsedLines?: number;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	if (content === undefined || content === null) return null;

	const formattedContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

	const lines = formattedContent.split('\n');
	const isLong = lines.length > maxCollapsedLines;
	const displayContent =
		expanded || !isLong ? formattedContent : lines.slice(0, maxCollapsedLines).join('\n') + '\n...';

	return (
		<div className="mt-2">
			<div
				className="flex items-center gap-1 text-xs font-medium mb-1 cursor-pointer select-none"
				style={{ color: theme.colors.textDim }}
				onClick={() => isLong && setExpanded(!expanded)}
			>
				<span>{label}:</span>
				{isLong && (
					<button className="text-xs hover:underline ml-1" style={{ color: theme.colors.accent }}>
						{expanded ? 'Show less' : 'Show more'}
					</button>
				)}
			</div>
			<pre
				className="text-xs font-mono p-2 rounded overflow-x-auto whitespace-pre-wrap break-words"
				style={{
					backgroundColor: theme.colors.bgMain,
					color: theme.colors.textMain,
					maxHeight: expanded ? 'none' : '150px',
				}}
			>
				{displayContent}
			</pre>
		</div>
	);
});

/**
 * ToolCallCard - Displays tool execution details with collapsible sections
 *
 * Features:
 * - Collapsible card (show/hide entire tool details)
 * - Tool name with status indicator
 * - Time and Status fields
 * - Collapsible Input section with JSON formatting
 * - Collapsible Output section with JSON formatting
 * - "Show more" links for long content
 */
export const ToolCallCard = memo(function ToolCallCard({
	theme,
	toolUse,
	timestamp,
	defaultExpanded = false,
}: ToolCallCardProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	if (!toolUse || toolUse.length === 0) return null;

	// Get first tool (usually there's only one per message)
	const tool = toolUse[0];
	const toolName = getToolName(tool);
	const state = tool.state;
	const status = state?.status || 'completed';

	// Collapsed view - just show tool name and "Show more"
	if (!expanded) {
		return (
			<div
				role="button"
				tabIndex={0}
				className="rounded-lg px-4 py-3 text-sm cursor-pointer hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-offset-1"
				style={{
					backgroundColor: theme.colors.bgActivity,
					borderLeft: `3px solid ${theme.colors.warning}`,
				}}
				onClick={() => setExpanded(true)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setExpanded(true);
					}
				}}
			>
				<div className="flex items-center gap-2">
					<ChevronRight className="w-4 h-4 shrink-0" style={{ color: theme.colors.textDim }} />
					<span
						className="px-1.5 py-0.5 rounded text-xs font-medium"
						style={{
							backgroundColor: `${theme.colors.warning}20`,
							color: theme.colors.warning,
						}}
					>
						Tool: {toolName}
					</span>
					<StatusIcon status={status} theme={theme} />
					<button
						className="text-xs hover:underline ml-auto"
						style={{ color: theme.colors.accent }}
					>
						Show more
					</button>
				</div>
			</div>
		);
	}

	// Expanded view - show all details
	return (
		<div
			className="rounded-lg text-sm overflow-hidden"
			style={{
				backgroundColor: theme.colors.bgActivity,
				borderLeft: `3px solid ${theme.colors.warning}`,
			}}
		>
			{/* Header - clickable to collapse */}
			<div
				role="button"
				tabIndex={0}
				className="px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity flex items-center gap-2 outline-none focus:ring-2 focus:ring-inset"
				style={{ backgroundColor: `${theme.colors.warning}08` }}
				onClick={() => setExpanded(false)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						setExpanded(false);
					}
				}}
			>
				<ChevronDown className="w-4 h-4 shrink-0" style={{ color: theme.colors.textDim }} />
				<span
					className="px-1.5 py-0.5 rounded text-xs font-medium"
					style={{
						backgroundColor: `${theme.colors.warning}20`,
						color: theme.colors.warning,
					}}
				>
					Tool: {toolName}
				</span>
				<StatusIcon status={status} theme={theme} />
				<button className="text-xs hover:underline ml-auto" style={{ color: theme.colors.accent }}>
					Collapse
				</button>
			</div>

			{/* Content */}
			<div className="px-4 py-3">
				{/* Input section */}
				{state?.input !== undefined && (
					<CollapsibleContent
						label="Input"
						content={state.input}
						theme={theme}
						defaultExpanded={false}
					/>
				)}

				{/* Status and Time row */}
				<div
					className="flex items-center gap-4 mt-3 text-xs"
					style={{ color: theme.colors.textDim }}
				>
					{timestamp && (
						<div className="flex items-center gap-1">
							<Clock className="w-3 h-3" />
							<span>Time: {timestamp}</span>
						</div>
					)}
					<div className="flex items-center gap-1">
						<StatusIcon status={status} theme={theme} />
						<span>Status: {status}</span>
					</div>
				</div>

				{/* Output section */}
				{state?.output !== undefined && (
					<CollapsibleContent
						label="Output"
						content={state.output}
						theme={theme}
						defaultExpanded={false}
					/>
				)}
			</div>
		</div>
	);
});
