/**
 * Parity Harness Registry
 *
 * Each registered component exposes:
 *   - `catalog`: the array of ParityStory objects from `<Component>.parity.test.ts`
 *   - `render(story)`: a function returning the React element to mount for the
 *     given story's `given`/`when` setup. The catalog file describes the spec;
 *     the adapter is the one place a human teaches the harness HOW to translate
 *     a particular story's prose `given` into concrete props.
 *
 * Adapters are intentionally one-per-component (not one-per-story) because the
 * catalogs already encode the variation surface via the story metadata. The
 * adapter switches on `story.name` to vary props. Adding a new component is
 * additive (push another key to the object) and never touches the runner.
 */

import type { ReactElement } from 'react';

export interface ParityAssertion {
	verb: string;
	target: string;
	value?: string;
}

export interface ParityStory {
	name: string;
	given: string;
	when: string[];
	then: ParityAssertion[];
	happyPath: boolean;
}

export interface StorySpec {
	name: string;
	happyPath: boolean;
	then: ParityAssertion[];
}

export interface ComponentAdapter {
	/** Lazy-loaded adapter — keeps the harness cold-load fast. */
	load: () => Promise<{
		catalog: ParityStory[];
		render: (story: ParityStory) => ReactElement | null;
	}>;
}

export const registry: Record<string, ComponentAdapter> = {
	ContextWarningSash: {
		load: () => import('./adapters/ContextWarningSash.adapter').then((m) => m.default),
	},
	MaestroSilhouette: {
		load: () => import('./adapters/MaestroSilhouette.adapter').then((m) => m.default),
	},
	WelcomeContent: {
		load: () => import('./adapters/WelcomeContent.adapter').then((m) => m.default),
	},
	FontConfigurationPanel: {
		load: () => import('./adapters/FontConfigurationPanel.adapter').then((m) => m.default),
	},
	CollapsibleJsonViewer: {
		load: () => import('./adapters/CollapsibleJsonViewer.adapter').then((m) => m.default),
	},
	QRCode: {
		load: () => import('./adapters/QRCode.adapter').then((m) => m.default),
	},
	ToggleButtonGroup: {
		load: () => import('./adapters/ToggleButtonGroup.adapter').then((m) => m.default),
	},
	SettingCheckbox: {
		load: () => import('./adapters/SettingCheckbox.adapter').then((m) => m.default),
	},
	ThemePicker: {
		load: () => import('./adapters/ThemePicker.adapter').then((m) => m.default),
	},
	CsvTableRenderer: {
		load: () => import('./adapters/CsvTableRenderer.adapter').then((m) => m.default),
	},
	MarkdownRenderer: {
		load: () => import('./adapters/MarkdownRenderer.adapter').then((m) => m.default),
	},
	GroupChatHeader: {
		load: () => import('./adapters/GroupChatHeader.adapter').then((m) => m.default),
	},
	AgentErrorModal: {
		load: () => import('./adapters/AgentErrorModal.adapter').then((m) => m.default),
	},
	SessionList: {
		load: () => import('./adapters/SessionList.adapter').then((m) => m.default),
	},
	TabBar: {
		load: () => import('./adapters/TabBar.adapter').then((m) => m.default),
	},
	RenameTabModal: {
		load: () => import('./adapters/RenameTabModal.adapter').then((m) => m.default),
	},
	ResetTasksConfirmModal: {
		load: () => import('./adapters/ResetTasksConfirmModal.adapter').then((m) => m.default),
	},
	PlaybookDeleteConfirmModal: {
		load: () => import('./adapters/PlaybookDeleteConfirmModal.adapter').then((m) => m.default),
	},
	DeleteWorktreeModal: {
		load: () => import('./adapters/DeleteWorktreeModal.adapter').then((m) => m.default),
	},
	DeleteGroupChatModal: {
		load: () => import('./adapters/DeleteGroupChatModal.adapter').then((m) => m.default),
	},
	HistoryHelpModal: {
		load: () => import('./adapters/HistoryHelpModal.adapter').then((m) => m.default),
	},
	AutoRunnerHelpModal: {
		load: () => import('./adapters/AutoRunnerHelpModal.adapter').then((m) => m.default),
	},
	QueuedItemsList: {
		load: () => import('./adapters/QueuedItemsList.adapter').then((m) => m.default),
	},
	ToolCallCard: {
		load: () => import('./adapters/ToolCallCard.adapter').then((m) => m.default),
	},
	FirstRunCelebration: {
		load: () => import('./adapters/FirstRunCelebration.adapter').then((m) => m.default),
	},
	CreateGroupModal: {
		load: () => import('./adapters/CreateGroupModal.adapter').then((m) => m.default),
	},
	DeleteAgentConfirmModal: {
		load: () => import('./adapters/DeleteAgentConfirmModal.adapter').then((m) => m.default),
	},
	RenameGroupChatModal: {
		load: () => import('./adapters/RenameGroupChatModal.adapter').then((m) => m.default),
	},
	RenameGroupModal: {
		load: () => import('./adapters/RenameGroupModal.adapter').then((m) => m.default),
	},
	PlaybookNameModal: {
		load: () => import('./adapters/PlaybookNameModal.adapter').then((m) => m.default),
	},
};
