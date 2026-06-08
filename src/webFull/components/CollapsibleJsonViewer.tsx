/**
 * CollapsibleJsonViewer
 *
 * Lifted from `src/renderer/components/CollapsibleJsonViewer.tsx` as part of
 * the Layer 2.5 leaf-parade wave. 303 LOC, 0 IPC namespaces touched, 0
 * Electron-only APIs touched. Pre-flight grep against
 * `window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer`
 * against the renderer source returned empty (exit 1) — confirms classification.
 *
 * Cross-fork neutralization rationale:
 *
 *   The just-merged `leaf-agent-error` wave (commit `dc436bffe` — chain-merge
 *   #7) placed `AgentErrorModal` into `src/webFull/components/` but left it
 *   reaching back into the renderer for this viewer via
 *   `import { CollapsibleJsonViewer } from '../../renderer/components/CollapsibleJsonViewer';`.
 *   That cross-fork import was documented at the time (see
 *   `src/webFull/components/AgentErrorModal.tsx` header) as an audit risk A
 *   silent-drift surface — the renderer tree is the upstream-mirror in this
 *   fork, so every webFull→renderer reach is a future rebase conflict. This
 *   lift moves the leaf into webFull so the cross-fork edge can be cut.
 *   `AgentErrorModal` retargeting onto this webFull copy is the follow-up
 *   cleanup wave — out of scope for this brief, but the pre-condition is now
 *   in place.
 *
 * Lift policy: verbatim copy with the standard L2.5 import-path adjustments:
 *
 *   - `Theme` previously resolved through the renderer's
 *     `src/renderer/types/index.ts` aggregator (which re-exports the shape
 *     that lives in `src/shared/theme-types`). webFull has no `types/`
 *     aggregator — `Theme` is pulled directly from `src/shared/theme-types`
 *     (matches the L2.1 / L2.3 / L2.4 / L2.5 sibling precedent — most recently
 *     `AgentErrorModal`, `ContextWarningSash`, `ToggleButtonGroup`).
 *
 *   - `safeClipboardWrite` previously resolved through
 *     `src/renderer/utils/clipboard.ts`. That module is a pure browser-API
 *     wrapper around `navigator.clipboard.writeText`; the Electron-only
 *     surface (`window.maestro.shell.copyImageToClipboard`) is exclusively
 *     inside `safeClipboardWriteImage`, a SIBLING function this component
 *     does NOT call. The viewer only imports `safeClipboardWrite`. Per the
 *     L2.5 precedent of importing pure leaves by relative path rather than
 *     duplicating into `src/webFull/utils/` (audit risk A: silent-drift
 *     avoidance — duplicating a tiny browser-safe utility creates a
 *     drift surface, where touching one copy and missing the other becomes
 *     a latent bug source), the import is rewritten as
 *     `../../renderer/utils/clipboard`. The renderer→webFull reach is the
 *     direction the L2.5 precedent allows (per the same audit as
 *     `AgentErrorModal`'s prior transitive-dep handling); it is the
 *     webFull→renderer reach that this lift is closing.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 / L2.3 / L2.4 / L2.5 sibling lifts. Callers in
 * webFull call `const { theme } = useTheme()` at the feature-component level
 * and thread it down.
 *
 * Composition shape: presentational JSON tree — pure render component with
 * internal `useState`-driven expand/collapse + clipboard-copy affordance per
 * node. No `Modal` / `ModalFooter` / layer-stack registration (this is not a
 * modal). No `lucide-react` surface beyond `ChevronRight`, `ChevronDown`,
 * `Copy`, `Check` — already a webFull-tree dep used by Settings /
 * ConfirmModal / L2.1 Modal.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

/**
 * CollapsibleJsonViewer - A beautiful collapsible JSON tree viewer
 *
 * Features:
 * - Expandable/collapsible nodes for objects and arrays
 * - Syntax highlighting for different value types
 * - Copy-to-clipboard for values
 * - Theme-aware styling
 */

import React, { useState, useCallback, memo } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { safeClipboardWrite } from '../../renderer/utils/clipboard';

interface CollapsibleJsonViewerProps {
	data: unknown;
	theme: Theme;
	/** Initial expansion level (default: 2) */
	initialExpandLevel?: number;
	/** Maximum string length before truncation (default: 100) */
	maxStringLength?: number;
	/** Root label (optional) */
	rootLabel?: string;
}

interface JsonNodeProps {
	keyName: string | null;
	value: unknown;
	theme: Theme;
	depth: number;
	initialExpandLevel: number;
	maxStringLength: number;
	isLast: boolean;
}

/**
 * Get the type color for a JSON value
 */
function getValueColor(value: unknown, theme: Theme): string {
	if (value === null) return theme.colors.warning;
	if (value === undefined) return theme.colors.textDim;
	switch (typeof value) {
		case 'string':
			return theme.colors.success;
		case 'number':
			return theme.colors.accent;
		case 'boolean':
			return theme.colors.warning;
		default:
			return theme.colors.textMain;
	}
}

/**
 * Format a value for display
 */
function formatValue(value: unknown, maxLength: number): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';

	switch (typeof value) {
		case 'string': {
			const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			if (escaped.length > maxLength) {
				return `"${escaped.substring(0, maxLength)}..."`;
			}
			return `"${escaped}"`;
		}
		case 'number':
		case 'boolean':
			return String(value);
		default:
			return String(value);
	}
}

/**
 * Check if a value is expandable (object or array)
 */
function isExpandable(value: unknown): value is object {
	return value !== null && typeof value === 'object';
}

/**
 * Get preview text for collapsed objects/arrays
 */
function getPreview(value: object): string {
	if (Array.isArray(value)) {
		return `Array(${value.length})`;
	}
	const keys = Object.keys(value);
	if (keys.length <= 3) {
		return `{ ${keys.join(', ')} }`;
	}
	return `{ ${keys.slice(0, 3).join(', ')}, ... }`;
}

/**
 * Copy button component with feedback
 */
const CopyButton = memo(({ value, theme }: { value: unknown; theme: Theme }) => {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
			const ok = await safeClipboardWrite(text);
			if (ok) {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}
		},
		[value]
	);

	return (
		<button
			onClick={handleCopy}
			className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity"
			style={{ color: theme.colors.textDim }}
			title="Copy value"
		>
			{copied ? (
				<Check className="w-3 h-3" style={{ color: theme.colors.success }} />
			) : (
				<Copy className="w-3 h-3" />
			)}
		</button>
	);
});

CopyButton.displayName = 'CopyButton';

/**
 * Individual JSON node component
 */
const JsonNode = memo(
	({
		keyName,
		value,
		theme,
		depth,
		initialExpandLevel,
		maxStringLength,
		isLast,
	}: JsonNodeProps) => {
		const [isExpanded, setIsExpanded] = useState(depth < initialExpandLevel);
		const expandable = isExpandable(value);
		const indent = depth * 16;

		const toggleExpand = useCallback(() => {
			setIsExpanded((prev) => !prev);
		}, []);

		// Render primitive value
		if (!expandable) {
			return (
				<div className="group flex items-center py-0.5" style={{ paddingLeft: indent }}>
					{keyName !== null && (
						<>
							<span style={{ color: theme.colors.accent }}>{`"${keyName}"`}</span>
							<span style={{ color: theme.colors.textDim }}>: </span>
						</>
					)}
					<span style={{ color: getValueColor(value, theme) }}>
						{formatValue(value, maxStringLength)}
					</span>
					{!isLast && <span style={{ color: theme.colors.textDim }}>,</span>}
					<CopyButton value={value} theme={theme} />
				</div>
			);
		}

		// Render expandable value (object or array)
		const isArray = Array.isArray(value);
		const entries = isArray
			? (value as unknown[]).map((v, i) => [String(i), v] as const)
			: Object.entries(value as Record<string, unknown>);
		const isEmpty = entries.length === 0;

		return (
			<div>
				{/* Header row with expand toggle */}
				<div
					className="group flex items-center py-0.5 cursor-pointer hover:bg-white/5 rounded"
					style={{ paddingLeft: indent }}
					onClick={toggleExpand}
				>
					{/* Expand/collapse icon */}
					<span
						className="w-4 h-4 flex items-center justify-center mr-1"
						style={{ color: theme.colors.textDim }}
					>
						{!isEmpty &&
							(isExpanded ? (
								<ChevronDown className="w-3 h-3" />
							) : (
								<ChevronRight className="w-3 h-3" />
							))}
					</span>

					{/* Key name */}
					{keyName !== null && (
						<>
							<span style={{ color: theme.colors.accent }}>{`"${keyName}"`}</span>
							<span style={{ color: theme.colors.textDim }}>: </span>
						</>
					)}

					{/* Opening bracket */}
					<span style={{ color: theme.colors.textMain }}>{isArray ? '[' : '{'}</span>

					{/* Preview or closing bracket for empty/collapsed */}
					{!isExpanded && (
						<>
							{!isEmpty && (
								<span className="mx-1 text-xs" style={{ color: theme.colors.textDim }}>
									{getPreview(value)}
								</span>
							)}
							<span style={{ color: theme.colors.textMain }}>{isArray ? ']' : '}'}</span>
							{!isLast && <span style={{ color: theme.colors.textDim }}>,</span>}
						</>
					)}

					<CopyButton value={value} theme={theme} />
				</div>

				{/* Children (when expanded) */}
				{isExpanded && !isEmpty && (
					<>
						{entries.map(([key, val], idx) => (
							<JsonNode
								key={key}
								keyName={isArray ? null : key}
								value={val}
								theme={theme}
								depth={depth + 1}
								initialExpandLevel={initialExpandLevel}
								maxStringLength={maxStringLength}
								isLast={idx === entries.length - 1}
							/>
						))}
						{/* Closing bracket */}
						<div style={{ paddingLeft: indent }}>
							<span style={{ color: theme.colors.textMain }}>{isArray ? ']' : '}'}</span>
							{!isLast && <span style={{ color: theme.colors.textDim }}>,</span>}
						</div>
					</>
				)}

				{/* Closing bracket for expanded empty */}
				{isExpanded && isEmpty && (
					<div style={{ paddingLeft: indent }}>
						<span style={{ color: theme.colors.textMain }}>{isArray ? ']' : '}'}</span>
						{!isLast && <span style={{ color: theme.colors.textDim }}>,</span>}
					</div>
				)}
			</div>
		);
	}
);

JsonNode.displayName = 'JsonNode';

/**
 * Main CollapsibleJsonViewer component
 */
export const CollapsibleJsonViewer = memo(
	({
		data,
		theme,
		initialExpandLevel = 2,
		maxStringLength = 100,
		rootLabel,
	}: CollapsibleJsonViewerProps) => {
		return (
			<div
				className="font-mono text-xs p-3 rounded-lg overflow-x-auto scrollbar-thin"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<JsonNode
					keyName={rootLabel || null}
					value={data}
					theme={theme}
					depth={0}
					initialExpandLevel={initialExpandLevel}
					maxStringLength={maxStringLength}
					isLast={true}
				/>
			</div>
		);
	}
);

CollapsibleJsonViewer.displayName = 'CollapsibleJsonViewer';

export default CollapsibleJsonViewer;
