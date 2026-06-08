/**
 * GroupChatHeader — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/GroupChatHeader.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * GroupChatHeader is pure presentation — every story is a mount-and-look
 * shape assertion against the rendered header. No DismissalDriver-style
 * wrapper is needed because none of the catalog stories require a follow-up
 * interaction.
 *
 * The component's `shortcuts` prop is typed `Record<string, Shortcut>`;
 * stories that exercise the right-panel toggle title need a valid
 * `toggleRightPanel` entry so `formatShortcutKeys(...)` resolves. Stories
 * that don't exercise the toggle still need the prop populated to satisfy
 * the type contract — a single-entry map covers both.
 */

import type { ReactElement } from 'react';
import { GroupChatHeader } from '../../../../src/webFull/components/GroupChatHeader';
import { groupChatHeaderParityCatalog } from '../../../../src/webFull/components/GroupChatHeader.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { Shortcut } from '../../../../src/renderer/types';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

const noop = () => {};

const shortcuts: Record<string, Shortcut> = {
	toggleRightPanel: {
		id: 'toggleRightPanel',
		label: 'Toggle Right Panel',
		keys: ['Meta', 'r'],
	},
};

interface BaseOpts {
	name?: string;
	participantCount?: number;
	totalCost?: number;
	costIncomplete?: boolean;
	state?: 'idle' | 'moderator-thinking' | 'agent-working';
	rightPanelOpen?: boolean;
}

function header(opts: BaseOpts): ReactElement {
	return (
		<GroupChatHeader
			theme={theme}
			name={opts.name ?? 'Planning Session'}
			participantCount={opts.participantCount ?? 3}
			totalCost={opts.totalCost}
			costIncomplete={opts.costIncomplete}
			state={opts.state ?? 'idle'}
			onStopAll={noop}
			onRename={noop}
			onShowInfo={noop}
			rightPanelOpen={opts.rightPanelOpen ?? false}
			onToggleRightPanel={noop}
			shortcuts={shortcuts}
		/>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'group-chat-header-renders-headline-and-rename-icon':
			return header({ name: 'Planning Session', participantCount: 3, state: 'idle' });

		case 'group-chat-header-participant-pill-pluralizes-for-multiple':
			return header({ participantCount: 3 });

		case 'group-chat-header-stop-all-surfaces-when-active':
			return header({ state: 'moderator-thinking' });

		case 'group-chat-header-cost-pill-renders-when-cost-positive':
			return header({ totalCost: 1.2345, costIncomplete: false });

		case 'group-chat-header-right-panel-toggle-surfaces-when-panel-closed':
			return header({ rightPanelOpen: false });

		case 'group-chat-header-stop-all-suppressed-when-idle':
			return header({ state: 'idle' });

		case 'group-chat-header-participant-pill-uses-singular-for-one':
			return header({ participantCount: 1 });

		case 'group-chat-header-cost-pill-suppressed-when-zero-or-undefined':
			return header({ totalCost: 0 });

		case 'group-chat-header-cost-pill-marks-incomplete-with-asterisk':
			return header({ totalCost: 2.5, costIncomplete: true });

		case 'group-chat-header-right-panel-toggle-suppressed-when-panel-open':
			return header({ rightPanelOpen: true });

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: groupChatHeaderParityCatalog as ParityStory[],
	render,
};

export default adapter;
