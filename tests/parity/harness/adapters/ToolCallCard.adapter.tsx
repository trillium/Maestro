/**
 * ToolCallCard — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete
 * React element. The catalog file
 * (`src/webFull/components/ToolCallCard.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * ToolCallCard is a presentational tool-execution card — pure UI
 * primitive, no IPC, no LayerStack hook usage. Local `useState`
 * drives the expand/collapse toggle. The catalog has both
 * default-collapsed and `defaultExpanded={true}` arms — the adapter
 * sets the prop directly per story; no click driver needed because
 * the catalog does not require a runtime click to land on the
 * expanded state (it uses `defaultExpanded={true}` as the contract).
 *
 * The `empty-array` negative-path story (`renders-nothing-when-tooluse-empty-array`)
 * relies on the renderer's early `return null` — the adapter passes
 * `toolUse={[]}` and the catalog's `body:not(:has(button))`
 * absence assertion holds.
 */

import type { ReactElement } from 'react';
import { ToolCallCard } from '../../../../src/webFull/components/ToolCallCard';
import { toolCallCardParityCatalog } from '../../../../src/webFull/components/ToolCallCard.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'tool-call-card-collapsed-renders-tool-name-chip-and-show-more':
			return (
				<ToolCallCard theme={theme} toolUse={[{ name: 'Bash', state: { status: 'completed' } }]} />
			);

		case 'tool-call-card-expanded-renders-collapse-and-status-row':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[
						{
							name: 'Write',
							state: { status: 'completed', input: { path: '/tmp/x' }, output: 'ok' },
						},
					]}
					defaultExpanded={true}
					timestamp="12:34:56"
				/>
			);

		case 'tool-call-card-honours-opencode-tool-key-as-well-as-claude-name-key':
			return (
				<ToolCallCard theme={theme} toolUse={[{ tool: 'edit', state: { status: 'success' } }]} />
			);

		case 'tool-call-card-expanded-renders-input-and-output-section-labels':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[
						{
							name: 'Read',
							state: {
								status: 'completed',
								input: { path: '/etc/hosts' },
								output: { lines: 12 },
							},
						},
					]}
					defaultExpanded={true}
				/>
			);

		case 'tool-call-card-collapsed-default-without-timestamp-omits-time-row':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[{ name: 'Glob', state: { status: 'completed' } }]}
					defaultExpanded={true}
				/>
			);

		case 'tool-call-card-renders-nothing-when-tooluse-empty-array':
			return <ToolCallCard theme={theme} toolUse={[]} />;

		case 'tool-call-card-collapsed-omits-collapse-affordance':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[{ name: 'Bash', state: { status: 'completed' } }]}
					defaultExpanded={false}
				/>
			);

		case 'tool-call-card-falls-back-to-unknown-when-both-name-keys-missing':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[{ state: { status: 'completed' } }]}
					defaultExpanded={false}
				/>
			);

		case 'tool-call-card-does-not-render-modal-or-banner-chrome':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[{ name: 'Bash', state: { status: 'completed' } }]}
					defaultExpanded={true}
				/>
			);

		case 'tool-call-card-fires-no-ipc-or-websocket-traffic-on-mount-or-toggle':
			// Presentational-only guard story. The assertion is just `Tool: Bash`
			// against `span` — render the collapsed pill.
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[
						{
							name: 'Bash',
							state: { status: 'completed', input: { cmd: 'ls' }, output: 'a\nb\nc' },
						},
					]}
					defaultExpanded={false}
				/>
			);

		case 'tool-call-card-status-error-still-renders-tool-chip':
			return (
				<ToolCallCard
					theme={theme}
					toolUse={[{ name: 'Bash', state: { status: 'error', output: 'exit 1' } }]}
					defaultExpanded={true}
				/>
			);

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: toolCallCardParityCatalog as ParityStory[],
	render,
};

export default adapter;
