/**
 * @file textProcessing.ts
 * @description Pure text-processing utilities lifted verbatim from
 * `src/renderer/utils/textProcessing.ts` into the webFull surface.
 *
 * Layer 2.5 leaf-parade lift. The renderer file has zero IPC / `window.maestro`
 * / `electron` touch (verified by pre-flight grep). This module is a verbatim
 * copy of the renderer module — no signature or behavior changes — so consumers
 * in `src/webFull/` no longer need to reach across the fork boundary into
 * `src/renderer/` for these helpers.
 *
 * Lifted surface:
 * - `processCarriageReturns` — terminal `\r` overwrite simulation
 * - `processLogTextHelper` — prompt filtering + carriage-return processing
 * - `filterTextByLinesHelper` — include/exclude line filtering with regex support
 * - `getCachedAnsiHtml` — LRU-cached ANSI → sanitized HTML conversion
 * - `clearAnsiCache` — cache reset for tests / theme changes
 * - `stripMarkdown` — pure markdown → plain-text stripping
 * - `ANSI_CACHE_MAX_SIZE` — cache bound constant
 *
 * Consumers in webFull (today):
 * - `src/webFull/components/GroupChatMessages.tsx` (uses `stripMarkdown`)
 *
 * The renderer copy stays where it is; this is an additive duplicate to
 * neutralize a cross-fork import. The two copies are byte-equivalent for the
 * pure surface — if a behavior change is needed, change both intentionally.
 */

import type Convert from 'ansi-to-html';
import DOMPurify from 'dompurify';

// ============================================================================
// Terminal Text Processing
// ============================================================================

/**
 * Process carriage returns to simulate terminal line overwrites.
 * When a line contains \r, the text after the last \r replaces the entire line.
 * This mimics how terminals handle carriage returns for progress indicators.
 *
 * @param text - Raw text potentially containing carriage returns
 * @returns Processed text with carriage return overwrites applied
 */
export const processCarriageReturns = (text: string): string => {
	const lines = text.split('\n');
	const processedLines = lines.map((line) => {
		if (line.includes('\r')) {
			const segments = line.split('\r');
			for (let i = segments.length - 1; i >= 0; i--) {
				if (segments[i].trim()) {
					return segments[i];
				}
			}
			return '';
		}
		return line;
	});
	return processedLines.join('\n');
};

/**
 * Filter out bash prompt lines and apply carriage return processing.
 * Removes empty lines and standalone bash/zsh prompts from terminal output.
 *
 * @param text - Raw terminal output text
 * @param isTerminal - Whether this is terminal mode (vs AI mode)
 * @returns Processed text with prompts filtered out
 */
export const processLogTextHelper = (text: string, isTerminal: boolean): string => {
	const processed = processCarriageReturns(text);
	if (!isTerminal) return processed;

	const lines = processed.split('\n');
	const filteredLines = lines.filter((line) => {
		const trimmed = line.trim();
		if (!trimmed) return false;
		if (/^(bash-\d+\.\d+\$|zsh[%#]|\$|#)\s*$/.test(trimmed)) return false;
		return true;
	});

	return filteredLines.join('\n');
};

/**
 * Filter text by lines containing (or not containing) a query string.
 * Supports both plain text matching and regex patterns.
 *
 * @param text - Text to filter
 * @param query - Search query (plain text or regex pattern)
 * @param mode - 'include' to keep matching lines, 'exclude' to remove them
 * @param useRegex - Whether to treat query as a regex pattern
 * @returns Filtered text with only matching/non-matching lines
 */
export const filterTextByLinesHelper = (
	text: string,
	query: string,
	mode: 'include' | 'exclude',
	useRegex: boolean
): string => {
	if (!query) return text;

	const lines = text.split('\n');

	try {
		if (useRegex) {
			const regex = new RegExp(query, 'i');
			const filteredLines = lines.filter((line) => {
				const matches = regex.test(line);
				return mode === 'include' ? matches : !matches;
			});
			return filteredLines.join('\n');
		} else {
			const lowerQuery = query.toLowerCase();
			const filteredLines = lines.filter((line) => {
				const matches = line.toLowerCase().includes(lowerQuery);
				return mode === 'include' ? matches : !matches;
			});
			return filteredLines.join('\n');
		}
	} catch {
		// Fall back to plain text search if regex is invalid
		const lowerQuery = query.toLowerCase();
		const filteredLines = lines.filter((line) => {
			const matches = line.toLowerCase().includes(lowerQuery);
			return mode === 'include' ? matches : !matches;
		});
		return filteredLines.join('\n');
	}
};

// ============================================================================
// ANSI Conversion Cache
// ============================================================================

/**
 * Maximum number of entries in the ANSI to HTML conversion cache.
 * Uses LRU-style eviction when full.
 */
export const ANSI_CACHE_MAX_SIZE = 500;

/**
 * LRU-style cache for ANSI to HTML conversions.
 * Cache key is hash of (text content + theme ID), value is sanitized HTML.
 * This avoids re-converting the same text on every render.
 */
const ansiCache = new Map<string, string>();

/**
 * Get cached ANSI-to-HTML conversion or compute and cache it.
 * Uses a simple hash key based on text content and theme for lookup.
 * For long texts, uses a substring-based key for performance.
 *
 * @param text - Raw text with ANSI codes
 * @param themeId - Theme identifier (ANSI colors depend on theme)
 * @param converter - The ANSI converter instance
 * @returns Sanitized HTML string
 */
export function getCachedAnsiHtml(text: string, themeId: string, converter: Convert): string {
	// Create a simple hash key from text and theme
	// For performance, use a substring-based key for long texts
	const textKey =
		text.length > 200 ? `${text.slice(0, 100)}|${text.length}|${text.slice(-100)}` : text;
	const cacheKey = `${themeId}:${textKey}`;

	const cached = ansiCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	// Convert and sanitize
	const html = DOMPurify.sanitize(converter.toHtml(text));

	// LRU eviction: remove oldest entries if cache is full
	if (ansiCache.size >= ANSI_CACHE_MAX_SIZE) {
		const firstKey = ansiCache.keys().next().value;
		ansiCache.delete(firstKey!);
	}

	ansiCache.set(cacheKey, html);
	return html;
}

/**
 * Clear the ANSI cache. Useful for testing or when theme changes significantly.
 */
export function clearAnsiCache(): void {
	ansiCache.clear();
}

// ============================================================================
// Markdown Processing
// ============================================================================

/**
 * Strip markdown formatting to show plain text.
 * Removes code blocks, inline code, bold/italic, headers, blockquotes,
 * horizontal rules, links, images, strikethrough, and normalizes lists.
 *
 * @param text - Markdown-formatted text
 * @returns Plain text with markdown formatting removed
 */
export const stripMarkdown = (text: string): string => {
	return (
		text
			// Remove code blocks (```...```)
			.replace(/```[\s\S]*?```/g, (match) => {
				// Extract just the code content without the fence
				const lines = match.split('\n');
				// Remove first line (```lang) and last line (```)
				return lines.slice(1, -1).join('\n');
			})
			// Remove inline code backticks
			.replace(/`([^`]+)`/g, '$1')
			// Remove bold/italic (***text***, **text**, *text*, ___text___, __text__, _text_)
			.replace(/\*\*\*(.+?)\*\*\*/g, '$1')
			.replace(/\*\*(.+?)\*\*/g, '$1')
			.replace(/\*(.+?)\*/g, '$1')
			.replace(/___(.+?)___/g, '$1')
			.replace(/__(.+?)__/g, '$1')
			.replace(/_(.+?)_/g, '$1')
			// Remove headers (# text)
			.replace(/^#{1,6}\s+/gm, '')
			// Remove blockquotes (> text)
			.replace(/^>\s*/gm, '')
			// Remove horizontal rules
			.replace(/^[-*_]{3,}\s*$/gm, '---')
			// Remove link formatting [text](url) -> text
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			// Remove image formatting ![alt](url) -> alt
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
			// Remove strikethrough
			.replace(/~~(.+?)~~/g, '$1')
			// Clean up bullet points - convert to simple dashes
			.replace(/^[\s]*[-*+]\s+/gm, '- ')
			// Clean up numbered lists - keep the numbers
			.replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
	);
};
