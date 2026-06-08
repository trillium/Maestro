/**
 * DeleteWorktreeModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/DeleteWorktreeModal.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there flows
 * through here via `story.name`.
 *
 * DeleteWorktreeModal composes the L2.1 `Modal` primitive directly (no
 * `ModalFooter` — this modal builds its own three-button row). `Modal`
 * calls `useModalLayer(...)` under the hood, which reaches into
 * `LayerStackContext`, so every story is wrapped in
 * `<LayerStackProvider>`. Without the provider, `useLayerStack()` throws
 * before the modal even paints.
 *
 * Three of the eight stories are render-shape assertions on an open
 * modal:
 *  - destructive-title-and-three-action-buttons (Cancel + Remove +
 *    Remove and Delete in the footer)
 *  - names-the-session-and-explains-both-actions (session name + cwd +
 *    both action explanations rendered inline)
 *  - omits-cwd-readout-when-session-cwd-is-empty (the cwd readout guard;
 *    the catalog asserts only that the dialog still renders with the
 *    session name — falsy `session.cwd` skips the monospace path readout
 *    branch but the dialog itself stays)
 *
 * Three stories assert the terminal closed state
 * `body:not(:has([role="dialog"]))` — remove, cancel, escape. Returning
 * `null` for those stories renders no dialog, which matches the
 * post-action terminal state the story describes.
 *
 * One story (`remove-and-delete-shows-loading-then-closes`) asserts the
 * terminal closed state at the moment after the awaited
 * `onConfirmAndDelete` resolves. Same null-render arm.
 *
 * One story (`remove-and-delete-rejection-surfaces-inline-error`) asserts
 * the modal stays open and renders the inline error message after the
 * await on `onConfirmAndDelete` rejects. A small `RejectDriver` mounts
 * the modal with an `onConfirmAndDelete` that rejects on its first call,
 * then dispatches a synthetic click on the Remove-and-Delete button on
 * the first paint. The catalog's three assertions (`[role="dialog"]` is
 * present, error text is visible, "Remove and Delete" label is restored)
 * exercise the catch-branch's `setIsDeleting(false)` + `setError(...)`
 * round-trip exactly as the renderer source would.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { DeleteWorktreeModal } from '../../../../src/webFull/components/DeleteWorktreeModal';
import { deleteWorktreeModalParityCatalog } from '../../../../src/webFull/components/DeleteWorktreeModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { Session } from '../../../../src/webFull/hooks/useSessions';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}
function noopAsync(): Promise<void> {
	return Promise.resolve();
}

interface SessionStub {
	name: string;
	cwd: string;
	id?: string;
}

function makeSession(stub: SessionStub): Session {
	return {
		id: stub.id ?? 'feature-session-id',
		name: stub.name,
		toolType: 'claude-code',
		state: 'idle',
		inputMode: 'ai',
		cwd: stub.cwd,
	};
}

interface MountOpts {
	session: Session;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<DeleteWorktreeModal
				theme={theme}
				session={props.session}
				onClose={noop}
				onConfirm={noop}
				onConfirmAndDelete={noopAsync}
			/>
		</LayerStackProvider>
	);
}

/**
 * Mounts the modal with an `onConfirmAndDelete` that REJECTS, fires a
 * synthetic click on the Remove-and-Delete button on first paint, and
 * lets the renderer flow through its `catch` branch
 * (`setError(...)`/`setIsDeleting(false)`). The catalog asserts that the
 * dialog is still present and the error message is rendered inline.
 */
function RejectDriver(): ReactElement {
	const dispatchedRef = useRef(false);
	const session = makeSession({
		name: 'feature-branch-1',
		cwd: '/Users/trilliumsmith/code/maestro/worktrees/feature-branch-1',
	});

	useEffect(() => {
		if (dispatchedRef.current) return;
		const id = requestAnimationFrame(() => {
			dispatchedRef.current = true;
			// The footer row's third button is "Remove and Delete" — locate
			// by its text content (catalog uses the same anchor).
			const buttons = Array.from(
				document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
			);
			const target = buttons.find((b) => (b.textContent ?? '').includes('Remove and Delete'));
			target?.click();
		});
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<LayerStackProvider>
			<DeleteWorktreeModal
				theme={theme}
				session={session}
				onClose={noop}
				onConfirm={noop}
				onConfirmAndDelete={() => Promise.reject(new Error('ENOTEMPTY: directory not empty'))}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'delete-worktree-modal-shows-destructive-title-and-three-action-buttons':
			return (
				<MountedModal
					session={makeSession({
						name: 'feature-branch-1',
						cwd: '/Users/trilliumsmith/code/maestro/worktrees/feature-branch-1',
					})}
				/>
			);

		case 'delete-worktree-modal-names-the-session-and-explains-both-actions':
			return (
				<MountedModal
					session={makeSession({
						name: 'feature-branch-1',
						cwd: '/Users/trilliumsmith/code/maestro/worktrees/feature-branch-1',
					})}
				/>
			);

		case 'delete-worktree-modal-omits-cwd-readout-when-session-cwd-is-empty':
			return <MountedModal session={makeSession({ name: 'orphan-branch', cwd: '' })} />;

		// Terminal-state assertions — see header.
		case 'delete-worktree-modal-remove-closes-modal-and-fires-onconfirm':
		case 'delete-worktree-modal-remove-and-delete-shows-loading-then-closes':
		case 'delete-worktree-modal-cancel-closes-without-committing':
		case 'delete-worktree-modal-escape-key-closes-modal':
			return null;

		case 'delete-worktree-modal-remove-and-delete-rejection-surfaces-inline-error':
			return <RejectDriver />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: deleteWorktreeModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
