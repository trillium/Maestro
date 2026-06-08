/**
 * @file GroupChatList.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/GroupChatList.tsx`
 * (416 LOC) into `src/webFull/`. Left-panel collapsible list of Group Chats —
 * appears below the Ungrouped Agents section in the renderer's Left Bar.
 * Renders a chevron-collapsible header (with count badge + "+ New Chat"
 * affordance + optional archived-toggle pill), the body list of chats
 * (sorted by `updatedAt` desc, archived chats grouped to bottom when the
 * "show archived" toggle is on), and a right-click context menu offering
 * Edit / Rename / Archive (when supported) / Delete.
 *
 * Direct sibling of the L2.5 GroupChat module lifts already merged on
 * `main`: `GroupChatPanel`, `GroupChatHeader`, `GroupChatMessages`,
 * `GroupChatInput`. Once `GroupChatList` lands, the GroupChat component
 * surface from the renderer is fully represented in `src/webFull/`. Feature
 * wiring (where the list mounts, which store provides the chats, what
 * happens on `onNewGroupChat`, etc.) is a downstream-layer concern owned
 * by the host App.
 *
 * Lift posture (per the L2.5 sibling lifts — `SessionItem`,
 * `GroupChatPanel`, `GroupChatHeader`, `GroupChatMessages`,
 * `ParticipantCard`):
 *
 * - Component body is verbatim from the renderer source. Only import paths
 *   adapt.
 * - The renderer `Theme` import (`'../types'`) → `'../../shared/theme-types'`
 *   (the renderer routes the type through `src/renderer/types/index.ts`
 *   which itself re-exports from `src/shared/theme-types`; webFull imports
 *   the type directly from the canonical source).
 * - The renderer group-chat type imports (`GroupChat`, `GroupChatState`)
 *   move from the renderer types barrel to their canonical source at
 *   `src/shared/group-chat-types.ts` (which is what the renderer barrel
 *   re-exports anyway). Same swap every L2.5 GroupChat sibling lift made.
 * - `useClickOutside` and `useContextMenuPosition` are pure renderer hooks
 *   (no `window.maestro`, no `electron`, no `ipcRenderer` — verified). They
 *   are imported directly by relative path from
 *   `'../../renderer/hooks/ui/useClickOutside'` and
 *   `'../../renderer/hooks/ui/useContextMenuPosition'`, following the L2.5
 *   precedent set by `SessionActivityGraph` (which imports
 *   `useContextMenuPosition` the same way) and `AgentPromptComposerModal`
 *   (which imports `useClickOutside` the same way). Duplicating the hooks
 *   into the webFull tree would create the silent-drift surface the
 *   parade's audit risk A explicitly warns against.
 * - `getStatusColor` is a pure renderer helper that maps a `SessionState`
 *   to a theme color. Imported directly from `'../../renderer/utils/theme'`,
 *   following the L2.5 precedent set by `SessionItem` and `ParticipantCard`.
 *   The mapping table is purely a function of theme colors + the discriminant
 *   string; no `window.maestro`, no Electron-only API.
 *
 * IPC / Electron surface: zero. The renderer source touches no
 * `window.maestro.*`, no `electron` import, no `shell.openExternal`,
 * `shell.openPath`, or `ipcRenderer`. All side-effecting actions are
 * delivered through the prop callbacks (`onOpenGroupChat`,
 * `onNewGroupChat`, `onEditGroupChat`, `onRenameGroupChat`,
 * `onDeleteGroupChat`, `onArchiveGroupChat`, `onExpandedChange`), which
 * the host wires to its own runtime — feature wiring is a downstream-layer
 * concern.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches, 0 `src/web/` edits,
 * 0 `src/renderer/` edits.
 *
 * @module webFull/components/GroupChatList
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
	MessageSquare,
	ChevronDown,
	ChevronRight,
	Edit3,
	Trash2,
	Settings,
	Archive,
	ArchiveRestore,
} from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { GroupChat, GroupChatState } from '../../shared/group-chat-types';
import { useClickOutside } from '../../shared/hooks/useClickOutside';
import { useContextMenuPosition } from '../../renderer/hooks/ui/useContextMenuPosition';
import { getStatusColor } from '../../renderer/utils/theme';

// ============================================================================
// GroupChatContextMenu - Right-click context menu for group chat items
// ============================================================================

interface GroupChatContextMenuProps {
	x: number;
	y: number;
	theme: Theme;
	isArchived: boolean;
	onEdit: () => void;
	onRename: () => void;
	onArchive?: () => void;
	onDelete: () => void;
	onClose: () => void;
}

function GroupChatContextMenu({
	x,
	y,
	theme,
	isArchived,
	onEdit,
	onRename,
	onArchive,
	onDelete,
	onClose,
}: GroupChatContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on click outside
	useClickOutside(menuRef, onClose);

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	// Measure menu and adjust position to stay within viewport
	const { left, top, ready } = useContextMenuPosition(menuRef, x, y);

	return (
		<div
			ref={menuRef}
			className="fixed z-50 py-1 rounded-md shadow-xl border"
			style={{
				left,
				top,
				opacity: ready ? 1 : 0,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				minWidth: '120px',
			}}
		>
			<button
				onClick={() => {
					onEdit();
					onClose();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.textMain }}
			>
				<Settings className="w-3.5 h-3.5" />
				Edit
			</button>
			<button
				onClick={() => {
					onRename();
					onClose();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.textMain }}
			>
				<Edit3 className="w-3.5 h-3.5" />
				Rename
			</button>
			{onArchive && (
				<button
					onClick={() => {
						onArchive();
						onClose();
					}}
					className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
					style={{ color: theme.colors.textMain }}
				>
					{isArchived ? (
						<ArchiveRestore className="w-3.5 h-3.5" />
					) : (
						<Archive className="w-3.5 h-3.5" />
					)}
					{isArchived ? 'Unarchive' : 'Archive'}
				</button>
			)}
			<button
				onClick={() => {
					onDelete();
					onClose();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.error }}
			>
				<Trash2 className="w-3.5 h-3.5" />
				Delete
			</button>
		</div>
	);
}

// ============================================================================
// GroupChatList - Main component for Group Chat list in left sidebar
// ============================================================================

interface GroupChatListProps {
	theme: Theme;
	groupChats: GroupChat[];
	activeGroupChatId: string | null;
	onOpenGroupChat: (id: string) => void;
	onNewGroupChat: () => void;
	onEditGroupChat: (id: string) => void;
	onRenameGroupChat: (id: string) => void;
	onDeleteGroupChat: (id: string) => void;
	onArchiveGroupChat?: (id: string, archived: boolean) => void;
	/** Controlled expanded state (lifted to parent for keyboard navigation) */
	isExpanded?: boolean;
	/** Callback when expanded state changes */
	onExpandedChange?: (expanded: boolean) => void;
	/** Current state of the active group chat (for status indicator) */
	groupChatState?: GroupChatState;
	/** Per-participant working states for the active group chat */
	participantStates?: Map<string, 'idle' | 'working'>;
	/** State for ALL group chats (groupChatId -> state), for showing busy indicator when not active */
	groupChatStates?: Map<string, GroupChatState>;
	/** Participant states for ALL group chats (groupChatId -> Map<participantName, state>) */
	allGroupChatParticipantStates?: Map<string, Map<string, 'idle' | 'working'>>;
}

export function GroupChatList({
	theme,
	groupChats,
	activeGroupChatId,
	onOpenGroupChat,
	onNewGroupChat,
	onEditGroupChat,
	onRenameGroupChat,
	onDeleteGroupChat,
	onArchiveGroupChat,
	isExpanded: controlledIsExpanded,
	onExpandedChange,
	groupChatState = 'idle',
	participantStates,
	groupChatStates,
	allGroupChatParticipantStates,
}: GroupChatListProps): JSX.Element {
	// Support both controlled and uncontrolled modes
	// If isExpanded prop is provided, use it as controlled state
	// Otherwise, use internal state (default: expanded if there are group chats)
	const [internalIsExpanded, setInternalIsExpanded] = useState(groupChats.length > 0);
	const isExpanded = controlledIsExpanded !== undefined ? controlledIsExpanded : internalIsExpanded;

	const [showArchived, setShowArchived] = useState(false);

	const setIsExpanded = useCallback(
		(expanded: boolean) => {
			if (onExpandedChange) {
				onExpandedChange(expanded);
			} else {
				setInternalIsExpanded(expanded);
			}
		},
		[onExpandedChange]
	);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		chatId: string;
	} | null>(null);

	// Track previous count to detect when chats are added
	const prevCountRef = useRef(groupChats.length);

	// Auto-expand when a new chat is added
	useEffect(() => {
		if (groupChats.length > prevCountRef.current) {
			// A chat was added, expand the list
			setIsExpanded(true);
		}
		prevCountRef.current = groupChats.length;
	}, [groupChats.length, setIsExpanded]);

	const handleContextMenu = (e: React.MouseEvent, chatId: string) => {
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY, chatId });
	};

	const archivedCount = useMemo(() => groupChats.filter((c) => c.archived).length, [groupChats]);
	const activeCount = groupChats.length - archivedCount;

	// Filter and sort group chats: show active chats, plus archived if toggled
	const sortedGroupChats = useMemo(() => {
		return [...groupChats]
			.filter((c) => (showArchived ? true : !c.archived))
			.sort((a, b) => {
				// When showing archived, group active chats first
				if (showArchived && a.archived !== b.archived) {
					return a.archived ? 1 : -1;
				}
				return (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt);
			});
	}, [groupChats, showArchived]);

	return (
		<div className="border-t mt-4" style={{ borderColor: theme.colors.border }}>
			{/* Header - Collapsible with count badge and New button */}
			<div
				className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-white/5 group"
				onClick={() => setIsExpanded(!isExpanded)}
			>
				<div
					className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
					style={{ color: theme.colors.textDim }}
				>
					{isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
					<MessageSquare className="w-3.5 h-3.5" />
					<span>Group Chats</span>
					{activeCount > 0 && (
						<span
							className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
							style={{
								backgroundColor: theme.colors.border,
								color: theme.colors.textDim,
							}}
						>
							{activeCount}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{onArchiveGroupChat && archivedCount > 0 && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								setShowArchived(!showArchived);
							}}
							className="px-2 py-0.5 rounded-full text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1"
							style={{
								backgroundColor: showArchived ? `${theme.colors.textDim}20` : 'transparent',
								color: theme.colors.textDim,
								border: `1px solid ${theme.colors.border}`,
							}}
							title={
								showArchived
									? 'Hide archived chats'
									: `Show ${archivedCount} archived chat${archivedCount !== 1 ? 's' : ''}`
							}
						>
							<Archive className="w-3 h-3" />
							<span>{archivedCount}</span>
						</button>
					)}
					<button
						onClick={(e) => {
							e.stopPropagation();
							onNewGroupChat();
						}}
						className="px-2 py-0.5 rounded-full text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1"
						style={{
							backgroundColor: theme.colors.accent + '20',
							color: theme.colors.accent,
							border: `1px solid ${theme.colors.accent}40`,
						}}
						title="New Group Chat"
					>
						<span>+ New Chat</span>
					</button>
				</div>
			</div>

			{/* List of Group Chats */}
			{isExpanded && (
				<div className="px-2 pb-2">
					{sortedGroupChats.length === 0 ? (
						<div className="text-xs px-3 py-2 italic" style={{ color: theme.colors.textDim }}>
							{groupChats.length === 0 ? 'No group chats yet' : 'All group chats are archived'}
						</div>
					) : (
						<div
							className="flex flex-col border-l ml-4"
							style={{ borderColor: theme.colors.border }}
						>
							{sortedGroupChats.map((chat) => {
								const isActive = activeGroupChatId === chat.id;
								// Determine status for this group chat
								// For active chat, use the direct state props; for inactive chats, use the per-chat maps
								const chatState = isActive
									? groupChatState
									: groupChatStates?.get(chat.id) || 'idle';
								const isBusy = chatState !== 'idle';
								// Check if any participant is working
								const chatParticipantStates = isActive
									? participantStates
									: allGroupChatParticipantStates?.get(chat.id);
								const hasWorkingParticipant =
									chatParticipantStates &&
									Array.from(chatParticipantStates.values()).some((s) => s === 'working');
								// Show busy indicator if moderator is thinking OR any participant is working
								const showBusy = isBusy || hasWorkingParticipant;
								// Map to session state for getStatusColor compatibility
								const effectiveState = showBusy ? 'busy' : 'idle';
								const statusColor = getStatusColor(effectiveState, theme);

								return (
									<div
										key={chat.id}
										className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-white/5"
										style={{
											backgroundColor: isActive ? `${theme.colors.accent}20` : 'transparent',
											opacity: chat.archived ? 0.5 : 1,
										}}
										onDoubleClick={() => onOpenGroupChat(chat.id)}
										onClick={() => onOpenGroupChat(chat.id)}
										onContextMenu={(e) => handleContextMenu(e, chat.id)}
									>
										{chat.archived ? (
											<Archive
												className="w-4 h-4 shrink-0"
												style={{ color: theme.colors.textDim }}
											/>
										) : (
											<MessageSquare
												className="w-4 h-4 shrink-0"
												style={{ color: isActive ? theme.colors.accent : theme.colors.textDim }}
											/>
										)}
										<span
											className="text-sm truncate flex-1"
											style={{ color: theme.colors.textMain }}
										>
											{chat.name}
										</span>
										{chat.participants.length > 0 && (
											<span
												className="text-[10px] px-1.5 py-0.5 rounded-full"
												style={{
													backgroundColor: theme.colors.border,
													color: theme.colors.textDim,
												}}
												title={`${chat.participants.length} participant${chat.participants.length !== 1 ? 's' : ''}`}
											>
												{chat.participants.length}
											</span>
										)}
										{/* Status indicator circle - on right side to align with session indicators */}
										<div
											className={`w-2 h-2 rounded-full shrink-0 ${showBusy ? 'animate-pulse' : ''}`}
											style={{ backgroundColor: statusColor }}
											title={showBusy ? 'Thinking...' : 'Idle'}
										/>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			{/* Context Menu */}
			{contextMenu && (
				<GroupChatContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					theme={theme}
					isArchived={!!groupChats.find((c) => c.id === contextMenu.chatId)?.archived}
					onEdit={() => onEditGroupChat(contextMenu.chatId)}
					onRename={() => onRenameGroupChat(contextMenu.chatId)}
					onArchive={
						onArchiveGroupChat
							? () => {
									const chat = groupChats.find((c) => c.id === contextMenu.chatId);
									if (chat) onArchiveGroupChat(chat.id, !chat.archived);
								}
							: undefined
					}
					onDelete={() => onDeleteGroupChat(contextMenu.chatId)}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}

export type { GroupChatListProps };
