/**
 * Web interface utilities for Maestro
 */

export {
	generateCSSProperties,
	generateCSSString,
	injectCSSProperties,
	removeCSSProperties,
	setElementCSSProperties,
	removeElementCSSProperties,
	getCSSProperty,
	cssVar,
	THEME_CSS_PROPERTIES,
} from './cssCustomProperties';
export type { ThemeCSSProperty } from './cssCustomProperties';

export {
	registerServiceWorker,
	unregisterServiceWorker,
	isServiceWorkerSupported,
	isOffline,
	skipWaiting,
	pingServiceWorker,
} from './serviceWorker';
export type { ServiceWorkerConfig } from './serviceWorker';

// Layer 2.5 leaf-parade primitives (verbatim from renderer with relative-path adapts)
export {
	generateParticipantColor,
	buildParticipantColorMap,
	buildParticipantColorMapWithPreferences,
	MODERATOR_COLOR_INDEX,
	COLOR_PALETTE_SIZE,
	normalizeMentionName,
	mentionMatches,
} from './participantColors';
export type { ParticipantColorInfo } from './participantColors';

// Layer 2.5 leaf-parade: text processing (verbatim lift from renderer)
export {
	processCarriageReturns,
	processLogTextHelper,
	filterTextByLinesHelper,
	getCachedAnsiHtml,
	clearAnsiCache,
	stripMarkdown,
	ANSI_CACHE_MAX_SIZE,
} from './textProcessing';

// Layer 2.5 leaf-parade: clipboard (pure surface only — image helper not lifted)
export { safeClipboardWrite, safeClipboardWriteBlob } from './clipboard';

// Layer 2.5 leaf-parade: terminal prose styles (surgical extract from markdownConfig)
export { generateTerminalProseStyles } from './terminalProseStyles';
