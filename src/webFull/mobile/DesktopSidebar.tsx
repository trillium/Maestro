/**
 * DesktopSidebar — Layer 4.1 Left Bar wire-up
 *
 * Thin adapter that mounts the lifted `SessionList` (Layer 4.1) inside
 * webFull's mobile App. The brief required wiring into `src/webFull/mobile/
 * App.tsx`; this sub-component keeps that wiring under 30 LOC by encapsulating
 * the sessionsByGroup derivation and the small-screen visibility gate here.
 *
 * Visibility rule (matches the visual layout convention established by
 * `useMobileViewState`): the Left Bar only renders when `isSmallScreen === false`.
 * On phones/narrow tablets, the existing `SessionPillBar` continues to provide
 * agent selection; on desktop-width browsers, this Left Bar is the primary
 * agent-picker, mirroring the Electron Left Bar's role.
 *
 * sessionsByGroup derivation mirrors `useSessions()`'s memoized derivation
 * (see `src/webFull/hooks/useSessions.ts:357-375`). The mobile App uses
 * `useMobileSessionManagement` (not `useSessions`) and therefore doesn't
 * receive `sessionsByGroup` pre-shaped; rebuilding it here is the smallest
 * adapter shape that avoids duplicating the SessionList component for the
 * two-hook reality. Both paths read the same wire-protocol fields
 * (`groupId`, `groupName`, `groupEmoji`) so the derivation is identical.
 */

import React, { useMemo } from 'react';
import { useTheme } from '../components/ThemeProvider';
import { SessionList } from '../components/SessionList';
import type { Session, GroupInfo } from '../hooks/useSessions';

interface DesktopSidebarProps {
	sessions: Session[];
	activeSessionId: string | null;
	onSelectSession: (sessionId: string) => void;
	isSmallScreen: boolean;
}

export function DesktopSidebar({
	sessions,
	activeSessionId,
	onSelectSession,
	isSmallScreen,
}: DesktopSidebarProps) {
	const { theme } = useTheme();

	const sessionsByGroup = useMemo((): Record<string, GroupInfo> => {
		const groups: Record<string, GroupInfo> = {};
		for (const session of sessions) {
			const groupKey = session.groupId || 'ungrouped';
			if (!groups[groupKey]) {
				groups[groupKey] = {
					id: session.groupId || null,
					name: session.groupName || 'Ungrouped',
					emoji: session.groupEmoji || null,
					sessions: [],
				};
			}
			groups[groupKey].sessions.push(session);
		}
		return groups;
	}, [sessions]);

	if (isSmallScreen) return null;

	return (
		<SessionList
			theme={theme}
			sessions={sessions}
			sessionsByGroup={sessionsByGroup}
			activeSessionId={activeSessionId}
			onSelectSession={onSelectSession}
		/>
	);
}
