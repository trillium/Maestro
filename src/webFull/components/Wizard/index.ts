/**
 * Wizard Module (webFull)
 *
 * Phase 1 leaf surface. Only files lifted from `src/renderer/components/Wizard/`
 * are re-exported here. The orchestrator (`MaestroWizard`), state container
 * (`WizardContext`), heavy screens, and service engines (`conversationManager`,
 * `phaseGenerator`) remain in renderer-only until Phase 3.
 */

export { WizardExitConfirmModal } from './WizardExitConfirmModal';
export { ExistingAutoRunDocsModal } from './ExistingAutoRunDocsModal';
export { ScreenReaderAnnouncement, useAnnouncement } from './ScreenReaderAnnouncement';
export type { AnnouncementPoliteness } from './ScreenReaderAnnouncement';
