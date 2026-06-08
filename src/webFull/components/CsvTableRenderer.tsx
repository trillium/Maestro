/**
 * CsvTableRenderer — webFull leaf-parade lift
 *
 * Layer 2.5 leaf-parade lift wave. Verbatim port of
 * `src/renderer/components/CsvTableRenderer.tsx` (383 LOC, 0 IPC, 0
 * Electron-only API per pre-flight grep) into `src/webFull/components/`.
 *
 * Pre-flight grep on the renderer source:
 *   grep -nE "window\.maestro\.|window\.electron|ipcRenderer|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|window\.api|require\(" \
 *     src/renderer/components/CsvTableRenderer.tsx
 * returned empty (exit 1). The component touches 0 IPC namespaces and 0
 * Electron-only APIs at module load or runtime — all side effects (sort
 * clicks, match-count reporting) thread out through caller-owned
 * callbacks (`onMatchCount`) or stay in local React state (`sort`).
 *
 * **What it is:** a presentational delimited-content table renderer used
 * by the file-preview surface to render `.csv` / `.tsv` payloads as a
 * sortable, searchable HTML `<table>`. Parses the input string (handles
 * quoted fields and escaped quotes), groups header / data rows, infers
 * per-column alignment from data content (>50% numeric → right-align),
 * filters rows by `searchQuery` (case-insensitive, any-cell match),
 * caps the rendered set at `MAX_DISPLAY_ROWS = 500` with a truncation
 * banner, supports tri-state header-click sort (asc → desc → off), and
 * highlights search matches inside cells with `<mark>` spans. Empty
 * input renders an empty-state placeholder.
 *
 * **Import-path adapts (one, matching the L2.5 cross-fork precedent set
 * by `SessionActivityGraph` / `MergeProgressOverlay` / `ThemePicker`):**
 *
 * 1. `Theme` from `'../types'` → `'../../shared/theme-types'`. Standard
 *    L2.5 swap — the renderer aggregator at `src/renderer/types/index.ts`
 *    re-exports `Theme` from `src/shared/theme-types`, so webFull pulls
 *    direct from the canonical source rather than transit the renderer
 *    barrel.
 *
 * **Theme access pattern:** kept the renderer's `theme: Theme` prop
 * convention, consistent with every L2.x lift. Callers thread `theme`
 * down from `useTheme()`.
 *
 * **Composition shape:** no `Modal` / `ModalFooter` / layer-stack
 * registration — this is an inline content view, NOT a modal. The
 * `searchQuery` is consumer-controlled (the file-preview surface owns
 * the search box) and the `onMatchCount` callback lets the parent
 * surface match counts without re-running the filter logic itself.
 *
 * `lucide-react` icons (`ChevronUp`, `ChevronDown`) kept verbatim —
 * already a webFull-tree dep used by sibling L2.5 lifts.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. 0
 * `src/main/` touches. 0 `src/web/` touches. 0 `src/renderer/` edits.
 */

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';

export interface CsvTableRendererProps {
	content: string;
	theme: Theme;
	delimiter?: string;
	searchQuery?: string;
	onMatchCount?: (count: number) => void;
}

const MAX_DISPLAY_ROWS = 500;

type SortDirection = 'asc' | 'desc';

interface SortState {
	column: number;
	direction: SortDirection;
}

/**
 * Parse delimited content into rows of cells, handling quoted fields.
 * Supports comma (CSV) and tab (TSV) delimiters.
 */
function parseCsv(content: string, delimiter = ','): string[][] {
	const rows: string[][] = [];
	let current = '';
	let inQuotes = false;
	let row: string[] = [];

	for (let i = 0; i < content.length; i++) {
		const ch = content[i];
		const next = content[i + 1];

		if (inQuotes) {
			if (ch === '"' && next === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				current += ch;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
			} else if (ch === delimiter) {
				row.push(current);
				current = '';
			} else if (ch === '\r' && next === '\n') {
				row.push(current);
				current = '';
				rows.push(row);
				row = [];
				i++; // skip \n
			} else if (ch === '\n') {
				row.push(current);
				current = '';
				rows.push(row);
				row = [];
			} else {
				current += ch;
			}
		}
	}

	// Final field/row
	if (current || row.length > 0) {
		row.push(current);
		rows.push(row);
	}

	return rows;
}

/**
 * Detect if a cell value looks numeric (for right-alignment).
 */
function isNumericValue(value: string): boolean {
	const trimmed = value.trim();
	// Match: optional currency/sign prefix, digits with optional commas, optional decimal, optional suffix
	return /^[($\-]*[\d,]+(\.\d+)?[%)]*$/.test(trimmed);
}

/**
 * Determine column alignment based on data content.
 * A column is right-aligned if >50% of non-empty data cells are numeric.
 */
function detectColumnAlignments(dataRows: string[][], columnCount: number): ('left' | 'right')[] {
	const alignments: ('left' | 'right')[] = new Array(columnCount).fill('left');

	for (let col = 0; col < columnCount; col++) {
		let numericCount = 0;
		let nonEmptyCount = 0;

		for (const row of dataRows) {
			const val = row[col]?.trim() ?? '';
			if (val !== '') {
				nonEmptyCount++;
				if (isNumericValue(val)) numericCount++;
			}
		}

		if (nonEmptyCount > 0 && numericCount / nonEmptyCount > 0.5) {
			alignments[col] = 'right';
		}
	}

	return alignments;
}

/**
 * Compare values for sorting, handling numeric vs string.
 */
function compareValues(a: string, b: string, direction: SortDirection): number {
	const aVal = a.trim();
	const bVal = b.trim();

	// Empty values sort last
	if (aVal === '' && bVal === '') return 0;
	if (aVal === '') return 1;
	if (bVal === '') return -1;

	// Try numeric comparison
	const aNum = parseFloat(aVal.replace(/[,$%()]/g, ''));
	const bNum = parseFloat(bVal.replace(/[,$%()]/g, ''));

	if (!isNaN(aNum) && !isNaN(bNum)) {
		return direction === 'asc' ? aNum - bNum : bNum - aNum;
	}

	// Fall back to string comparison
	const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
	return direction === 'asc' ? cmp : -cmp;
}

/**
 * Highlight matching substrings within a cell value.
 */
function highlightMatches(text: string, query: string, accentColor: string): ReactNode {
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escaped})`, 'gi');
	const parts = text.split(regex);
	if (parts.length === 1) return text;
	// Use running character offset as key to guarantee uniqueness across
	// identical substrings appearing at different positions.
	let offset = 0;
	return parts.map((part, index) => {
		const key = `${offset}-${index}`;
		offset += part.length;
		return regex.test(part) ? (
			<mark
				key={key}
				style={{
					backgroundColor: accentColor,
					color: '#fff',
					padding: '0 1px',
					borderRadius: '2px',
				}}
			>
				{part}
			</mark>
		) : (
			<span key={key}>{part}</span>
		);
	});
}

export function CsvTableRenderer({
	content,
	theme,
	delimiter = ',',
	searchQuery,
	onMatchCount,
}: CsvTableRendererProps) {
	const [sort, setSort] = useState<SortState | null>(null);
	const query = (searchQuery?.trim() ?? '').slice(0, 200);

	const allRows = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);

	const headerRow = allRows[0] ?? [];
	const columnCount = useMemo(
		() => allRows.reduce((max, row) => Math.max(max, row.length), 0),
		[allRows]
	);
	const dataRows = useMemo(() => allRows.slice(1), [allRows]);

	// Filter rows by search query (match any cell, case-insensitive)
	const filteredRows = useMemo(() => {
		if (!query) return dataRows;
		const lowerQuery = query.toLowerCase();
		return dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(lowerQuery)));
	}, [dataRows, query]);

	const totalDataRows = dataRows.length;
	const isTruncated = filteredRows.length > MAX_DISPLAY_ROWS;

	const alignments = useMemo(
		() => detectColumnAlignments(dataRows.slice(0, 100), columnCount),
		[dataRows, columnCount]
	);

	const sortedRows = useMemo(() => {
		const rows = isTruncated ? filteredRows.slice(0, MAX_DISPLAY_ROWS) : filteredRows;
		if (!sort) return rows;
		return [...rows].sort((a, b) =>
			compareValues(a[sort.column] ?? '', b[sort.column] ?? '', sort.direction)
		);
	}, [filteredRows, sort, isTruncated]);

	// Report match count back to FilePreview
	useEffect(() => {
		onMatchCount?.(query ? filteredRows.length : 0);
	}, [filteredRows.length, query, onMatchCount]);

	const handleHeaderClick = (colIndex: number) => {
		setSort((prev) => {
			if (prev?.column === colIndex) {
				return prev.direction === 'asc' ? { column: colIndex, direction: 'desc' } : null; // Third click clears sort
			}
			return { column: colIndex, direction: 'asc' };
		});
	};

	if (allRows.length === 0) {
		return (
			<div
				className="flex items-center justify-center h-full text-sm"
				style={{ color: theme.colors.textDim }}
			>
				Empty CSV file
			</div>
		);
	}

	return (
		<div className="csv-table-renderer" style={{ padding: '16px' }}>
			{isTruncated && (
				<div
					className="px-4 py-2 mb-3 flex items-center gap-2 text-sm rounded"
					style={{
						backgroundColor: theme.colors.warning + '20',
						border: `1px solid ${theme.colors.warning}40`,
						color: theme.colors.warning,
					}}
				>
					Showing {MAX_DISPLAY_ROWS.toLocaleString()} of {filteredRows.length.toLocaleString()}
					{query ? ' matching' : ''} rows
				</div>
			)}
			<div
				className="overflow-x-auto rounded"
				style={{ border: `1px solid ${theme.colors.border}` }}
			>
				<table
					className="w-full"
					style={{
						borderCollapse: 'collapse',
						fontSize: '13px',
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
					}}
				>
					<thead>
						<tr>
							{/* Row number column */}
							<th
								style={{
									padding: '8px 12px',
									textAlign: 'right',
									backgroundColor: theme.colors.bgActivity,
									borderBottom: `2px solid ${theme.colors.border}`,
									borderRight: `1px solid ${theme.colors.border}`,
									color: theme.colors.textDim,
									fontWeight: 'normal',
									fontSize: '11px',
									position: 'sticky',
									top: 0,
									userSelect: 'none',
									minWidth: '48px',
								}}
							>
								#
							</th>
							{headerRow.map((header, i) => (
								<th
									key={i}
									onClick={() => handleHeaderClick(i)}
									style={{
										padding: '8px 12px',
										textAlign: alignments[i]!,
										backgroundColor:
											sort?.column === i ? theme.colors.accent + '20' : theme.colors.bgActivity,
										borderBottom: `2px solid ${theme.colors.border}`,
										borderRight:
											i < headerRow.length - 1 ? `1px solid ${theme.colors.border}` : undefined,
										color: theme.colors.textMain,
										fontWeight: 600,
										cursor: 'pointer',
										position: 'sticky',
										top: 0,
										userSelect: 'none',
										whiteSpace: 'nowrap',
									}}
								>
									<span className="inline-flex items-center gap-1">
										{header}
										{sort?.column === i &&
											(sort.direction === 'asc' ? (
												<ChevronUp
													className="w-3 h-3 inline-block"
													style={{ color: theme.colors.accent }}
												/>
											) : (
												<ChevronDown
													className="w-3 h-3 inline-block"
													style={{ color: theme.colors.accent }}
												/>
											))}
									</span>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sortedRows.map((row, rowIdx) => (
							<tr
								key={rowIdx}
								style={{
									backgroundColor:
										rowIdx % 2 === 0 ? 'transparent' : theme.colors.bgActivity + '60',
								}}
								className="hover:brightness-110 transition-[filter] duration-75"
							>
								{/* Row number */}
								<td
									style={{
										padding: '6px 12px',
										textAlign: 'right',
										borderRight: `1px solid ${theme.colors.border}`,
										color: theme.colors.textDim,
										fontSize: '11px',
										userSelect: 'none',
									}}
								>
									{rowIdx + 1}
								</td>
								{Array.from({ length: columnCount }, (_, colIdx) => (
									<td
										key={colIdx}
										style={{
											padding: '6px 12px',
											textAlign: alignments[colIdx]!,
											borderRight:
												colIdx < columnCount - 1 ? `1px solid ${theme.colors.border}` : undefined,
											color: theme.colors.textMain,
											whiteSpace: 'nowrap',
											maxWidth: '400px',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
										}}
										title={row[colIdx] ?? ''}
									>
										{query
											? highlightMatches(row[colIdx] ?? '', query, theme.colors.accent)
											: (row[colIdx] ?? '')}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-2 text-xs" style={{ color: theme.colors.textDim }}>
				{query
					? `${filteredRows.length.toLocaleString()} of ${totalDataRows.toLocaleString()} rows match`
					: `${totalDataRows.toLocaleString()} rows`}{' '}
				× {columnCount} columns
			</div>
		</div>
	);
}
