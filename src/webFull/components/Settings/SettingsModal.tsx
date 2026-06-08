/**
 * SettingsModal — webFull rewrite of the renderer Settings modal shell
 *
 * Layer 3.1 — Settings General-tab port. This is the FIRST feature port into
 * src/webFull/ that lifts a modal, so it doubles as the proof-of-pattern for
 * the L2.1 primitives wiring. Per the brief, this port is a webfull-native
 * REWRITE using the lifted `Modal` primitive (NOT a verbatim renderer lift):
 *
 *   - renderer/components/Settings/SettingsModal.tsx is 665 LOC with 10 tabs
 *     (general, display, llm, shortcuts, theme, notifications, aicommands,
 *     groupchat, ssh, encore) and hardcodes a `780x720px` desktop-shaped
 *     dialog. It also wires Cmd+Shift+[/] tab navigation, an LLM "Test
 *     Connection" sidebar, and direct settings-store consumption.
 *
 *   - This webFull rewrite covers only the General tab (other tabs become
 *     subsequent agents per the Layer 3.x sub-plan). It uses the lifted
 *     `Modal` + `MODAL_PRIORITIES.SETTINGS` (priority 450) primitives,
 *     accepts the renderer's `theme: Theme` prop convention, and lets the
 *     wrapping `<LayerStackProvider>` in App.tsx handle Escape.
 *
 *   - When subsequent tabs ship, this component grows a tab nav strip
 *     (matching the renderer's pattern) and additional tab body components.
 *     For now there is a single "General" tab so the strip is visible but
 *     non-clickable — the structural slot is there for future ports.
 */

import { memo, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import type { Theme } from '../../../shared/theme-types';
import { Modal } from '../ui/Modal';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { GeneralTab } from './tabs/GeneralTab';

/**
 * Tabs the webFull SettingsModal supports today. Grows as subsequent
 * Layer 3.x ports land additional tab bodies.
 */
export type SettingsTabId = 'general';

export interface SettingsModalProps {
	/** Whether the modal is visible. */
	isOpen: boolean;
	/** Close handler — fires from the X button, backdrop click, or Escape. */
	onClose: () => void;
	/** Active theme threaded down to primitives (renderer convention). */
	theme: Theme;
	/** Initial tab to open on (defaults to 'general'). */
	initialTab?: SettingsTabId;
	/** Test ID hook for e2e probes. */
	testId?: string;
}

export const SettingsModal = memo(function SettingsModal(props: SettingsModalProps) {
	const { isOpen, onClose, theme, initialTab = 'general', testId } = props;
	const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

	if (!isOpen) return null;

	// The renderer Settings modal is fixed at 780x720; we mirror that shape so
	// the UX feels equivalent. Modal's default 90vh max-height handles smaller
	// viewports gracefully.
	return (
		<Modal
			theme={theme}
			title="Settings"
			priority={MODAL_PRIORITIES.SETTINGS}
			onClose={onClose}
			width={780}
			maxHeight="720px"
			showHeader={false}
			testId={testId ?? 'webfull-settings-modal'}
		>
			{/* Tab strip — matches the renderer's visual pattern.
			    Only "general" is wired today; other tabs land as subsequent agents. */}
			<div
				className="flex border-b -mx-6 -mt-6 mb-4"
				style={{ borderColor: theme.colors.border }}
				data-testid="webfull-settings-tab-strip"
			>
				<button
					onClick={() => setActiveTab('general')}
					className={`px-4 py-4 text-sm font-bold border-b-2 cursor-pointer flex items-center gap-2 ${
						activeTab === 'general' ? 'border-indigo-500' : 'border-transparent'
					}`}
					style={{
						color: activeTab === 'general' ? theme.colors.textMain : theme.colors.textDim,
					}}
					title="General"
					data-testid="webfull-settings-tab-general"
				>
					<SettingsIcon className="w-4 h-4" />
					<span>General</span>
				</button>
				<div className="flex-1 flex justify-end items-center pr-4">
					<button
						onClick={onClose}
						className="cursor-pointer text-2xl leading-none opacity-50 hover:opacity-100"
						style={{ color: theme.colors.textMain }}
						aria-label="Close Settings"
						data-testid="webfull-settings-close"
					>
						×
					</button>
				</div>
			</div>

			{/* Tab body */}
			<div className="overflow-y-auto" data-testid="webfull-settings-body">
				{activeTab === 'general' && <GeneralTab theme={theme} isOpen={isOpen} />}
			</div>
		</Modal>
	);
});

export default SettingsModal;
