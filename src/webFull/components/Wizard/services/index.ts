/**
 * Wizard Services (webFull)
 *
 * Phase 1 leaf surface. Only IPC-free service modules are re-exported here.
 * `conversationManager` and `phaseGenerator` remain renderer-only until Phase 3.
 */

export { wizardPrompts, parseStructuredOutput } from './wizardPrompts';
