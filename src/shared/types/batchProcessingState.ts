/**
 * Batch processing state — explicit states for the Auto Run / batch state
 * machine.
 *
 * Promoted from `src/renderer/hooks/batch/batchStateMachine.ts` so that
 * `BatchRunState` (which embeds this as an optional discriminator) can live
 * in `src/shared/types/` and be referenced from the web/webFull fork without
 * a cross-fork import.
 *
 * The full state machine (transition table, events, context) remains in
 * `src/renderer/hooks/batch/batchStateMachine.ts`; only the leaf string-union
 * type is shared.
 */
export type BatchProcessingState =
	| 'IDLE' // No batch is running
	| 'INITIALIZING' // Setting up worktree, counting tasks, preparing documents
	| 'RUNNING' // Actively processing tasks
	| 'PAUSED_ERROR' // Paused due to an error, awaiting user action
	| 'STOPPING' // Stop requested, finishing current task
	| 'COMPLETING'; // Finalizing batch (creating PR, cleanup, history)
