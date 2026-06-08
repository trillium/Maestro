/**
 * Wizard Services (webFull)
 *
 * Phase 1 leaf surface (IPC-free) + Phase 3B `phaseGenerator` (IPC adapters
 * threaded via `PhaseGeneratorConfig`). `conversationManager` remains
 * renderer-only until its own lift.
 */

export { wizardPrompts, parseStructuredOutput } from './wizardPrompts';
export {
	PhaseGenerator,
	createPhaseGenerator,
	phaseGeneratorUtils,
	wizardDebugLogger,
	sanitizeFilename,
	deriveSshRemoteId,
	generateDocumentGenerationPrompt,
	parseGeneratedDocuments,
	countTasks,
	validateDocuments,
	splitIntoPhases,
	AUTO_RUN_FOLDER_NAME,
} from './phaseGenerator';
export type {
	PhaseGeneratorConfig,
	GenerationConfig,
	GenerationResult,
	GenerationCallbacks,
	CreatedFileInfo,
	WizardDebugLogEntry,
	WizardMessage,
	GeneratedDocument,
} from './phaseGenerator';
