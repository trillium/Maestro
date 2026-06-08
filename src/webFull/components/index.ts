/**
 * Web interface components for Maestro
 *
 * Shared components used by both mobile and desktop web interfaces.
 */

export { ThemeProvider, useTheme, useThemeColors, ThemeContext } from './ThemeProvider';
export type { ThemeProviderProps, ThemeContextValue } from './ThemeProvider';

export { Button, IconButton } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps } from './Button';

export { Input, TextArea, InputGroup } from './Input';
export type { InputProps, TextAreaProps, InputGroupProps, InputVariant, InputSize } from './Input';

export { PullToRefreshIndicator } from './PullToRefresh';
export type { PullToRefreshIndicatorProps } from './PullToRefresh';

// ============================================================================
// Layer 2.1 lifted primitives (verbatim from renderer with relative-path adapts)
// ============================================================================

export { Modal, ModalFooter } from './ui/Modal';
export type { ModalProps, ModalFooterProps } from './ui/Modal';

export { FormInput } from './ui/FormInput';
export type { FormInputProps } from './ui/FormInput';

export { ConfirmModal } from './ConfirmModal';

// ============================================================================
// Layer 2.2 lifted primitives (verbatim from renderer with relative-path adapts)
// ============================================================================

export { EmojiPickerField } from './ui/EmojiPickerField';
export type { EmojiPickerFieldProps } from './ui/EmojiPickerField';

// ============================================================================
// Layer 2.4 lifted primitives (verbatim from renderer with relative-path adapts)
// ============================================================================

export { ResetTasksConfirmModal } from './ResetTasksConfirmModal';
export { PlaybookNameModal } from './PlaybookNameModal';
export { CreateGroupModal } from './CreateGroupModal';

// ============================================================================
// Layer 4.1 lifted surface — Left Bar (SessionList)
// ============================================================================

export { SessionList } from './SessionList';
export type { SessionListProps } from './SessionList';

// ============================================================================
// Layer 4.2 lifted surface — AI tab navigation (TabBar)
// ============================================================================

export { TabBar } from './TabBar';
export type { TabBarProps } from './TabBar';

// ============================================================================
// Layer 2.5 leaf-parade primitives (verbatim from renderer with relative-path adapts)
// ============================================================================

export { PlaybookDeleteConfirmModal } from './PlaybookDeleteConfirmModal';
export { RenameGroupModal } from './RenameGroupModal';
export { RenameGroupChatModal } from './RenameGroupChatModal';
export { DeleteGroupChatModal } from './DeleteGroupChatModal';
export { SessionListItem, stateToStatus } from './SessionListItem';
export type { SessionListItemProps } from './SessionListItem';
export { DeleteWorktreeModal } from './DeleteWorktreeModal';
export { DeleteAgentConfirmModal } from './DeleteAgentConfirmModal';
export { HistoryHelpModal } from './HistoryHelpModal';
export { QuitConfirmModal } from './QuitConfirmModal';
export { AutoRunnerHelpModal } from './AutoRunnerHelpModal';
export { ShortcutsHelpModal } from './ShortcutsHelpModal';
export { ToggleButtonGroup } from './ToggleButtonGroup';
export type { ToggleButtonOption } from './ToggleButtonGroup';
export { AgentErrorModal } from './AgentErrorModal';
export type { RecoveryAction } from './AgentErrorModal';
export { ContextWarningSash } from './ContextWarningSash';
export type { ContextWarningSashProps } from './ContextWarningSash';
export { QRCode } from './QRCode';
export { ExecutionQueueIndicator } from './ExecutionQueueIndicator';
export type {
	ExecutionQueueIndicatorProps,
	ExecutionQueueItem,
	ExecutionQueueSession,
} from './ExecutionQueueIndicator';
export { FirstRunCelebration } from './FirstRunCelebration';
export { KeyboardMasteryCelebration } from './KeyboardMasteryCelebration';
export { GroupChatMessages } from './GroupChatMessages';
export type { GroupChatMessagesHandle } from './GroupChatMessages';
export { ThemePicker } from './ThemePicker';
export { SettingCheckbox } from './SettingCheckbox';
export type { SettingCheckboxProps } from './SettingCheckbox';
export { WelcomeContent } from './WelcomeContent';
export { CollapsibleJsonViewer } from './CollapsibleJsonViewer';
export { MarkdownRenderer, CodeBlockWithCopy } from './MarkdownRenderer';
export type { CodeBlockWithCopyProps, MarkdownRendererProps } from './MarkdownRenderer';
export { GroupChatHeader } from './GroupChatHeader';
export { AppOverlays } from './AppOverlays';
export type {
	AppOverlaysProps,
	StandingOvationData as AppOverlaysStandingOvationData,
	FirstRunCelebrationData as AppOverlaysFirstRunCelebrationData,
} from './AppOverlays';
export { AutoRunSearchBar } from './AutoRunSearchBar';
export type { AutoRunSearchBarProps } from './AutoRunSearchBar';
export { GroupChatPanel } from './GroupChatPanel';
export { ErrorBoundary } from './ErrorBoundary';
export { LogFilterControls } from './LogFilterControls';
export type { LogFilterControlsProps } from './LogFilterControls';
export { FontConfigurationPanel } from './FontConfigurationPanel';
export type { FontConfigurationPanelProps } from './FontConfigurationPanel';
export { GitStatusWidget } from './GitStatusWidget';
export type { GitStatusWidgetProps, GitFileChange, GitFileDetails } from './GitStatusWidget';
export { MaestroSilhouette, AnimatedMaestro } from './MaestroSilhouette';
export { TemplateAutocompleteDropdown } from './TemplateAutocompleteDropdown';
export { AgentPromptComposerModal } from './AgentPromptComposerModal';
export { QueuedItemsList } from './QueuedItemsList';
export type {
	QueuedItem as QueuedItemsListItem,
	QueuedItemType as QueuedItemsListItemType,
} from './QueuedItemsList';
export { ShortcutEditor } from './ShortcutEditor';
export type { ShortcutEditorProps } from './ShortcutEditor';
export { ToolCallCard, getToolName } from './ToolCallCard';
export { LightboxModal } from './LightboxModal';
export { ParticipantCard } from './ParticipantCard';
export { MergeProgressOverlay } from './MergeProgressOverlay';
export type { MergeProgressOverlayProps } from './MergeProgressOverlay';
export { ThinkingStatusPill } from './ThinkingStatusPill';
export { SummarizeProgressOverlay } from './SummarizeProgressOverlay';
export type { SummarizeProgressOverlayProps } from './SummarizeProgressOverlay';
export { AutoRunLightbox } from './AutoRunLightbox';
export { GroupChatInput } from './GroupChatInput';
export { StandingOvationOverlay } from './StandingOvationOverlay';
export { SessionActivityGraph, LOOKBACK_OPTIONS } from './SessionActivityGraph';
export type { LookbackPeriod, ActivityEntry } from './SessionActivityGraph';
export { GitDiffViewer } from './GitDiffViewer';
export type { GitDiffViewerProps } from './GitDiffViewer';
export { SessionItem } from './SessionItem';
export type { SessionItemProps, SessionItemVariant } from './SessionItem';
export { CsvTableRenderer } from './CsvTableRenderer';
export type { CsvTableRendererProps } from './CsvTableRenderer';
export { GroupChatList } from './GroupChatList';
export type { GroupChatListProps } from './GroupChatList';
export { MermaidRenderer } from './MermaidRenderer';
export { FileSearchModal, flattenPreviewableFiles } from './FileSearchModal';
export type { FlatFileItem } from './FileSearchModal';
export { AICommandsPanel } from './AICommandsPanel';
export { AutoRunDocumentSelector } from './AutoRunDocumentSelector';
export type { DocTreeNode, DocumentTaskCount } from './AutoRunDocumentSelector';
export { AutoRunExpandedModal } from './AutoRunExpandedModal';
export { AutoRun } from './AutoRun';
export type { AutoRunHandle } from './AutoRun';
export { SendToAgentModal } from './SendToAgentModal';
export type {
	SendToAgentModalProps,
	SendToAgentOptions,
	SessionOption as SendToAgentSessionOption,
	SessionStatus as SendToAgentSessionStatus,
} from './SendToAgentModal';
export { PromptComposerModal } from './PromptComposerModal';
export type { PromptComposerModalProps } from './PromptComposerModal';
export { MergeProgressModal } from './MergeProgressModal';
export type { MergeProgressModalProps } from './MergeProgressModal';
export { SummarizeProgressModal } from './SummarizeProgressModal';
export type { SummarizeProgressModalProps } from './SummarizeProgressModal';
export { TransferProgressModal } from './TransferProgressModal';
export type { TransferProgressModalProps } from './TransferProgressModal';
export { CustomThemeBuilder } from './CustomThemeBuilder';
export { ExecutionQueueBrowser } from './ExecutionQueueBrowser';
export type {
	QueuedItem as ExecutionQueueBrowserQueuedItem,
	ExecutionQueueSession as ExecutionQueueBrowserSession,
} from './ExecutionQueueBrowser';
export { TransferErrorModal, classifyTransferError } from './TransferErrorModal';
export type {
	TransferError,
	TransferErrorType,
	TransferErrorModalProps,
} from './TransferErrorModal';
export { HistoryDetailModal } from './HistoryDetailModal';
export { SaveMarkdownModal } from './SaveMarkdownModal';
export type { SaveMarkdownModalProps } from './SaveMarkdownModal';
export {
	TerminalOutput,
	getTerminalScrollSnapshot,
	addTerminalHighlightMarkers,
} from './TerminalOutput';
export type { TerminalScrollSnapshot } from './TerminalOutput';
export { MarketplaceModal } from './MarketplaceModal';
export type { MarketplaceModalProps } from './MarketplaceModal';

// ============================================================================
// Leaf-parade — NewInstanceModal + EditAgentModal (the biggest single-modal
// user-felt unlock, lands on top of all 5 IPC-shim route clusters)
// ============================================================================

export { NewInstanceModal, EditAgentModal } from './NewInstanceModal';
export type { RemotePathValidate, RemotePathValidateResult } from './NewInstanceModal';

// ============================================================================
// Audit #10 mount-wave 2 — SettingsModal surface re-export
// ============================================================================
//
// SettingsModal was lifted as part of Layer 3.1/3.2 but never wired through
// the public `components/` barrel. Mount-wave 2 wires it into mobile/App.tsx
// behind a Cmd+, debug keybinding; this re-export lets the host import it
// alongside the rest of the barrel rather than reaching into the nested
// `./Settings/SettingsModal` path.
export { SettingsModal } from './Settings/SettingsModal';
export type { SettingsModalProps, SettingsTabId } from './Settings/SettingsModal';

// ============================================================================
// Phase 1 — Wizard ecosystem leaf parade (ISC-44.lift.wizard_*)
//
// Lifted from `src/renderer/components/Wizard/` and
// `src/renderer/components/InlineWizard/` in the Phase 1 leaf parade per
// `WIZARD_LIFT_PLAN.md`. Every lifted file is 0-IPC (verified via
// `grep -c 'window\.maestro' <renderer file>` returning 0) or had a single
// `shell.openExternal` swapped to `window.open(href, '_blank', 'noopener,noreferrer')`.
//
// SKIPPED in this batch — blocked by missing `createWizardBubbleMarkdownComponents`
// shim (the renderer helper hardcodes `window.maestro.shell.openExternal`,
// unlike `createMarkdownComponents` which uses an injected callback):
//   - InlineWizard/WizardMessageBubble.tsx
//   - InlineWizard/WizardConversationView.tsx  (depends on WizardMessageBubble)
// See report for follow-up shim plan.
// ============================================================================

// Wizard tree
export { WizardExitConfirmModal } from './Wizard/WizardExitConfirmModal';
export { ExistingAutoRunDocsModal } from './Wizard/ExistingAutoRunDocsModal';
export { ScreenReaderAnnouncement, useAnnouncement } from './Wizard/ScreenReaderAnnouncement';
export type { AnnouncementPoliteness } from './Wizard/ScreenReaderAnnouncement';
export { DocumentSelector } from './Wizard/shared/DocumentSelector';
export type { DocumentSelectorProps } from './Wizard/shared/DocumentSelector';
export { TypingIndicator } from './Wizard/shared/TypingIndicator';

// Phase 2 medium-IPC additions (ISC-44.lift.wizard_{resume_modal,document_editor,phase_review_screen}_lifted)
// ExistingDocsModal SKIPPED — no `/api/autorun/delete-folder` route exists in the
// server tree as of this lift (only `delete-image` is shipped). See ISA.md entry
// for the unblocking-route follow-up.
export { WizardResumeModal } from './Wizard/WizardResumeModal';
export {
	DocumentEditor,
	ImagePreview as DocumentEditorImagePreview,
	MarkdownImage as DocumentEditorMarkdownImage,
	openDocumentPreviewExternalLink,
} from './Wizard/shared/DocumentEditor';
export type { DocumentEditorProps } from './Wizard/shared/DocumentEditor';
export { PhaseReviewScreen } from './Wizard/screens/PhaseReviewScreen';

// Wizard tour
export { TourOverlay } from './Wizard/tour/TourOverlay';
export { TourStep } from './Wizard/tour/TourStep';
export { TourWelcome } from './Wizard/tour/TourWelcome';
export { tourSteps, replaceShortcutPlaceholders } from './Wizard/tour/tourSteps';
export { useTour } from './Wizard/tour/useTour';
export type { TourStepConfig, TourUIAction, SpotlightInfo } from './Wizard/tour/useTour';

// Wizard services (pure data + parsers, 0 IPC)
export { wizardPrompts, parseStructuredOutput } from './Wizard/services/wizardPrompts';

// InlineWizard tree
export { WizardPill } from './InlineWizard/WizardPill';
export { WizardConfidenceGauge } from './InlineWizard/WizardConfidenceGauge';
export { WizardInputPanel } from './InlineWizard/WizardInputPanel';
export { WizardModePrompt } from './InlineWizard/WizardModePrompt';
export { WizardExitConfirmDialog } from './InlineWizard/WizardExitConfirmDialog';
export {
	DocumentGenerationView,
	type DocumentGenerationViewProps,
} from './InlineWizard/DocumentGenerationView';
export { AustinFactsDisplay } from './InlineWizard/AustinFactsDisplay';
export { StreamingDocumentPreview } from './InlineWizard/StreamingDocumentPreview';
export { GenerationCompleteOverlay } from './InlineWizard/GenerationCompleteOverlay';
