/**
 * SessionList — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/SessionList.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * SessionList renders the Left Bar. Most stories are pure mount-and-assert
 * (list rendering, active highlight, bookmarks section, ungrouped folder,
 * empty state). The one interactive story (`collapses-a-group-on-header-
 * click`) is driven via a small `GroupCollapseDriver` wrapper that
 * dispatches a synthetic click on the "Work" group header on first paint —
 * mirroring the `DismissalDriver` pattern used by ContextWarningSash.
 *
 * Stories whose `then[]` includes a backend verb (`broadcast`) are routed
 * by the executor's `usesBackendVerb` skip check, so no adapter mapping is
 * required for those — they show up in the report as
 * `[skipped: backend verbs not yet wired]`. The catalog itself stays the
 * source of truth.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { SessionList, type SessionListProps } from '../../../../src/webFull/components/SessionList';
import { sessionListParityCatalog } from '../../../../src/webFull/components/SessionList.parity.test';
import type { Session, GroupInfo } from '../../../../src/webFull/hooks/useSessions';
import { ThemeProvider } from '../../../../src/webFull/components/ThemeProvider';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

// --- Session factory --------------------------------------------------------
//
// Each story spells its sessions in prose ("alpha idle, beta busy, gamma
// connecting"). We materialise those into Session shapes that match the
// hook contract — `id`, `name`, `toolType`, `state`, `inputMode`, `cwd`,
// plus optional bookmark / group fields.

interface SessionStub {
	id: string;
	name: string;
	state: string;
	bookmarked?: boolean;
	groupId?: string | null;
}

function session(stub: SessionStub): Session {
	return {
		id: stub.id,
		name: stub.name,
		toolType: 'claude-code',
		state: stub.state,
		inputMode: 'ai',
		cwd: '/tmp/parity',
		bookmarked: stub.bookmarked,
		groupId: stub.groupId ?? null,
	};
}

function group(id: string, name: string, emoji: string | null, sessions: Session[]): GroupInfo {
	return { id, name, emoji, sessions };
}

function ungroupedGroup(sessions: Session[]): GroupInfo {
	return { id: null, name: 'Ungrouped', emoji: null, sessions };
}

interface ListOpts {
	sessions: Session[];
	sessionsByGroup: Record<string, GroupInfo>;
	activeSessionId?: string | null;
}

function list(opts: ListOpts): ReactElement {
	const props: SessionListProps = {
		theme,
		sessions: opts.sessions,
		sessionsByGroup: opts.sessionsByGroup,
		activeSessionId: opts.activeSessionId ?? null,
		onSelectSession: noop,
	};
	// SessionListItem renders <StatusDot> from Badge.tsx, which calls
	// useTheme() (via useThemeColors() inside Badge). Without a provider
	// the dot throws "useTheme must be used within a ThemeProvider" before
	// the row paints. Wrap unconditionally — themed prop pass-through is
	// still SessionList's contract; the provider just satisfies the
	// downstream hook surface.
	return <ThemeProvider theme={theme}>{<SessionList {...props} />}</ThemeProvider>;
}

/**
 * Drives the group-collapse story. Mounts the list with group "Work"
 * expanded, fires a synthetic click on the Work group's collapse button
 * on first paint, then defers to the component's local state machine to
 * flip `aria-expanded` to false. The catalog asserts the post-click DOM.
 */
function GroupCollapseDriver({ baseProps }: { baseProps: SessionListProps }): ReactElement {
	const clickedRef = useRef(false);

	useEffect(() => {
		if (clickedRef.current) return;
		const id = requestAnimationFrame(() => {
			const headerBtn = document.querySelector<HTMLButtonElement>(
				'[aria-label="Group Work"] button[aria-expanded="true"]'
			);
			if (headerBtn) {
				headerBtn.click();
				clickedRef.current = true;
			}
		});
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<ThemeProvider theme={theme}>
			<SessionList {...baseProps} />
		</ThemeProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'session-list-renders-each-session-as-a-selectable-option': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle' });
			const beta = session({ id: 'beta-id', name: 'beta', state: 'busy' });
			const gamma = session({ id: 'gamma-id', name: 'gamma', state: 'connecting' });
			return list({
				sessions: [alpha, beta, gamma],
				sessionsByGroup: { ungrouped: ungroupedGroup([alpha, beta, gamma]) },
				activeSessionId: null,
			});
		}

		case 'session-list-marks-the-active-session-with-aria-selected-and-data-active': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle' });
			const beta = session({ id: 'beta-id', name: 'beta', state: 'idle' });
			return list({
				sessions: [alpha, beta],
				sessionsByGroup: { ungrouped: ungroupedGroup([alpha, beta]) },
				activeSessionId: 'beta-id',
			});
		}

		case 'session-list-renders-groups-with-collapsible-headers': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle', groupId: 'work-id' });
			const beta = session({ id: 'beta-id', name: 'beta', state: 'idle', groupId: 'work-id' });
			const gamma = session({ id: 'gamma-id', name: 'gamma', state: 'idle', groupId: 'play-id' });
			return list({
				sessions: [alpha, beta, gamma],
				sessionsByGroup: {
					'work-id': group('work-id', 'Work', '🏗️', [alpha, beta]),
					'play-id': group('play-id', 'Play', '🎮', [gamma]),
				},
				activeSessionId: null,
			});
		}

		case 'session-list-collapses-a-group-on-header-click': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle', groupId: 'work-id' });
			const beta = session({ id: 'beta-id', name: 'beta', state: 'idle', groupId: 'work-id' });
			const baseProps: SessionListProps = {
				theme,
				sessions: [alpha, beta],
				sessionsByGroup: { 'work-id': group('work-id', 'Work', '🏗️', [alpha, beta]) },
				activeSessionId: null,
				onSelectSession: noop,
			};
			return <GroupCollapseDriver baseProps={baseProps} />;
		}

		case 'session-list-shows-bookmarks-section-only-when-bookmarked-sessions-exist': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle', bookmarked: true });
			const beta = session({ id: 'beta-id', name: 'beta', state: 'idle', bookmarked: false });
			const gamma = session({ id: 'gamma-id', name: 'gamma', state: 'idle', bookmarked: true });
			return list({
				sessions: [alpha, beta, gamma],
				sessionsByGroup: { ungrouped: ungroupedGroup([alpha, beta, gamma]) },
				activeSessionId: null,
			});
		}

		case 'session-list-shows-ungrouped-agents-folder-when-groups-and-ungrouped-coexist': {
			const alpha = session({ id: 'alpha-id', name: 'alpha', state: 'idle', groupId: 'work-id' });
			const loose = session({ id: 'loose-id', name: 'loose', state: 'idle' });
			return list({
				sessions: [alpha, loose],
				sessionsByGroup: {
					'work-id': group('work-id', 'Work', '🏗️', [alpha]),
					ungrouped: ungroupedGroup([loose]),
				},
				activeSessionId: null,
			});
		}

		case 'session-list-shows-empty-state-when-no-sessions-exist':
			return list({
				sessions: [],
				sessionsByGroup: {},
				activeSessionId: null,
			});

		case 'session-list-falls-back-to-error-status-for-unknown-states': {
			const weird = session({ id: 'weird-id', name: 'weird', state: 'dead' });
			return list({
				sessions: [weird],
				sessionsByGroup: { ungrouped: ungroupedGroup([weird]) },
				activeSessionId: null,
			});
		}

		// Backend-verb stories ('broadcast') are routed to the
		// `usesBackendVerb` skip path by the runner; the executor never
		// invokes `render()` for them, so we don't need an arm here. If a
		// new story uses only `hasElement`/`hasText` and lands without an
		// arm, the `default` branch surfaces it as a deliberate failure.
		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: sessionListParityCatalog as ParityStory[],
	render,
};

export default adapter;
