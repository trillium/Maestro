/**
 * BatchRunState — runtime state of an Auto Run / batch processing session.
 *
 * Promoted from `src/renderer/types/index.ts` so the web/webFull fork can
 * consume the same type without crossing the fork boundary. All embedded
 * types resolve through `src/shared/`:
 *
 * - `BatchProcessingState` from `src/shared/types/batchProcessingState`
 * - `AgentError` from `src/shared/types`
 *
 * The full batch state machine (transition table, events, reducer) remains
 * renderer-side at `src/renderer/hooks/batch/`; only the data shape is
 * shared.
 */
import type { AgentError } from '../types';
import type { BatchProcessingState } from './batchProcessingState';

export interface BatchRunState {
	isRunning: boolean;
	isStopping: boolean; // Waiting for current task to finish before stopping

	// State machine integration (Phase 11)
	// Tracks explicit processing state for invariant checking and debugging
	processingState?: BatchProcessingState;

	// Document-level progress (multi-document support)
	documents: string[]; // Ordered list of document filenames to process
	lockedDocuments: string[]; // Documents that should be read-only during this run (subset of documents)
	currentDocumentIndex: number; // Which document we're on (0-based)

	// Task-level progress within current document
	currentDocTasksTotal: number; // Total tasks in current document
	currentDocTasksCompleted: number; // Completed tasks in current document

	// Overall progress (grows as reset docs add tasks back)
	totalTasksAcrossAllDocs: number;
	completedTasksAcrossAllDocs: number;

	// Loop mode
	loopEnabled: boolean;
	loopIteration: number; // How many times we've looped (0 = first pass)
	maxLoops?: number | null; // Max loop iterations (null/undefined = infinite)

	// Folder path for file operations
	folderPath: string;

	// Worktree tracking
	worktreeActive: boolean; // Currently running in a worktree
	worktreePath?: string; // Path to the active worktree
	worktreeBranch?: string; // Branch name in the worktree

	// Legacy fields (kept for backwards compatibility during migration)
	totalTasks: number;
	completedTasks: number;
	currentTaskIndex: number;
	scratchpadPath?: string; // Path to temp file
	originalContent: string; // Original scratchpad content for sync back

	// Prompt configuration
	customPrompt?: string; // User's custom prompt if modified
	sessionIds: string[]; // Claude session IDs from each iteration
	startTime?: number; // Timestamp when batch run started
	cumulativeTaskTimeMs?: number; // Sum of actual task durations (most accurate work time measure)
	accumulatedElapsedMs?: number; // Accumulated active elapsed time (excludes sleep/suspend time)
	lastActiveTimestamp?: number; // Last timestamp when actively tracking (for pause/resume calculation)

	// Error handling state (Phase 5.10)
	error?: AgentError; // Current error if batch is paused due to agent error
	errorPaused?: boolean; // True if batch is paused waiting for error resolution
	errorDocumentIndex?: number; // Which document had the error (for skip functionality)
	errorTaskDescription?: string; // Description of the task that failed (for UI display)
}
