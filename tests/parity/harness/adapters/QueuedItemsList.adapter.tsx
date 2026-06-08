/**
 * QueuedItemsList — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete
 * React element. The catalog file
 * (`src/webFull/components/QueuedItemsList.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * QueuedItemsList is a presentational queue panel — pure UI primitive,
 * no IPC, no LayerStack hook usage. The in-component confirmation
 * modal is a plain `<div>` overlay gated behind a `queueRemoveConfirmId`
 * useState (NOT a layer-stack registered dialog) — so no
 * `<LayerStackProvider>` wrap is required for any story.
 *
 * Two adapter shapes:
 *   - Direct render for static-state stories (queue contents, image
 *     indicator, show-all toggle, empty-queue branch, activeTabId
 *     filter, singular/plural copy).
 *   - <RemoveClickDriver> wrapper for the one story
 *     (`confirmation-modal-surfaces-prompt-and-action-buttons`) that
 *     requires clicking the X Remove button on first paint to surface
 *     the confirmation modal body copy. Mirrors the ContextWarningSash
 *     `DismissalDriver` pattern.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import {
	QueuedItemsList,
	type QueuedItem,
} from '../../../../src/webFull/components/QueuedItemsList';
import { queuedItemsListParityCatalog } from '../../../../src/webFull/components/QueuedItemsList.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

/**
 * Drives the confirmation-modal story. Mounts the list with one
 * removable item, then synthesises a click on the Remove (X) button
 * on first paint so the in-component confirmation modal renders.
 * The catalog asserts the modal copy (`Remove Queued Message?` +
 * `Cancel` + `Remove`) against `body`, which matches the modal-text
 * appearance after the click.
 */
function RemoveClickDriver({ executionQueue }: { executionQueue: QueuedItem[] }): ReactElement {
	const clickedRef = useRef(false);

	useEffect(() => {
		if (clickedRef.current) return;
		const id = requestAnimationFrame(() => {
			const removeBtn = document.querySelector<HTMLButtonElement>('[title="Remove from queue"]');
			if (removeBtn) {
				removeBtn.click();
				clickedRef.current = true;
			}
		});
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<QueuedItemsList executionQueue={executionQueue} theme={theme} onRemoveQueuedItem={noop} />
	);
}

function makeMessage(id: string, text: string, tabId = 'tab-A', images?: string[]): QueuedItem {
	return { id, tabId, type: 'message', text, images };
}

function makeCommand(id: string, command: string, tabId = 'tab-A'): QueuedItem {
	return { id, tabId, type: 'command', command };
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'queued-items-list-renders-queued-separator-with-count':
			return (
				<QueuedItemsList
					executionQueue={[
						makeMessage('m1', 'first'),
						makeCommand('c1', '/build'),
						makeMessage('m2', 'second'),
					]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-renders-message-text-and-command-text-per-item':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'hello world'), makeCommand('c1', '/commit')]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-exposes-remove-affordance-with-title-tooltip':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'one')]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-renders-show-all-toggle-when-message-exceeds-200-chars':
			// 250 characters across multiple lines so split('\n').length surfaces
			// the "Show all (N lines)" copy with N > 1.
			return (
				<QueuedItemsList
					executionQueue={[
						makeMessage(
							'm1',
							'a'.repeat(60) + '\n' + 'b'.repeat(60) + '\n' + 'c'.repeat(60) + '\n' + 'd'.repeat(70)
						),
					]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-renders-image-attachment-indicator-when-images-present':
			return (
				<QueuedItemsList
					executionQueue={[
						makeMessage('m1', 'see attached', 'tab-A', ['base64-blob-1', 'base64-blob-2']),
					]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-confirmation-modal-surfaces-prompt-and-action-buttons':
			return <RemoveClickDriver executionQueue={[makeMessage('m1', 'one')]} />;

		case 'queued-items-list-hidden-when-execution-queue-empty':
			return <QueuedItemsList executionQueue={[]} theme={theme} onRemoveQueuedItem={noop} />;

		case 'queued-items-list-hidden-when-activeTabId-filters-all-items-out':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'a', 'tab-A'), makeMessage('m2', 'b', 'tab-A')]}
					theme={theme}
					onRemoveQueuedItem={noop}
					activeTabId="tab-B"
				/>
			);

		case 'queued-items-list-suppresses-show-all-toggle-when-message-under-200-chars':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'short message')]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-suppresses-image-indicator-when-images-empty-or-absent':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'no images here')]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-fires-no-ipc-or-websocket-traffic-on-mount-or-remove-click':
			// Presentational-only guard story. Render the list with one item — the
			// catalog assertion targets `[title="Remove from queue"], body:not(:has([title]))`
			// which the mounted Remove button satisfies via the comma-OR selector
			// branch.
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'one')]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		case 'queued-items-list-renders-singular-image-indicator-when-exactly-one-image':
			return (
				<QueuedItemsList
					executionQueue={[makeMessage('m1', 'one img', 'tab-A', ['only-one-blob'])]}
					theme={theme}
					onRemoveQueuedItem={noop}
				/>
			);

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: queuedItemsListParityCatalog as ParityStory[],
	render,
};

export default adapter;
