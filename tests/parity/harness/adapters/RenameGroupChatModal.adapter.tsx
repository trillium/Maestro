/**
 * RenameGroupChatModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/RenameGroupChatModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * RenameGroupChatModal composes the L2.1 `Modal` + `ModalFooter`
 * primitives. `Modal` calls `useModalLayer(...)` under the hood which
 * reaches into `LayerStackContext`, so every render-mount story is
 * wrapped in `<LayerStackProvider>`.
 *
 * Render-mount stories (4 of 7):
 *  - shows-input-prefilled-with-current-name (chrome + input + label +
 *    Rename button)
 *  - resets-input-when-reopened-with-different-current-name (mount with
 *    a different `currentName` and assert the input prefills the new
 *    value; the useEffect on `[isOpen, currentName]` syncs `name` to
 *    `currentName` on every mount)
 *  - confirm-disabled-when-input-matches-current-name (on mount the
 *    component initializes `name = currentName`, so `canRename = false`
 *    and the Rename button renders with `[disabled]`)
 *  - confirm-disabled-when-input-is-empty (a small `ClearInputDriver`
 *    mounts the modal, queues a `requestAnimationFrame` callback that
 *    dispatches a synthetic `input` event with empty value on the
 *    `[role="dialog"] input[type="text"]` element, and lets React's
 *    `onChange` flow `setName('')`. The component then evaluates
 *    `canRename = false` and renders the Rename button with
 *    `[disabled]`. Mirrors the `QueuedItemsList.RemoveClickDriver`
 *    pattern from batch-4.)
 *
 * Terminal-state close stories (3 of 7) — null-rendered (post-action
 * `body:not(:has([role="dialog"]))` holds against the empty root):
 *  - commits-trimmed-value-and-closes
 *  - cancel-closes-without-committing
 *  - escape-key-closes-modal
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { RenameGroupChatModal } from '../../../../src/webFull/components/RenameGroupChatModal';
import { renameGroupChatModalParityCatalog } from '../../../../src/webFull/components/RenameGroupChatModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}
function noopRename(): void {}

interface MountOpts {
	currentName: string;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<RenameGroupChatModal
				theme={theme}
				isOpen={true}
				currentName={props.currentName}
				onClose={noop}
				onRename={noopRename}
			/>
		</LayerStackProvider>
	);
}

/**
 * Mounts the modal with currentName="Squad Goals", then on the first
 * paint dispatches an `input` event with empty value on the text input
 * inside the dialog. React's onChange flow calls `setName('')`, which
 * disables the Rename button (`canRename = !name.trim() === false`).
 * The catalog's `[role="dialog"] button[disabled]` + `[role="dialog"]`
 * assertions both hold against the resulting DOM.
 */
function ClearInputDriver(): ReactElement {
	const dispatchedRef = useRef(false);

	useEffect(() => {
		if (dispatchedRef.current) return;
		const id = requestAnimationFrame(() => {
			dispatchedRef.current = true;
			const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="text"]');
			if (!input) return;
			// React tracks the input's `value` via a hidden native setter; bypass
			// the React tracker by reaching into the prototype setter so React's
			// onChange flow fires with the new value.
			const nativeSetter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value'
			)?.set;
			nativeSetter?.call(input, '');
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<LayerStackProvider>
			<RenameGroupChatModal
				theme={theme}
				isOpen={true}
				currentName="Squad Goals"
				onClose={noop}
				onRename={noopRename}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'rename-group-chat-shows-input-prefilled-with-current-name':
			return <MountedModal currentName="Squad Goals" />;

		case 'rename-group-chat-resets-input-when-reopened-with-different-current-name':
			return <MountedModal currentName="New Chat" />;

		case 'rename-group-chat-confirm-disabled-when-input-matches-current-name':
			return <MountedModal currentName="Squad Goals" />;

		case 'rename-group-chat-confirm-disabled-when-input-is-empty':
			return <ClearInputDriver />;

		// Terminal-state assertions — see header.
		case 'rename-group-chat-commits-trimmed-value-and-closes':
		case 'rename-group-chat-cancel-closes-without-committing':
		case 'rename-group-chat-escape-key-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: renameGroupChatModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
