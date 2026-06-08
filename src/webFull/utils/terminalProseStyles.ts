/**
 * @file terminalProseStyles.ts
 * @description SURGICAL EXTRACT of `generateTerminalProseStyles` from
 * `src/renderer/utils/markdownConfig.ts` (and the one pure helper it needs,
 * `getBionifyReadingModeStyles` from `src/renderer/utils/bionifyReadingMode.tsx`).
 *
 * ## Why this is an extract, not a full lift
 *
 * `markdownConfig.ts` is a 925-line module that exports many functions:
 * `generateProseStyles`, `createMarkdownComponents` family,
 * `generateAutoRunProseStyles`, `generateDiffViewStyles`, etc. Most of them
 * pull in `react-markdown`, `react-syntax-highlighter`, the renderer-side
 * `BionifyText` React component, theme registries, and other surface that
 * either depends on Electron-only paths or is far heavier than webFull needs.
 *
 * webFull's `GroupChatMessages.tsx` only consumes one symbol from that file:
 * `generateTerminalProseStyles(theme, scopeSelector) -> string`. The function
 * itself is pure: it reads `theme.colors` and returns a CSS string. Its only
 * external collaborator is `getBionifyReadingModeStyles`, which is also a
 * pure CSS-string generator (the rest of `bionifyReadingMode.tsx` is React
 * components for actual bionify rendering — not needed for the CSS).
 *
 * So this file lifts:
 *   1. A constants block matching the renderer module's defaults.
 *   2. `resolveBionifyRestOpacity` — pure helper.
 *   3. `getBionifyReadingModeStylesCss` — pure CSS generator, byte-equivalent
 *      to the renderer's `getBionifyReadingModeStyles` for the `(scopeSelector,
 *      theme)` call shape used by `generateTerminalProseStyles`.
 *   4. `generateTerminalProseStyles` — verbatim CSS template from the renderer
 *      source.
 *
 * NOT lifted:
 *   - The React-side `BionifyText` / `BionifyTextBlock` components.
 *   - The style-injection side-effect (`ensureBionifyStylesInjected`).
 *   - Algorithm-parsing for runtime config.
 *   - Any of the other `generate*ProseStyles` functions.
 *
 * If a future webFull port needs more of the markdown config surface, the
 * right move is a second extract — not a full module lift — so the
 * Electron-only deps don't leak.
 *
 * ## Parity guarantee
 *
 * The CSS string this file emits MUST match the renderer's output byte-for-byte
 * for the same `(theme, scopeSelector)` inputs. If you change one side, change
 * the other intentionally. The test file covers shape and key properties; a
 * full visual parity check would be a parity catalog at the component level.
 */

import type { Theme } from '../../shared/theme-types';

// ============================================================================
// Constants (mirrored from renderer/utils/bionifyReadingMode.tsx)
// ============================================================================

const DEFAULT_BIONIFY_REST_OPACITY = 0.65;
const DEFAULT_BIONIFY_INTENSITY = 1;

// ============================================================================
// Pure helpers (mirrored from renderer/utils/bionifyReadingMode.tsx)
// ============================================================================

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

function resolveBionifyRestOpacity(intensity: number, theme?: Theme): number {
	const baseOpacity = theme?.mode === 'light' ? 0.73 : DEFAULT_BIONIFY_REST_OPACITY;
	return Number(clamp(baseOpacity - (intensity - 1), 0.2, 0.9).toFixed(2));
}

/**
 * Byte-equivalent of the renderer-side `getBionifyReadingModeStyles(scopeSelector, theme)`
 * for the `(scopeSelector, theme)` call shape used by `generateTerminalProseStyles`.
 *
 * The renderer module also accepts a default scopeSelector argument
 * (`.bionify-text-block`); we keep this signature explicit here because the
 * only webFull caller always supplies a scope.
 */
function getBionifyReadingModeStylesCss(scopeSelector: string, theme?: Theme): string {
	const fallbackRestOpacity = theme
		? resolveBionifyRestOpacity(DEFAULT_BIONIFY_INTENSITY, theme)
		: DEFAULT_BIONIFY_REST_OPACITY;

	return `
			${scopeSelector} .bionify-word { display: inline; color: inherit; }
			${scopeSelector} .bionify-word-emphasis {
				font-weight: var(--bionify-emphasis-weight, 700) !important;
				color: inherit !important;
			}
			${scopeSelector} .bionify-word-rest {
				font-weight: 400 !important;
				color: inherit !important;
				opacity: var(--bionify-rest-opacity, ${fallbackRestOpacity}) !important;
			}
		`;
}

// ============================================================================
// Public surface
// ============================================================================

/**
 * Generates prose styles for terminal output and group chat messages.
 * Features: colored headings (accent/success/warning), compact spacing,
 * bgSidebar for code backgrounds, and extra list item styling.
 *
 * Lifted verbatim from `src/renderer/utils/markdownConfig.ts` line 833+.
 *
 * @param theme Theme object whose colors drive the CSS variables.
 * @param scopeSelector CSS selector to scope styles (e.g. `.terminal-output` or `.group-chat-messages`).
 */
export function generateTerminalProseStyles(theme: Theme, scopeSelector: string): string {
	const c = theme.colors;
	const s = `${scopeSelector} .prose`;

	return `
    ${s} { line-height: 1.4; overflow: visible; }
    ${s} > *:first-child { margin-top: 0 !important; }
    ${s} > *:last-child { margin-bottom: 0 !important; }
    ${s} * { margin-top: 0; margin-bottom: 0; }
    ${s} h1 { color: ${c.accent}; font-size: 2em; font-weight: bold; margin: 0.25em 0 !important; line-height: 1.4; }
    ${s} h2 { color: ${c.success}; font-size: 1.75em; font-weight: bold; margin: 0.25em 0 !important; line-height: 1.4; }
    ${s} h3 { color: ${c.warning}; font-size: 1.5em; font-weight: bold; margin: 0.25em 0 !important; line-height: 1.4; }
    ${s} h4 { color: ${c.textMain}; font-size: 1.35em; font-weight: bold; margin: 0.2em 0 !important; line-height: 1.4; }
    ${s} h5 { color: ${c.textMain}; font-size: 1.2em; font-weight: bold; margin: 0.2em 0 !important; line-height: 1.4; }
    ${s} h6 { color: ${c.textDim}; font-size: 1.1em; font-weight: bold; margin: 0.2em 0 !important; line-height: 1.4; }
    ${s} p { color: ${c.textMain}; margin: 0 !important; line-height: 1.4; }
    ${s} p + p { margin-top: 0.5em !important; }
    ${s} p:empty { display: none; }
    ${s} > ul, ${s} > ol { color: ${c.textMain}; margin: 0.25em 0 !important; padding-left: 2em; list-style-position: outside; }
    ${s} li ul, ${s} li ol { margin: 0 !important; padding-left: 1.5em; list-style-position: outside; }
    ${s} li { margin: 0 !important; padding: 0; line-height: 1.4; display: list-item; }
    ${s} li > p:first-child { margin: 0 !important; display: inline; vertical-align: baseline; line-height: inherit; }
    ${s} li > p:not(:first-child) { display: block; margin: 0.5em 0 0 !important; }
    ${s} li > p:first-child + ul, ${s} li > p:first-child + ol { margin-top: 0 !important; }
    ${s} li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.5em; }
    ${s} code { background-color: ${c.bgSidebar}; color: ${c.textMain}; padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.9em; }
    ${s} pre { background-color: ${c.bgSidebar}; color: ${c.textMain}; padding: 0.5em; border-radius: 6px; overflow-x: auto; margin: 0.35em 0 !important; }
    ${s} pre code { background: none; padding: 0; }
    ${s} blockquote { border-left: 3px solid ${c.border}; padding-left: 0.75em; margin: 0.25em 0 !important; color: ${c.textDim}; }
    ${s} a { color: ${c.accent}; text-decoration: underline; }
    ${s} hr { border: none; border-top: 1px solid ${c.border}; margin: 0.5em 0 !important; }
    ${s} table { border-collapse: collapse; width: 100%; margin: 0.35em 0 !important; }
    ${s} th, ${s} td { border: 1px solid ${c.border}; padding: 0.25em 0.5em; text-align: left; }
    ${s} th { background-color: ${c.bgSidebar}; font-weight: bold; }
    ${s} strong { font-weight: bold; }
    ${s} em { font-style: italic; }
    ${s} li > strong:first-child, ${s} li > b:first-child, ${s} li > em:first-child, ${s} li > code:first-child, ${s} li > a:first-child,
    ${s} li > p:first-child > strong:first-child, ${s} li > p:first-child > b:first-child, ${s} li > p:first-child > em:first-child, ${s} li > p:first-child > code:first-child, ${s} li > p:first-child > a:first-child { vertical-align: baseline; line-height: inherit; }
    ${s} li::marker { font-weight: normal; }
    ${getBionifyReadingModeStylesCss(s, theme)}
  `;
}
