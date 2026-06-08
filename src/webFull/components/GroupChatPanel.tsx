/**
 * GroupChatPanel.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/GroupChatPanel.tsx`
 * (172 LOC, 0 IPC) into `src/webFull/`. Main container for the Group Chat
 * view: composes the header, messages, and input components into a full
 * chat interface. This panel replaces the `MainPanel` when a group chat is
 * active.
 *
 * Direct sibling of the L2.5 `GroupChatHeader` lift (branch
 * `leaf-groupchat-header`, ISC-44.layer-2.5.groupchat_header CLOSED) and the
 * L2.5 `GroupChatMessages` lift (branch `leaf-groupchat-messages`,
 * ISC-44.layer-2.5.groupchat_messages CLOSED) — both header and messages
 * are now resolved against the webFull-sibling implementations. Continues
 * the GroupChat module port: header + messages already landed in webFull,
 * this lift wires the composition shell around them; only the input
 * (`GroupChatInput`) remains imported from the renderer source by relative
 * path per the L2.5 precedent for non-yet-lifted siblings.
 *
 * Lift posture (per the L2.5 sibling lifts — `GroupChatHeader`,
 * `GroupChatMessages`, `AutoRunnerHelpModal`, `ShortcutsHelpModal`,
 * `PlaybookDeleteConfirmModal`):
 *
 * - Component body is verbatim from the renderer source. Only import paths
 *   adapt.
 * - The renderer `Theme` import (`'../types'`) → `'../../shared/theme-types'`
 *   (the renderer routes the type through `src/renderer/types/index.ts` which
 *   itself re-exports from `src/shared/theme-types`; webFull imports the
 *   type directly from the canonical source).
 * - The renderer group-chat type imports (`GroupChat`, `GroupChatMessage`,
 *   `GroupChatState`) move from the renderer types barrel to their canonical
 *   source at `src/shared/group-chat-types.ts` (same swap the L2.5 sibling
 *   lifts made).
 * - `Group` from `'../types'` → `'../../shared/types'` (the renderer barrel
 *   re-exports `Group` from `'../../shared/types'` anyway — line 16 of
 *   `src/renderer/types/index.ts`; pull from the canonical source).
 * - `Shortcut`, `Session`, `QueuedItem` from `'../types'` → `'../../renderer/types'`
 *   directly. These three interfaces live in the renderer types barrel only
 *   (`src/renderer/types/index.ts` lines 165 / 505 / 211) and are not yet
 *   replicated to `src/shared/`. Matches the L2.5 `GroupChatHeader` /
 *   `ShortcutsHelpModal` precedent of pulling specific types from the
 *   canonical aggregator rather than copying into `src/shared/` which would
 *   create the silent-drift surface audit risk A explicitly warns against.
 *   All three are pure data shapes with no transitive `window.maestro`
 *   references at module-load time (the renderer types barrel itself is
 *   IPC-clean — pre-flight grep confirmed).
 * - `GroupChatHeader` and `GroupChatMessages` (+ `GroupChatMessagesHandle`
 *   type) resolve to the webFull-sibling lifts at `'./GroupChatHeader'` and
 *   `'./GroupChatMessages'`. Both shipped to webFull on `main` before this
 *   lift cut, so the panel composes against webFull-internal siblings for
 *   two of its three children.
 * - `GroupChatInput` from `'./GroupChatInput'` → `'../../renderer/components/GroupChatInput'`.
 *   The renderer-side input has NOT been lifted yet. Its own pre-flight
 *   grep against `window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer`
 *   returned empty (the input is composable at module-load time), but a
 *   full lift is its own brief — listed as a deferred follow-up in the
 *   `GroupChatHeader` lift's evidence. Per the L2.5 precedent (the original
 *   `GroupChatMessages` lift accepted six cross-fork imports as transitive
 *   surface, all later neutralized by subsequent leaf lifts), we pull the
 *   not-yet-lifted sibling from the renderer source by relative path. When
 *   `GroupChatInput` lands in webFull, the panel's import line flips from
 *   `'../../renderer/components/GroupChatInput'` → `'./GroupChatInput'`,
 *   neutralizing the last cross-fork edge in this composition shell.
 *
 * IPC / Electron surface: zero. Pre-flight
 * `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer"`
 * against `src/renderer/components/GroupChatPanel.tsx` returned empty
 * (exit 1). The composition shell touches none of the banned surface; all
 * side-effecting actions flow through prop callbacks (`onSendMessage`,
 * `onStopAll`, `onRename`, `onShowInfo`, `onToggleRightPanel`, etc.) which
 * the host wires to its own runtime — feature wiring (moderator routing
 * IPC, participant-cost subscription over the webFull WS bridge) is a
 * downstream-layer concern.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches.
 */

import type { Theme } from '../../shared/theme-types';
import type { GroupChat, GroupChatMessage, GroupChatState } from '../../shared/group-chat-types';
import type { Group } from '../../shared/types';
import type { Shortcut, Session, QueuedItem } from '../../renderer/types';
import { GroupChatHeader } from './GroupChatHeader';
import { GroupChatMessages, type GroupChatMessagesHandle } from './GroupChatMessages';
import { GroupChatInput } from './GroupChatInput';

interface GroupChatPanelProps {
	theme: Theme;
	groupChat: GroupChat;
	messages: GroupChatMessage[];
	state: GroupChatState;
	/** Total accumulated cost from all participants (including moderator) */
	totalCost?: number;
	/** True if one or more participants don't have cost data (makes total incomplete) */
	costIncomplete?: boolean;
	onSendMessage: (content: string, images?: string[], readOnly?: boolean) => void;
	onStopAll: () => void;
	onRename: () => void;
	onShowInfo: () => void;
	rightPanelOpen: boolean;
	onToggleRightPanel: () => void;
	shortcuts: Record<string, Shortcut>;
	sessions: Session[];
	groups?: Group[];
	onDraftChange?: (draft: string) => void;
	onOpenPromptComposer?: () => void;
	// Lifted state for sync with PromptComposer
	stagedImages?: string[];
	setStagedImages?: React.Dispatch<React.SetStateAction<string[]>>;
	readOnlyMode?: boolean;
	setReadOnlyMode?: (value: boolean) => void;
	// External ref for focusing from keyboard handler
	inputRef?: React.RefObject<HTMLTextAreaElement>;
	// Image paste handler from App
	handlePaste?: (e: React.ClipboardEvent) => void;
	// Image drop handler from App
	handleDrop?: (e: React.DragEvent) => void;
	// Image lightbox handler
	onOpenLightbox?: (image: string, contextImages?: string[], source?: 'staged' | 'history') => void;
	// Execution queue props
	executionQueue?: QueuedItem[];
	onRemoveQueuedItem?: (itemId: string) => void;
	onReorderQueuedItems?: (fromIndex: number, toIndex: number) => void;
	// Markdown toggle (Cmd+E)
	markdownEditMode?: boolean;
	onToggleMarkdownEditMode?: () => void;
	// Output collapsing
	maxOutputLines?: number;
	// Input send behavior
	enterToSendAI?: boolean;
	setEnterToSendAI?: (value: boolean) => void;
	// Flash notification callback
	showFlashNotification?: (message: string) => void;
	/** Pre-computed participant colors for consistent colors across components */
	participantColors?: Record<string, string>;
	/** Ref to expose scrollToMessage on the messages component */
	messagesRef?: React.RefObject<GroupChatMessagesHandle>;
}

export function GroupChatPanel({
	theme,
	groupChat,
	messages,
	state,
	totalCost,
	costIncomplete,
	onSendMessage,
	onStopAll,
	onRename,
	onShowInfo,
	rightPanelOpen,
	onToggleRightPanel,
	shortcuts,
	sessions,
	groups,
	onDraftChange,
	onOpenPromptComposer,
	stagedImages,
	setStagedImages,
	readOnlyMode,
	setReadOnlyMode,
	inputRef,
	handlePaste,
	handleDrop,
	onOpenLightbox,
	executionQueue,
	onRemoveQueuedItem,
	onReorderQueuedItems,
	markdownEditMode,
	onToggleMarkdownEditMode,
	maxOutputLines,
	enterToSendAI,
	setEnterToSendAI,
	showFlashNotification,
	participantColors,
	messagesRef,
}: GroupChatPanelProps): JSX.Element {
	return (
		<div className="flex flex-col h-full" style={{ backgroundColor: theme.colors.bgMain }}>
			<GroupChatHeader
				theme={theme}
				name={groupChat.name}
				participantCount={groupChat.participants.length}
				totalCost={totalCost}
				costIncomplete={costIncomplete}
				state={state}
				onStopAll={onStopAll}
				onRename={onRename}
				onShowInfo={onShowInfo}
				rightPanelOpen={rightPanelOpen}
				onToggleRightPanel={onToggleRightPanel}
				shortcuts={shortcuts}
			/>

			<GroupChatMessages
				ref={messagesRef}
				theme={theme}
				messages={messages}
				participants={groupChat.participants}
				state={state}
				markdownEditMode={markdownEditMode}
				onToggleMarkdownEditMode={onToggleMarkdownEditMode}
				maxOutputLines={maxOutputLines}
				participantColors={participantColors}
			/>

			<GroupChatInput
				theme={theme}
				state={state}
				onSend={onSendMessage}
				participants={groupChat.participants}
				sessions={sessions}
				groups={groups}
				groupChatId={groupChat.id}
				draftMessage={groupChat.draftMessage}
				onDraftChange={onDraftChange}
				onOpenPromptComposer={onOpenPromptComposer}
				stagedImages={stagedImages}
				setStagedImages={setStagedImages}
				readOnlyMode={readOnlyMode}
				setReadOnlyMode={setReadOnlyMode}
				inputRef={inputRef}
				handlePaste={handlePaste}
				handleDrop={handleDrop}
				onOpenLightbox={onOpenLightbox}
				executionQueue={executionQueue}
				onRemoveQueuedItem={onRemoveQueuedItem}
				onReorderQueuedItems={onReorderQueuedItems}
				enterToSendAI={enterToSendAI}
				setEnterToSendAI={setEnterToSendAI}
				showFlashNotification={showFlashNotification}
				shortcuts={shortcuts}
			/>
		</div>
	);
}
