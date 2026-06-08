/**
 * Inline Wizard (`/wizard` command) — webFull
 *
 * Components for creating Auto Run Playbook documents from within an existing
 * agent session. Phase 1 leaf parade lifts the presentational components from
 * `src/renderer/components/InlineWizard/`; the engine (`useInlineWizard`,
 * `inlineWizardConversation`, `inlineWizardDocumentGeneration`) and the two
 * components that transitively depend on `createWizardBubbleMarkdownComponents`
 * (`WizardMessageBubble`, `WizardConversationView`) are deferred — see
 * Phase 1 lift report for details.
 */

export { WizardPill } from './WizardPill';
export { WizardConfidenceGauge } from './WizardConfidenceGauge';
export { WizardInputPanel } from './WizardInputPanel';
export { WizardModePrompt } from './WizardModePrompt';
export { WizardExitConfirmDialog } from './WizardExitConfirmDialog';
export { DocumentGenerationView, type DocumentGenerationViewProps } from './DocumentGenerationView';
export { AustinFactsDisplay } from './AustinFactsDisplay';
export { StreamingDocumentPreview } from './StreamingDocumentPreview';
export { GenerationCompleteOverlay } from './GenerationCompleteOverlay';
