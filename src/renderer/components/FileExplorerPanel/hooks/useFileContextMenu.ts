import { useCallback, useRef, useState } from 'react';
import type { Session, Theme } from '../../../types';
import type { FileNode } from '../../../types/fileTree';
import { useClickOutside } from '../../../hooks/ui/useClickOutside';
import { useContextMenuPosition } from '../../../hooks/ui/useContextMenuPosition';
import { useEventListener } from '../../../hooks/utils/useEventListener';
import { useModalStore } from '../../../stores/modalStore';
import { safeClipboardWrite } from '../../../utils/clipboard';
import { captureException } from '../../../utils/sentry';
import type { ContextMenuState } from '../types';
import { PREVIEW_ALL_CONFIRM_THRESHOLD } from '../types';
import { collectPreviewableFiles } from '../utils/pathHelpers';

interface UseFileContextMenuArgs {
	session: Session;
	theme: Theme;
	onShowFlash?: (msg: string) => void;
	onFocusFileInGraph?: (relativePath: string) => void;
	onOpenBrowserTabAt?: (url: string, options?: { title?: string }) => void;
	handleFileClick: (node: FileNode, path: string, activeSession: Session) => Promise<void>;
	openRenameModal: (node: FileNode, path: string) => void;
	openDeleteModal: (node: FileNode, path: string) => Promise<void>;
	openNewFileModal: (parentFolderPath: string, parentFolderAbsolutePath: string) => void;
	setSelectedFileIndex: (n: number) => void;
}

interface UseFileContextMenuResult {
	contextMenu: ContextMenuState | null;
	contextMenuRef: React.RefObject<HTMLDivElement>;
	contextMenuPos: { top: number; left: number; ready?: boolean };
	openContextMenu: (e: React.MouseEvent, node: FileNode, path: string, globalIndex: number) => void;
	closeContextMenu: () => void;
	handleCopyPath: () => void;
	handleOpenInDefaultApp: () => void;
	handleOpenInMaestroBrowser: () => void;
	handleOpenInExplorer: () => void;
	handleOpenNewFile: () => void;
	handleOpenRename: () => void;
	handleOpenDelete: () => Promise<void>;
	handleFocusInGraph: () => void;
	handlePreviewFile: () => Promise<void>;
	handlePreviewAllInFolder: () => void;
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

export function useFileContextMenu({
	session,
	onShowFlash,
	onFocusFileInGraph,
	onOpenBrowserTabAt,
	handleFileClick,
	openRenameModal,
	openDeleteModal,
	openNewFileModal,
	setSelectedFileIndex,
}: UseFileContextMenuArgs): UseFileContextMenuResult {
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const contextMenuPos = useContextMenuPosition(
		contextMenuRef,
		contextMenu?.x ?? 0,
		contextMenu?.y ?? 0
	);

	useClickOutside(
		contextMenuRef,
		() => {
			setContextMenu(null);
		},
		contextMenu !== null
	);

	// Close context menu on Escape key (only attached while the menu is open).
	useEventListener(
		'keydown',
		(e) => {
			if ((e as KeyboardEvent).key === 'Escape') {
				setContextMenu(null);
			}
		},
		{ enabled: contextMenu !== null }
	);

	const openContextMenu = useCallback(
		(e: React.MouseEvent, node: FileNode, path: string, globalIndex: number) => {
			e.preventDefault();
			e.stopPropagation();
			setSelectedFileIndex(globalIndex);
			setContextMenu({ x: e.clientX, y: e.clientY, node, path });
		},
		[setSelectedFileIndex]
	);

	const closeContextMenu = useCallback(() => setContextMenu(null), []);

	const handleFocusInGraph = useCallback(() => {
		if (contextMenu && onFocusFileInGraph) {
			onFocusFileInGraph(contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, onFocusFileInGraph]);

	const handlePreviewFile = useCallback(async () => {
		const menu = contextMenu;
		try {
			if (menu && menu.node.type === 'file') {
				await handleFileClick(menu.node, menu.path, session);
			}
		} catch (error) {
			if (isMissingFileError(error)) {
				onShowFlash?.(`File not found: "${menu?.node.name ?? 'Unknown file'}"`);
				return;
			}
			captureException(error, {
				extra: {
					action: 'preview',
					path: menu?.path,
					nodeName: menu?.node.name,
					nodeType: menu?.node.type,
					sessionId: session.id,
				},
			});
			throw error;
		} finally {
			setContextMenu(null);
		}
	}, [contextMenu, handleFileClick, session, onShowFlash]);

	const handlePreviewAllInFolder = useCallback(() => {
		const menu = contextMenu;
		try {
			if (!menu || menu.node.type !== 'folder') {
				return;
			}
			const folderNode = menu.node;
			const folderPath = menu.path;

			const files = collectPreviewableFiles(folderNode, folderPath);
			if (files.length === 0) {
				onShowFlash?.(`No previewable files in "${folderNode.name}"`);
				return;
			}

			const openAll = async () => {
				try {
					for (const file of files) {
						await handleFileClick(file.node, file.path, session);
					}
					onShowFlash?.(
						`Opened ${files.length} file${files.length !== 1 ? 's' : ''} from "${folderNode.name}"`
					);
				} catch (error) {
					if (isMissingFileError(error)) {
						onShowFlash?.(`A file in "${folderNode.name}" was no longer available`);
						return;
					}
					captureException(error, {
						extra: {
							action: 'preview-all',
							path: folderPath,
							nodeName: folderNode.name,
							nodeType: folderNode.type,
							sessionId: session.id,
						},
					});
					throw error;
				}
			};

			if (files.length > PREVIEW_ALL_CONFIRM_THRESHOLD) {
				useModalStore.getState().openModal('confirm', {
					message: `Preview all ${files.length} files under "${folderNode.name}"? This opens a tab for each file.`,
					onConfirm: () => void openAll(),
				});
				return;
			}
			void openAll();
		} finally {
			setContextMenu(null);
		}
	}, [contextMenu, handleFileClick, session, onShowFlash]);

	const handleCopyPath = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			safeClipboardWrite(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenInDefaultApp = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			window.maestro?.shell?.openPath(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenInMaestroBrowser = useCallback(() => {
		if (contextMenu && contextMenu.node.type === 'file' && onOpenBrowserTabAt) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			const normalizedPath = absolutePath.replace(/\\/g, '/');
			const isWindowsDrivePath = /^[A-Za-z]:/.test(normalizedPath);
			const pathForUrl = isWindowsDrivePath ? `/${normalizedPath}` : normalizedPath;
			const encodedPath = pathForUrl
				.split('/')
				.map((seg, index) => (isWindowsDrivePath && index === 1 ? seg : encodeURIComponent(seg)))
				.join('/');
			const url = pathForUrl.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`;
			onOpenBrowserTabAt(url, { title: contextMenu.node.name });
		}
		setContextMenu(null);
	}, [contextMenu, onOpenBrowserTabAt, session.fullPath]);

	const handleOpenInExplorer = useCallback(() => {
		if (contextMenu) {
			const absolutePath = `${session.fullPath}/${contextMenu.path}`;
			window.maestro?.shell?.showItemInFolder(absolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath]);

	const handleOpenNewFile = useCallback(() => {
		if (contextMenu && contextMenu.node.type === 'folder') {
			const parentFolderAbsolutePath = `${session.fullPath}/${contextMenu.path}`;
			openNewFileModal(contextMenu.path, parentFolderAbsolutePath);
		}
		setContextMenu(null);
	}, [contextMenu, session.fullPath, openNewFileModal]);

	const handleOpenRename = useCallback(() => {
		if (contextMenu) {
			openRenameModal(contextMenu.node, contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, openRenameModal]);

	const handleOpenDelete = useCallback(async () => {
		if (contextMenu) {
			await openDeleteModal(contextMenu.node, contextMenu.path);
		}
		setContextMenu(null);
	}, [contextMenu, openDeleteModal]);

	return {
		contextMenu,
		contextMenuRef,
		contextMenuPos,
		openContextMenu,
		closeContextMenu,
		handleCopyPath,
		handleOpenInDefaultApp,
		handleOpenInMaestroBrowser,
		handleOpenInExplorer,
		handleOpenNewFile,
		handleOpenRename,
		handleOpenDelete,
		handleFocusInGraph,
		handlePreviewFile,
		handlePreviewAllInFolder,
	};
}
