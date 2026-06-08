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
