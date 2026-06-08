/**
 * ConfirmModal - Reusable confirmation dialog
 *
 * Lifted from src/renderer/components/ConfirmModal.tsx as part of the Layer 2.1
 * primitives lift. Implementation is verbatim except for the `Theme` import
 * path (renderer routes through `src/renderer/types/index.ts`; webFull imports
 * the type directly from `src/shared/theme-types`).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention.
 * Consumers in webFull call `useTheme()` at the feature-component level and
 * thread `theme` into this primitive. See Modal.tsx for rationale.
 */

import React, { memo, useRef, useCallback } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';

interface ConfirmModalProps {
	theme: Theme;
	message: string;
	onConfirm: (() => void) | null;
	onClose: () => void;
	title?: string;
	headerIcon?: React.ReactNode;
	icon?: React.ReactNode;
	destructive?: boolean;
	confirmLabel?: string;
}

export const ConfirmModal = memo(function ConfirmModal({
	theme,
	message,
	onConfirm,
	onClose,
	title = 'Confirm',
	headerIcon,
	icon,
	destructive = true,
	confirmLabel,
}: ConfirmModalProps) {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);

	const handleConfirm = useCallback(() => {
		if (onConfirm) {
			onConfirm();
		}
		onClose();
	}, [onConfirm, onClose]);

	const iconColor = destructive ? theme.colors.error : theme.colors.warning;

	return (
		<Modal
			theme={theme}
			title={title}
			priority={MODAL_PRIORITIES.CONFIRM}
			onClose={onClose}
			headerIcon={headerIcon ?? <Trash2 className="w-4 h-4" style={{ color: iconColor }} />}
			width={450}
			zIndex={10000}
			initialFocusRef={confirmButtonRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleConfirm}
					destructive={destructive}
					confirmLabel={confirmLabel}
					confirmButtonRef={confirmButtonRef}
				/>
			}
		>
			<div className="flex gap-4">
				<div
					className="flex-shrink-0 p-2 rounded-full h-fit"
					style={{ backgroundColor: `${iconColor}20` }}
				>
					{icon ?? <AlertTriangle className="w-5 h-5" style={{ color: iconColor }} />}
				</div>
				<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
					{message}
				</p>
			</div>
		</Modal>
	);
});
