/**
 * SessionListItem — webFull Left Bar row component
 *
 * Layer 2.5 leaf-parade lift. Extracts the inline `SessionListItem` block
 * that landed inside L4.1's `SessionList.tsx` (lines 100-167) into a
 * standalone module, so webFull's Left Bar consumes a real per-agent row
 * component instead of inline-deriving from the renderer source.
 *
 * **Reference oracles:**
 *   - `src/renderer/components/SessionListItem.tsx` (318 LOC) — the
 *     architectural pattern oracle for "per-agent row component". The
 *     renderer's version renders `ClaudeSession` rows inside
 *     `AgentSessionsBrowser` (star button, quick-resume, rename, origin
 *     pill, session ID pill, time/messages/size/cost stats, match preview,
 *     ACTIVE badge). That is a substantially larger surface than the Left
 *     Bar needs and threads a different data shape (`ClaudeSession` is the
 *     Claude per-conversation row, not the agent row).
 *   - `src/webFull/components/SessionList.tsx` (L4.1) — the consumer.
 *     The Left Bar needs ONE row per agent (a `Session`, NOT a
 *     `ClaudeSession`) showing: status dot, name, AI/⌘ mode pill, active
 *     highlight, click-to-select. That is the surface this file ships.
 *
 * **Why not a renderer-verbatim lift?** The renderer's `SessionListItem`
 * binds to `ClaudeSession` (the Claude per-conversation session shape) and
 * is invoked by `AgentSessionsBrowser`, not by the Left Bar. The Left Bar
 * row is a separate concept — it renders an agent (a `Session`) and lives
 * inline inside the renderer's `SessionList/SessionList.tsx` (1247 LOC),
 * not as a standalone file. The webFull L4.1 lift made the architectural
 * decision to ship a Left Bar row component with the four observable
 * behaviors (`data-session-id`, `data-session-state`, `data-active`,
 * `aria-selected`, name, AI/⌘ pill) that the L4.1 parity catalog asserts
 * against. This lift just relocates that block into a proper file so
 * future Left Bar consumers (skinny sidebar, mobile session pill bar
 * desktop variant, sub-bars) can reuse it without duplicating.
 *
 * **What's IN this lift:**
 *   - Single button row per agent (`role="option"`, `aria-selected`).
 *   - Four-color status dot via `<StatusDot>` (idle/busy/error/connecting),
 *     mapped from `session.state` via `stateToStatus`. Unknown states
 *     fall back to `error` — matches the L4.1 parity contract
 *     (`session-list-falls-back-to-error-status-for-unknown-states`).
 *   - Active-session highlight (accent-tinted bg + accent left border +
 *     bold font weight).
 *   - AI vs Terminal mode pill (`AI` for AI-mode, `⌘` for terminal-mode).
 *   - Click handler firing `onSelect(sessionId)` — the Left Bar's sole
 *     side effect for L4.1.
 *
 * **What's OUT** (the renderer's `SessionListItem.tsx` carries these but
 * they belong to `AgentSessionsBrowser`, not the Left Bar; the Left Bar
 * has its own deferral tracker at `ISC-44.layer-4.1.*`):
 *   - Star button / favorites (`ClaudeSession.isStarred`).
 *   - Quick-resume button (hover overlay — tracked as
 *     `ISC-44.layer-4.1.hover_overlay_menu`).
 *   - Inline rename input + `Edit3` button.
 *   - Origin pill (MAESTRO / AUTO / CLI).
 *   - Session ID pill.
 *   - Time / messages / size / cost stats.
 *   - Search match count + match preview.
 *   - ACTIVE indicator pill (the Left Bar uses border + bg highlight
 *     instead of a text pill; the renderer's pill belongs to the
 *     conversation-row UI not the agent-row UI).
 *
 * **Theme access**: receives `theme: Theme` as a prop (L2.x convention).
 *
 * **stateToStatus helper**: exported here so SessionList can keep
 * importing it (single source of truth for the state→status mapping).
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 *
 * @module webFull/components/SessionListItem
 */

import React, { memo } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { Session } from '../hooks/useSessions';
import { StatusDot, type SessionStatus } from './Badge';

/**
 * Map a Session's wire-protocol `state` string to the four-color SessionStatus
 * vocabulary used by `<StatusDot>`. The renderer's contract (per CLAUDE.md
 * "Agent States (color-coded)") is:
 *   idle → green, busy → yellow, error → red, connecting → orange (pulsing).
 * Any other state defaults to `error` — visual parity with `SessionPillBar`.
 */
export function stateToStatus(state: string | undefined): SessionStatus {
	if (state === 'idle') return 'idle';
	if (state === 'busy') return 'busy';
	if (state === 'connecting') return 'connecting';
	return 'error';
}

export interface SessionListItemProps {
	session: Session;
	isActive: boolean;
	theme: Theme;
	onSelect: (sessionId: string) => void;
}

export const SessionListItem = memo(function SessionListItem(props: SessionListItemProps) {
	const { session, isActive, theme, onSelect } = props;
	const status = stateToStatus(session.state);
	const isAi = session.inputMode !== 'terminal';

	return (
		<button
			type="button"
			role="option"
			aria-selected={isActive}
			data-session-id={session.id}
			data-session-state={session.state}
			data-active={isActive ? 'true' : 'false'}
			onClick={() => onSelect(session.id)}
			className="session-list-item"
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				width: '100%',
				padding: '8px 12px',
				border: 'none',
				borderLeft: isActive ? `3px solid ${theme.colors.accent}` : `3px solid transparent`,
				backgroundColor: isActive ? `${theme.colors.accent}15` : 'transparent',
				color: theme.colors.textMain,
				fontSize: '13px',
				fontWeight: isActive ? 600 : 400,
				textAlign: 'left',
				cursor: 'pointer',
				outline: 'none',
				transition: 'background-color 0.15s ease, border-color 0.15s ease',
			}}
		>
			<StatusDot status={status} size="sm" />
			<span
				style={{
					flex: 1,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{session.name || 'Untitled'}
			</span>
			<span
				aria-label={isAi ? 'AI mode' : 'Terminal mode'}
				style={{
					fontSize: '10px',
					fontWeight: 600,
					padding: '2px 4px',
					borderRadius: '3px',
					lineHeight: 1,
					color: isAi ? theme.colors.accent : theme.colors.textDim,
					backgroundColor: isAi ? `${theme.colors.accent}20` : `${theme.colors.textDim}20`,
				}}
			>
				{isAi ? 'AI' : '⌘'}
			</span>
		</button>
	);
});
