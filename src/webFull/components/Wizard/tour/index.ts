/**
 * Tour Module (webFull)
 *
 * Spotlight tour overlay system for guiding users through the interface.
 * Lifted verbatim from `src/renderer/components/Wizard/tour/` in the
 * Phase 1 leaf parade.
 */

export { TourOverlay } from './TourOverlay';
export { TourStep } from './TourStep';
export { TourWelcome } from './TourWelcome';
export { tourSteps, replaceShortcutPlaceholders } from './tourSteps';
export { useTour } from './useTour';
export type { TourStepConfig, TourUIAction, SpotlightInfo } from './useTour';
