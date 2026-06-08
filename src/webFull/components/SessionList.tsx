/**
 * SessionList — webFull Left Bar
 *
 * Layer 4.1 lift of the Electron renderer's Left Bar (the sidebar that lists
 * sessions/agents grouped by group). Reference oracle:
 * `src/renderer/components/SessionList/SessionList.tsx` (1247 LOC) and its
 * sibling `src/renderer/components/SessionListItem.tsx` (318 LOC). The full
 * renderer surface pulls in zustand stores, IPC, react-dnd-style drag/drop,
 * git-status context, live-overlay/tunnel UI, hamburger menu, group chats,
 * worktree drawers, skinny-sidebar mode, tour integration, jump numbers,
 * batch-store integration, and a resize handle. That is far more than a
 * single layer ships.
 *
 * This Layer 4.1 ports the minimum surface needed for a webFull user to
 * SEE the agent list and SELECT between agents — the criterion stated in
 * the task brief ("highest-impact remaining renderer surface … without it
 * webFull has no way to switch between agents"). Everything else is named
 * explicitly as DROPPED or DEFERRED in the parity catalog, so the partial-
 * parity surface stays countable per the ISC-44.<tab>.<deferral> convention
 * (ISA Decisions 2026-06-08).
 *
 * What's IN this lift:
 * - Brand header (Wand icon + MAESTRO wordmark) — visual anchor parity.
 * - Session items grouped by `sessionsByGroup` from `useSessions` —
 *   ungrouped sessions appear under "Ungrouped Agents" only when at least
 *   one group exists; otherwise the flat list renders directly (mirrors
 *   the renderer's flat-vs-folder decision tree at lines 1008-1134).
 * - Group folding (collapse/expand) with local UI state.
 * - Bookmarks section at the top, filtering `session.bookmarked === true`.
 * - Click-to-select → `onSelectSession(sessionId)`.
 * - Active-session highlight via accent border + accent-tinted background.
 * - Status color via `<StatusDot>` (idle=green, busy=yellow, error=red,
 *   connecting=pulsing-orange) — matches the renderer's color contract
 *   documented in CLAUDE.md "Agent States (color-coded)".
 * - Mode pill (AI vs Terminal) — matches mobile SessionPillBar convention.
 *
 * What's OUT (DROPPED — no browser equivalent or scope-explosion):
 * - Resize handle (would need react-resizable-style; webFull sidebar
 *   width is fixed at L4.1).
 * - Drag-and-drop session reordering (HTML5 DnD lands in a follow-on).
 * - Hover overlay menu (mouse-only; the renderer's `SessionListItem`
 *   surfaces a quick-action overlay on hover — deferred).
 * - Right-click context menu (`SessionContextMenu`) — deferred.
 * - Worktree drawer expand/collapse and worktree-child rendering — out
 *   of scope; renderer worktrees lean on git-status context that webFull
 *   doesn't carry yet.
 * - Hamburger menu, Live overlay, Tunnel UI, About modal trigger — UI
 *   chrome that's not on the read path for "see + select".
 * - Skinny sidebar mode (collapsed-to-pills). webFull always renders
 *   expanded at L4.1.
 * - Group chats panel (`GroupChatList`) — separate feature surface.
 * - Tour integration (`data-tour` markers).
 * - Jump numbers (1-9 / 0 keyboard shortcuts).
 * - Wand sparkle "busy" animation on the brand icon.
 * - New-group button / group renaming / drag-to-group / move-to-group.
 *   Group management lands in a follow-on; the renderer wires this
 *   through `CreateGroupModal` (already lifted L2.4) but the trigger
 *   button and inline group rename UI haven't been ported yet.
 * - "+ New Agent" button at the bottom (`SidebarActions`) — agent
 *   creation lands when the agent-config flow is ported.
 *
 * Wiring contract:
 * - Reads sessions via the existing `useSessions` hook (no new API
 *   routes added; server-side `GET /api/sessions` + WS `sessions_list` /
 *   `session_added` / `session_removed` / `session_state_change` frames
 *   already cover the data plane).
 * - Selection callback (`onSelectSession`) is the lift's sole side
 *   effect. The caller wires this into useSessions.setActiveSessionId.
 *
 * Theme access: receives `theme: Theme` as a prop following the L2.x
 * convention. The caller resolves theme via `useTheme()` and threads
 * down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. The renderer
 * source is the function-parity oracle; the parity catalog at
 * `SessionList.parity.test.ts` is the spec.
 */

import React, { memo, useMemo, useState } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { Session, GroupInfo } from '../hooks/useSessions';
import { SessionListItem } from './SessionListItem';

// --- Local presentational helpers ------------------------------------------

interface SessionGroupHeaderProps {
	label: string;
	emoji?: string | null;
	collapsed: boolean;
	count: number;
	theme: Theme;
	onToggle: () => void;
	accent?: boolean;
}

function SessionGroupHeader(props: SessionGroupHeaderProps) {
	const { label, emoji, collapsed, count, theme, onToggle, accent } = props;
	const color = accent ? theme.colors.accent : theme.colors.textDim;
	return (
		<button
			type="button"
			aria-expanded={!collapsed}
			onClick={onToggle}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '6px',
				width: '100%',
				padding: '6px 12px',
				border: 'none',
				backgroundColor: 'transparent',
				color,
				fontSize: '11px',
				fontWeight: 700,
				letterSpacing: '0.08em',
				textTransform: 'uppercase',
				textAlign: 'left',
				cursor: 'pointer',
				outline: 'none',
			}}
		>
			<span aria-hidden="true" style={{ display: 'inline-block', width: 10 }}>
				{collapsed ? '▸' : '▾'}
			</span>
			{emoji ? <span aria-hidden="true">{emoji}</span> : null}
			<span style={{ flex: 1 }}>{label}</span>
			<span style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7 }}>{count}</span>
		</button>
	);
}

// --- Public props -----------------------------------------------------------

export interface SessionListProps {
	theme: Theme;
	/** All sessions, in arrival order from the server. */
	sessions: Session[];
	/**
	 * Sessions organized by group (keyed by groupId or 'ungrouped'), produced
	 * by `useSessions().sessionsByGroup`. The renderer derives equivalent
	 * structure from a zustand `sessionStore` + `useSessionCategories` hook
	 * (renderer SessionList.tsx:369-382); webFull receives it pre-shaped from
	 * the server via the `sessions_list` WS frame.
	 */
	sessionsByGroup: Record<string, GroupInfo>;
	/** ID of the currently selected session, or null. */
	activeSessionId: string | null;
	/** Click-to-switch handler — webFull's sole side effect for L4.1. */
	onSelectSession: (sessionId: string) => void;
	/** Optional fixed width. Defaults to 280px. Resize handle is DEFERRED. */
	width?: number;
}

// --- SessionList ------------------------------------------------------------

/**
 * Layer 4.1 webFull SessionList. See file header for scope rationale.
 */
export const SessionList = memo(function SessionList(props: SessionListProps) {
	const { theme, sessions, sessionsByGroup, activeSessionId, onSelectSession, width = 280 } = props;

	// --- Local UI state: group collapse + bookmark collapse -----------------
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
	const [bookmarksCollapsed, setBookmarksCollapsed] = useState(false);

	const toggleGroup = (groupId: string) => {
		setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
	};

	// --- Derive: bookmarks and groups -------------------------------------
	// Bookmarks pull from the flat sessions list (parity with renderer
	// SessionList.tsx:373-374 `bookmarkedSessions` — across all groups).
	const bookmarkedSessions = useMemo(
		() => sessions.filter((s) => s.bookmarked === true),
		[sessions]
	);

	// Split groups vs ungrouped — the renderer's flat-vs-folder decision tree
	// (SessionList.tsx:1008-1134) hinges on whether ANY group exists. We
	// replicate the same trichotomy: (a) no groups at all → flat list,
	// (b) groups + ungrouped → "Ungrouped Agents" folder, (c) groups only →
	// just groups.
	const namedGroups = useMemo(() => {
		const out: GroupInfo[] = [];
		for (const key of Object.keys(sessionsByGroup)) {
			if (key === 'ungrouped') continue;
			const g = sessionsByGroup[key];
			if (g.id !== null) out.push(g);
		}
		return out;
	}, [sessionsByGroup]);

	const ungroupedSessions = useMemo(
		() => sessionsByGroup['ungrouped']?.sessions ?? [],
		[sessionsByGroup]
	);

	const hasAnyGroup = namedGroups.length > 0;

	// --- Render -------------------------------------------------------------
	return (
		<aside
			role="navigation"
			aria-label="Agents"
			data-testid="session-list"
			style={{
				width,
				flexShrink: 0,
				display: 'flex',
				flexDirection: 'column',
				borderRight: `1px solid ${theme.colors.border}`,
				backgroundColor: theme.colors.bgSidebar,
				color: theme.colors.textMain,
				height: '100%',
				overflow: 'hidden',
			}}
		>
			{/* Brand header — visual anchor parity with renderer line 633 */}
			<header
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
					padding: '14px 16px',
					borderBottom: `1px solid ${theme.colors.border}`,
					minHeight: 56,
					flexShrink: 0,
				}}
			>
				{/* Wand icon — inline SVG, parity with mobile MobileHeader */}
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke={theme.colors.accent}
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
					<path d="m14 7 3 3" />
					<path d="M5 6v4" />
					<path d="M19 14v4" />
					<path d="M10 2v2" />
					<path d="M7 8H3" />
					<path d="M21 16h-4" />
					<path d="M11 3H9" />
				</svg>
				<h1
					style={{
						margin: 0,
						fontSize: '16px',
						fontWeight: 700,
						letterSpacing: '0.15em',
						color: theme.colors.textMain,
					}}
				>
					MAESTRO
				</h1>
			</header>

			{/* Scrollable session area */}
			<div
				style={{
					flex: 1,
					overflowY: 'auto',
					paddingTop: '8px',
					paddingBottom: '8px',
				}}
				role="listbox"
				aria-label="Agent list"
			>
				{/* Bookmarks section — only when bookmarks exist */}
				{bookmarkedSessions.length > 0 && (
					<section aria-label="Bookmarks">
						<SessionGroupHeader
							label="Bookmarks"
							emoji="★"
							collapsed={bookmarksCollapsed}
							count={bookmarkedSessions.length}
							theme={theme}
							onToggle={() => setBookmarksCollapsed((c) => !c)}
							accent
						/>
						{!bookmarksCollapsed && (
							<div>
								{bookmarkedSessions.map((session) => (
									<SessionListItem
										key={`bookmark-${session.id}`}
										session={session}
										isActive={activeSessionId === session.id}
										theme={theme}
										onSelect={onSelectSession}
									/>
								))}
							</div>
						)}
					</section>
				)}

				{/* Decision tree: (a) no groups → flat list, (b) groups + ungrouped
				    → "Ungrouped Agents" folder, (c) groups only → just groups. */}
				{!hasAnyGroup ? (
					<section aria-label="Agents">
						{sessions.map((session) => (
							<SessionListItem
								key={`flat-${session.id}`}
								session={session}
								isActive={activeSessionId === session.id}
								theme={theme}
								onSelect={onSelectSession}
							/>
						))}
						{sessions.length === 0 && (
							<p
								style={{
									padding: '24px 16px',
									margin: 0,
									textAlign: 'center',
									color: theme.colors.textDim,
									fontSize: '12px',
								}}
							>
								No agents yet.
							</p>
						)}
					</section>
				) : (
					<>
						{namedGroups.map((group) => {
							const collapsed = !!collapsedGroups[group.id ?? ''];
							return (
								<section key={`group-${group.id}`} aria-label={`Group ${group.name}`}>
									<SessionGroupHeader
										label={group.name}
										emoji={group.emoji ?? undefined}
										collapsed={collapsed}
										count={group.sessions.length}
										theme={theme}
										onToggle={() => toggleGroup(group.id ?? '')}
									/>
									{!collapsed && (
										<div>
											{group.sessions.map((session) => (
												<SessionListItem
													key={`group-${group.id}-${session.id}`}
													session={session}
													isActive={activeSessionId === session.id}
													theme={theme}
													onSelect={onSelectSession}
												/>
											))}
										</div>
									)}
								</section>
							);
						})}
						{ungroupedSessions.length > 0 && (
							<section aria-label="Ungrouped Agents">
								<SessionGroupHeader
									label="Ungrouped Agents"
									emoji="📁"
									collapsed={!!collapsedGroups['__ungrouped__']}
									count={ungroupedSessions.length}
									theme={theme}
									onToggle={() => toggleGroup('__ungrouped__')}
								/>
								{!collapsedGroups['__ungrouped__'] && (
									<div>
										{ungroupedSessions.map((session) => (
											<SessionListItem
												key={`ungrouped-${session.id}`}
												session={session}
												isActive={activeSessionId === session.id}
												theme={theme}
												onSelect={onSelectSession}
											/>
										))}
									</div>
								)}
							</section>
						)}
					</>
				)}
			</div>
		</aside>
	);
});
