import GithubSlugger from 'github-slugger';
import type { TocEntry } from './types';
import { formatSize } from '../../../shared/formatters';

// ─── Image Cache ──────────────────────────────────────────────────────────────

/** Global cache for loaded images to prevent re-fetching and flickering */
export const imageCache = new Map<
	string,
	{ dataUrl: string; width?: number; height?: number; loadedAt: number }
>();

/** Cache entries older than this are evicted (10 minutes) */
export const IMAGE_CACHE_TTL = 10 * 60 * 1000;

// Clean up old cache entries periodically
setInterval(() => {
	const now = Date.now();
	for (const [key, value] of imageCache.entries()) {
		if (now - value.loadedAt > IMAGE_CACHE_TTL) {
			imageCache.delete(key);
		}
	}
}, IMAGE_CACHE_TTL);

// ─── Large File Thresholds ────────────────────────────────────────────────────

/** Files larger than this will skip token counting (expensive operation) */
export const LARGE_FILE_TOKEN_SKIP_THRESHOLD = 1024 * 1024; // 1MB

/** Files larger than this will have content truncated for syntax highlighting */
export const LARGE_FILE_PREVIEW_LIMIT = 100 * 1024; // 100KB

// ─── Preview Tier Thresholds (markdown perf) ──────────────────────────────────
//
// Three-tier preview strategy for markdown / text / code:
//   - Rich  : current react-markdown pipeline; full feature parity. Default for small files.
//   - Fast  : markdown-it + DOMPurify + react-virtuoso block virtualization. Dynamically imported.
//   - Giant : CodeMirror 6 read-only viewer for multi-MB / multi-million-line files. Phase 4.
//
// The Fast tier handles the user-reported 300k-line markdown case. Tier picked once
// per file open (memoized on path); a header chip lets users escalate/de-escalate.

/** Bytes above this route to Fast tier instead of Rich. */
export const FAST_TIER_BYTES = 256 * 1024; // 256KB

/** Lines above this route to Fast tier instead of Rich (catches dense narrow content). */
export const FAST_TIER_LINES = 5_000;

/**
 * Bytes above this route to Giant tier (CodeMirror 6) instead of Fast.
 *
 * Bumped from the original plan's 4 MB to 8 MB so the Fast tier still owns
 * the common "huge markdown" case (e.g. the user-reported 300k-line / ~15 MB
 * file would otherwise lose rendered tables to CM6's source view). Giant
 * kicks in only when markdown-it parse becomes the dominant latency — past
 * ~8 MB, parse routinely exceeds 2 s on a modern Mac.
 */
export const GIANT_TIER_BYTES = 8 * 1024 * 1024; // 8MB

/** Lines above this route to Giant tier. */
export const GIANT_TIER_LINES = 500_000;

export type PreviewTier = 'rich' | 'fast' | 'giant';

/**
 * Pick a preview tier based on file size. Pass `bytes` from the file's content
 * length and `lines` from a single newline scan. Both are evaluated; the larger
 * tier wins so a long thin file (millions of one-char lines) still escalates.
 *
 * Tier landings:
 *   - Phase 1: Fast tier (markdown).
 *   - Phase 3: Fast tier (plain text + code).
 *   - Phase 4: Giant tier (CodeMirror 6) for files over GIANT_TIER_BYTES /
 *     GIANT_TIER_LINES — used for markdown, text, and code alike.
 */
export function pickPreviewTier(bytes: number, lines: number): PreviewTier {
	if (bytes > GIANT_TIER_BYTES || lines > GIANT_TIER_LINES) {
		return 'giant';
	}
	if (bytes > FAST_TIER_BYTES || lines > FAST_TIER_LINES) {
		return 'fast';
	}
	return 'rich';
}

/** Count newlines without splitting the whole string (cheap O(n) scan). */
export function countLines(content: string): number {
	if (!content) return 0;
	let count = 1;
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10) count++;
	}
	return count;
}

// ─── Language Detection ───────────────────────────────────────────────────────

/** Map filename extension to syntax highlighting language code */
/** Extension → syntax highlighting language (module-scope for reuse) */
const LANGUAGE_MAP: Record<string, string> = {
	ts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	jsx: 'jsx',
	json: 'json',
	md: 'markdown',
	mdx: 'markdown',
	py: 'python',
	rb: 'ruby',
	go: 'go',
	rs: 'rust',
	java: 'java',
	c: 'c',
	cpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	html: 'html',
	css: 'css',
	scss: 'scss',
	sql: 'sql',
	sh: 'bash',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	xml: 'xml',
	csv: 'csv',
	tsv: 'csv',
	jsonl: 'jsonl',
	ndjson: 'jsonl',
};

/** Map filename extension to syntax highlighting language code */
export const getLanguageFromFilename = (filename: string): string => {
	const ext = filename.split('.').pop()?.toLowerCase();
	return LANGUAGE_MAP[ext || ''] || 'text';
};

/**
 * Whether a language identifier represents code (vs plain prose).
 *
 * Used by FilePreview chip-visibility rules and tier-routing decisions to
 * tell apart `.ts` / `.py` / `.css` files (Shiki-eligible code) from `.txt`
 * / `.log` / `README` (plain prose).
 *
 * `'markdown'` is intentionally NOT considered code — markdown has its own
 * Fast-tier renderer.
 */
export const isCodeFile = (language: string): boolean => {
	return language !== 'text' && language !== 'markdown';
};

// ─── Readable Text Detection ──────────────────────────────────────────────────

/** Plain prose extensions that should be rendered as readable text (supporting Bionify). */
export const READABLE_TEXT_EXTENSIONS = new Set(['txt', 'text', 'rst', 'adoc', 'asc']);

/** Basenames (no extension) typically treated as readable prose. */
export const READABLE_TEXT_BASENAMES = new Set([
	'readme',
	'changelog',
	'contributing',
	'license',
	'copying',
	'authors',
	'notice',
	'todo',
]);

/**
 * Whether a filename should render in the readable-text preview branch
 * (plain prose that benefits from Bionify). Files with an extension are
 * matched against the readable-text extension set first; only extensionless
 * files fall back to the basename set (so `README.ts` is NOT readable text).
 */
export function isReadableTextPreview(filename: string): boolean {
	const lowerFilename = filename.toLowerCase();
	const dotIndex = lowerFilename.lastIndexOf('.');

	if (dotIndex !== -1) {
		const ext = lowerFilename.slice(dotIndex + 1);
		return READABLE_TEXT_EXTENSIONS.has(ext);
	}

	return READABLE_TEXT_BASENAMES.has(lowerFilename);
}

// ─── Binary Detection ─────────────────────────────────────────────────────────

/** Check if content appears to be binary (null bytes or high non-printable ratio) */
export const isBinaryContent = (content: string): boolean => {
	if (content.includes('\0')) return true;

	const sample = content.slice(0, 8192);
	if (sample.length === 0) return false;

	let nonPrintableCount = 0;
	for (let i = 0; i < sample.length; i++) {
		const code = sample.charCodeAt(i);
		if (code < 9 || (code > 13 && code < 32) || (code >= 127 && code < 160)) {
			nonPrintableCount++;
		}
	}

	return nonPrintableCount / sample.length > 0.1;
};

/** Known binary file extensions (module-scope Set for O(1) lookup) */
const BINARY_EXTENSIONS = new Set([
	// macOS/iOS specific
	'icns',
	'car',
	'actool',
	// Design files
	'psd',
	'ai',
	'sketch',
	'fig',
	'xd',
	// Compiled/object files
	'o',
	'a',
	'so',
	'dylib',
	'dll',
	'class',
	'pyc',
	'pyo',
	'wasm',
	// Database files
	'db',
	'sqlite',
	'sqlite3',
	// Fonts
	'ttf',
	'otf',
	'woff',
	'woff2',
	'eot',
	// Archives
	'zip',
	'tar',
	'gz',
	'7z',
	'rar',
	'bz2',
	'xz',
	'tgz',
	// Other binary
	'exe',
	'bin',
	'dat',
	'pak',
]);

/** Check if file extension indicates a known binary format */
export const isBinaryExtension = (filename: string): boolean => {
	const ext = filename.split('.').pop()?.toLowerCase();
	return BINARY_EXTENSIONS.has(ext || '');
};

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Format file size in human-readable format */
export const formatFileSize = (bytes: number): string => {
	if (bytes <= 0) return '0 B';
	return formatSize(bytes);
};

/** Format ISO date/time for display */
export const formatDateTime = (isoString: string): string => {
	const date = new Date(isoString);
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
};

// ─── Markdown Helpers ─────────────────────────────────────────────────────────

/** Count markdown task checkboxes (- [ ] and - [x]), skipping code fences */
export const countMarkdownTasks = (content: string): { open: number; closed: number } => {
	const lines = content.split('\n');
	let inCodeFence = false;
	let open = 0;
	let closed = 0;

	for (const line of lines) {
		if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
			inCodeFence = !inCodeFence;
			continue;
		}
		if (inCodeFence) continue;

		if (/^[\s]*[-*]\s*\[\s*\]/.test(line)) open++;
		if (/^[\s]*[-*]\s*\[[xX]\]/.test(line)) closed++;
	}

	return { open, closed };
};

/** Extract headings from markdown content for table of contents */
export const extractHeadings = (content: string): TocEntry[] => {
	const headings: TocEntry[] = [];
	const lines = content.split('\n');
	let inCodeFence = false;
	const slugger = new GithubSlugger();

	for (const line of lines) {
		if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
			inCodeFence = !inCodeFence;
			continue;
		}
		if (inCodeFence) continue;

		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			const level = match[1].length;
			const text = match[2].trim();
			const slug = slugger.slug(text);
			headings.push({ level, text, slug });
		}
	}

	return headings;
};

/**
 * Normalize a POSIX-style path by resolving `.` and `..` segments.
 * Does not use Node's path module (runs in renderer).
 */
function normalizePosixPath(p: string): string {
	const parts = p.split('/');
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === '.' || part === '') continue;
		if (part === '..') {
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	return (p.startsWith('/') ? '/' : '') + resolved.join('/');
}

/** Resolve image path relative to markdown file directory */
export const resolveImagePath = (src: string, markdownFilePath: string): string => {
	if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
		return src;
	}

	if (src.startsWith('/')) {
		return src;
	}

	const markdownDir = markdownFilePath.substring(0, markdownFilePath.lastIndexOf('/'));
	if (!markdownDir) return normalizePosixPath(src);
	return normalizePosixPath(`${markdownDir}/${src}`);
};
