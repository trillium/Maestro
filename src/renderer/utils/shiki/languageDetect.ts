/**
 * Lazy `highlight.js`-based language auto-detection. Only used when a code
 * fence arrives without an explicit language tag — Shiki has no built-in
 * guesser, and `highlight.js`'s `highlightAuto` is the industry standard.
 *
 * Cost: `highlight.js` is ~40 KB gzipped. We pay it once, on first detection,
 * via a dynamic import so the cost stays out of the main bundle.
 */

import { captureException } from '../sentry';
import { resolveLanguage } from './highlighterManager';

type HljsModule = typeof import('highlight.js');
type Hljs = HljsModule['default'];

let hljsPromise: Promise<Hljs> | null = null;

function loadHljs(): Promise<Hljs> {
	if (hljsPromise) return hljsPromise;
	hljsPromise = (async () => {
		const mod = await import('highlight.js');
		return mod.default;
	})();
	return hljsPromise;
}

/**
 * Guess a Shiki-compatible language id for `code`. Returns null if the
 * heuristic isn't confident enough, or if hljs's pick doesn't map to a
 * grammar Shiki ships.
 *
 * The `relevance` field from hljs is a rough confidence signal — anything
 * under 5 tends to be noise on small snippets. We pass that threshold up so
 * callers can decide whether to render plain or highlight on a weak guess.
 */
export interface DetectionResult {
	/** Canonical Shiki language id, e.g. `'typescript'`. */
	language: string;
	/** hljs relevance score; higher = more confident. */
	relevance: number;
}

const MIN_RELEVANCE = 5;

export async function detectLanguage(code: string): Promise<DetectionResult | null> {
	const trimmed = code.trim();
	if (trimmed.length < 8) return null;
	try {
		const hljs = await loadHljs();
		const result = hljs.highlightAuto(trimmed);
		if (!result.language || result.relevance < MIN_RELEVANCE) return null;
		const shikiLang = await resolveLanguage(result.language);
		if (!shikiLang) return null;
		return { language: shikiLang, relevance: result.relevance };
	} catch (err) {
		captureException(err, { extra: { component: 'shikiLanguageDetect' } });
		return null;
	}
}

/** Test-only reset for the hljs module promise cache. */
export function __resetForTests(): void {
	hljsPromise = null;
}
