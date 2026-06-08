/**
 * SaveMarkdownModal — webFull lift
 *
 * Layer 2.5 leaf-parade lift of `src/renderer/components/SaveMarkdownModal.tsx`
 * (243 LOC). 0 module-load IPC, 0 module-load Electron-only APIs. Pre-flight
 * `grep -n "window\.maestro\|window\.electron\|ipcRenderer\|window\.api"
 *   src/renderer/components/SaveMarkdownModal.tsx` returns exactly TWO hits,
 * both inside event-handler lambdas (NOT module-load):
 *
 *   - line 64 (`handleBrowseFolder`): `window.maestro.dialog.selectFolder()`
 *   - line 90 (`handleSave`): `window.maestro.fs.writeFile(...)`
 *
 * Lambda-deferred IPC sites are the established strip-and-promote-to-prop
 * surface for L2.5 leaf parade lifts (see `HistoryDetailModal` —
 * `useSettingsStore` strip; `AppOverlays` — three store strips;
 * `GroupChatInput` — `spellCheck` strip).
 *
 * Why lift this now: TerminalOutput.tsx imports SaveMarkdownModal directly
 * (renderer line 31) and renders it inline as a child modal whenever
 * `saveModalContent !== null` (renderer line 1900). Per the brief's audit
 * #10 callout, SaveMarkdownModal is the one direct precondition gating the
 * TerminalOutput lift. Landing SaveMarkdownModal first reduces TerminalOutput's
 * blocking-deps count to zero among siblings (all other imports either resolve
 * to existing webFull primitives or use established strip-and-promote /
 * cross-fork-type-import precedents).
 *
 * ## Strip-and-promote-to-prop adapts (two)
 *
 * ### 1. `dialog.selectFolder` → `onBrowseFolder` prop (optional)
 *
 * The renderer source's `handleBrowseFolder` reaches for the native folder
 * picker via `window.maestro.dialog.selectFolder()`. In the web/SSH context
 * there is no native dialog surface, AND the renderer source already gates
 * the browse button on `!isRemoteSession` because "native dialog can only
 * browse local fs" (renderer line 183). The web fork is effectively always
 * in the same "no native picker" situation.
 *
 * The clean adapt: replace the direct IPC call with an `onBrowseFolder`
 * prop callback. When the prop is undefined OR `isRemoteSession === true`,
 * the FolderOpen button is hidden (gating logic preserved, just unioned).
 * When defined, the callback is invoked exactly as the renderer invokes the
 * IPC and the resolved string populates the folder field. This keeps the
 * door open for a future webFull host to wire a server-side folder picker
 * or a file-tree picker overlay without changing the component contract.
 *
 * ### 2. `fs.writeFile` → `onWriteFile` prop (required)
 *
 * The renderer source's `handleSave` calls
 * `window.maestro.fs.writeFile(fullPath, content, sshRemoteId)` and switches
 * on the returned `{ success }` shape. The webFull lift promotes this to a
 * required `onWriteFile` prop with the same `(path, content, sshRemoteId?) =>
 * Promise<{ success: boolean; error?: string }>` shape. The host wires it to
 * whatever write surface is available (WebSocket protocol write request,
 * REST PUT, etc.). Making it required reflects reality — saving without a
 * write surface is meaningless.
 *
 * Other than these two strips, the implementation is verbatim from the
 * renderer source: same Modal composition, same MODAL_PRIORITIES.SAVE_MARKDOWN
 * priority, same .md auto-extension logic, same Enter-to-save keyboard
 * handler, same "Open in Tab" checkbox, same path-separator detection for
 * Windows backslashes vs POSIX slashes, same focus-on-mount via
 * requestAnimationFrame, same error display, same isValid gating.
 *
 * ## Import-path adapts (three — matching L2.5 precedent)
 *
 *   - `Theme` from `'../types'` → `'../../shared/theme-types'`
 *     (standard L2.5 swap; webFull has no `types/` aggregator).
 *   - `Modal, ModalFooter` from `'./ui/Modal'` — unchanged; resolves to
 *     the L2.1 lifted webFull primitive at the same sibling path.
 *   - `MODAL_PRIORITIES` from `'../constants/modalPriorities'` — unchanged;
 *     webFull's constants module re-exports from renderer so
 *     `MODAL_PRIORITIES.SAVE_MARKDOWN` (value 160) is preserved verbatim.
 *
 * Composition shape: createPortal-rendered modal with the L2.1 Modal
 * primitive providing chrome + layer-stack registration via internal
 * `useModalLayer`, ModalFooter for the right-side Cancel/Save button pair,
 * a custom footer slot to host the "Open in Tab" checkbox on the left.
 * Width 480, closeOnBackdropClick true. Two text inputs (folder path,
 * filename) with the filename field auto-focused on mount.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import { Modal, ModalFooter } from './ui/Modal';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

export interface SaveMarkdownModalProps {
	theme: Theme;
	content: string;
	onClose: () => void;
	/** Default folder path to show initially */
	defaultFolder?: string;
	/** Whether the session is running over SSH (hides folder browser button) */
	isRemoteSession?: boolean;
	/** SSH remote ID for saving to remote filesystem */
	sshRemoteId?: string;
	/** Callback when file is successfully saved (e.g., to refresh file list) */
	onFileSaved?: () => void;
	/** Callback to open the saved file in a tab. When provided, shows an "Open in Tab" checkbox. */
	onOpenInTab?: (file: {
		path: string;
		name: string;
		content: string;
		sshRemoteId?: string;
	}) => void;
	/**
	 * Optional folder-picker callback — strip-and-promote-to-prop adapt for
	 * the renderer's `window.maestro.dialog.selectFolder()` at line 64. When
	 * undefined OR `isRemoteSession === true`, the FolderOpen button is
	 * hidden (matches renderer gating semantics unioned with absence-of-host
	 * affordance). When defined, the resolved string populates the folder
	 * field. Returning `null` or empty leaves the field unchanged.
	 */
	onBrowseFolder?: () => Promise<string | null>;
	/**
	 * Required write callback — strip-and-promote-to-prop adapt for the
	 * renderer's `window.maestro.fs.writeFile(...)` at line 90. Same shape as
	 * the renderer IPC contract.
	 */
	onWriteFile: (
		path: string,
		content: string,
		sshRemoteId?: string
	) => Promise<{ success: boolean; error?: string }>;
}

export function SaveMarkdownModal({
	theme,
	content,
	onClose,
	defaultFolder = '',
	isRemoteSession = false,
	sshRemoteId,
	onFileSaved,
	onOpenInTab,
	onBrowseFolder,
	onWriteFile,
}: SaveMarkdownModalProps) {
	const [folder, setFolder] = useState(defaultFolder);
	const [filename, setFilename] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openInTab, setOpenInTab] = useState(false);
	const filenameInputRef = useRef<HTMLInputElement>(null);

	// Focus the filename input on mount
	useEffect(() => {
		requestAnimationFrame(() => {
			filenameInputRef.current?.focus();
		});
	}, []);

	const handleBrowseFolder = async () => {
		if (!onBrowseFolder) return;
		try {
			const selectedFolder = await onBrowseFolder();
			if (selectedFolder) {
				setFolder(selectedFolder);
				setError(null);
			}
		} catch {
			setError('Failed to open folder browser');
		}
	};

	const handleSave = async () => {
		setSaving(true);
		setError(null);

		try {
			// Ensure .md extension
			let finalFilename = filename.trim();
			if (!finalFilename.toLowerCase().endsWith('.md')) {
				finalFilename += '.md';
			}

			// Construct full path
			const separator = folder.includes('\\') ? '\\' : '/';
			const fullPath = `${folder}${folder.endsWith(separator) ? '' : separator}${finalFilename}`;

			// Write the file (local or remote via SSH) via host-supplied callback
			const result = await onWriteFile(fullPath, content, sshRemoteId);
			if (result.success) {
				onFileSaved?.();
				if (openInTab && onOpenInTab) {
					onOpenInTab({ path: fullPath, name: finalFilename, content, sshRemoteId });
				}
				onClose();
			} else {
				setError(result.error ?? 'Failed to save file');
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save file');
		} finally {
			setSaving(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !saving && folder.trim() && filename.trim()) {
			e.preventDefault();
			handleSave();
		}
	};

	const isValid = folder.trim() && filename.trim();
	const showBrowseButton = !isRemoteSession && !!onBrowseFolder;

	return createPortal(
		<Modal
			theme={theme}
			title="Save Markdown"
			priority={MODAL_PRIORITIES.SAVE_MARKDOWN}
			onClose={onClose}
			width={480}
			closeOnBackdropClick
			footer={
				<div className="flex items-center justify-between w-full">
					{/* Open in Tab checkbox - left side of footer */}
					{onOpenInTab ? (
						<label
							className="flex items-center gap-2 cursor-pointer select-none"
							style={{ color: theme.colors.textDim }}
						>
							<input
								type="checkbox"
								checked={openInTab}
								onChange={(e) => setOpenInTab(e.target.checked)}
								className="rounded"
								style={{ accentColor: theme.colors.accent }}
							/>
							<span className="text-xs">Open in Tab</span>
						</label>
					) : (
						<div />
					)}
					{/* Buttons - right side of footer */}
					<div className="flex gap-2">
						<ModalFooter
							theme={theme}
							onCancel={onClose}
							onConfirm={handleSave}
							confirmLabel={saving ? 'Saving...' : 'Save'}
							confirmDisabled={!isValid || saving}
						/>
					</div>
				</div>
			}
		>
			<div className="flex flex-col gap-4">
				{/* Folder input with browse button */}
				<div>
					<label
						className="block text-xs font-medium mb-1.5"
						style={{ color: theme.colors.textDim }}
					>
						Folder
					</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={folder}
							onChange={(e) => {
								setFolder(e.target.value);
								setError(null);
							}}
							onKeyDown={handleKeyDown}
							placeholder="/path/to/folder"
							className="flex-1 px-3 py-2 rounded border text-sm outline-none focus:ring-1"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						{/* Hide folder browser for remote sessions OR when no picker callback is wired */}
						{showBrowseButton && (
							<button
								type="button"
								onClick={handleBrowseFolder}
								className="px-3 py-2 rounded border hover:bg-white/5 transition-colors"
								style={{
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
								title="Browse for folder"
							>
								<FolderOpen className="w-4 h-4" />
							</button>
						)}
					</div>
				</div>

				{/* Filename input */}
				<div>
					<label
						className="block text-xs font-medium mb-1.5"
						style={{ color: theme.colors.textDim }}
					>
						Filename
					</label>
					<input
						ref={filenameInputRef}
						type="text"
						value={filename}
						onChange={(e) => {
							setFilename(e.target.value);
							setError(null);
						}}
						onKeyDown={handleKeyDown}
						placeholder="document.md"
						className="w-full px-3 py-2 rounded border text-sm outline-none focus:ring-1"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<p className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
						.md extension will be added automatically if not provided
					</p>
				</div>

				{/* Error message */}
				{error && (
					<p className="text-xs" style={{ color: theme.colors.error }}>
						{error}
					</p>
				)}
			</div>
		</Modal>,
		document.body
	);
}

export default SaveMarkdownModal;
