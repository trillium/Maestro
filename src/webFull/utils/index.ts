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
