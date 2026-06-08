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
