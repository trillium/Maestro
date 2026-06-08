/**
 * AgentErrorModal — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/AgentErrorModal.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * AgentErrorModal composes the L2.1 `Modal` primitive, which calls
 * `useModalLayer(...)` under the hood. That hook reaches into
 * `LayerStackContext`, so EVERY story in this adapter is wrapped in a
 * `<LayerStackProvider>`. Without the provider, `useLayerStack()` throws
 * "useLayerStack must be used within a LayerStackProvider" before the
 * modal even paints.
 *
 * The Escape-to-close story is driven via a small `EscapeDriver` wrapper:
 * mounts the modal inside the provider, fires a synthetic Escape key on
 * `window` after the first paint, then forces an unmount the way the
 * provider's `closeTopLayer()` would by holding the open state in local
 * React state and flipping it false when `onDismiss` runs. The catalog
 * asserts `body:not(:has([role="dialog"]))` — i.e. the modal must be gone
 * after Escape, which is exactly what the layer stack's onEscape→onClose
 * pipeline produces.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AgentErrorModal } from '../../../../src/webFull/components/AgentErrorModal';
import { agentErrorModalParityCatalog } from '../../../../src/webFull/components/AgentErrorModal.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { AgentError } from '../../../../src/shared/types';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface ErrorOverrides {
	type?: AgentError['type'];
	message?: string;
	recoverable?: boolean;
	parsedJson?: unknown;
}

function makeError(overrides: ErrorOverrides = {}): AgentError {
	return {
		type: overrides.type ?? 'auth_expired',
		message: overrides.message ?? 'API key has expired',
		recoverable: overrides.recoverable ?? true,
		agentId: 'claude-code',
		timestamp: 1717_000_000_000,
		parsedJson: overrides.parsedJson,
	};
}

interface MountOpts {
	error: AgentError;
	agentName?: string;
	sessionName?: string;
	recoveryActions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
	dismissible?: boolean;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<AgentErrorModal
				theme={theme}
				error={props.error}
				agentName={props.agentName}
				sessionName={props.sessionName}
				recoveryActions={props.recoveryActions ?? []}
				onDismiss={noop}
				dismissible={props.dismissible}
			/>
		</LayerStackProvider>
	);
}

/**
 * Mounts the modal, dispatches a synthetic Escape on `window` after the
 * first paint, and removes the modal from the tree when `onDismiss` fires
 * — mirroring the layer-stack pipeline (Escape → closeTopLayer → onEscape
 * → onDismiss in the consumer). The provider's keydown listener attaches
 * in capture phase on `window`, so the dispatch target is also `window`.
 */
function EscapeDriver(): ReactElement | null {
	const [open, setOpen] = useState(true);
	const dispatchedRef = useRef(false);

	useEffect(() => {
		if (!open || dispatchedRef.current) return;
		const id = requestAnimationFrame(() => {
			dispatchedRef.current = true;
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		return () => cancelAnimationFrame(id);
	}, [open]);

	if (!open) return null;
	return (
		<LayerStackProvider>
			<AgentErrorModal
				theme={theme}
				error={makeError({ type: 'auth_expired', message: 'Re-auth required' })}
				recoveryActions={[
					{ id: 're-auth', label: 'Re-authenticate', primary: true, onClick: noop },
				]}
				onDismiss={() => setOpen(false)}
				dismissible={true}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'agent-error-modal-renders-auth-expired-title-and-message':
			return (
				<MountedModal
					error={makeError({ type: 'auth_expired', message: 'API key has expired' })}
					recoveryActions={[]}
				/>
			);

		case 'agent-error-modal-renders-agent-and-session-context-when-supplied':
			return (
				<MountedModal
					error={makeError({ type: 'token_exhaustion', message: 'Context window full' })}
					agentName="claude-code"
					sessionName="Morning Routine"
				/>
			);

		case 'agent-error-modal-renders-primary-recovery-action-button':
			return (
				<MountedModal
					error={makeError()}
					recoveryActions={[
						{ id: 're-auth', label: 'Re-authenticate', primary: true, onClick: noop },
						{ id: 'new-session', label: 'Start New Session', onClick: noop },
					]}
				/>
			);

		case 'agent-error-modal-shows-dismiss-row-when-dismissible':
			return (
				<MountedModal
					error={makeError()}
					recoveryActions={[{ id: 'retry', label: 'Retry', primary: true, onClick: noop }]}
					dismissible={true}
				/>
			);

		case 'agent-error-modal-exposes-json-details-toggle-when-parsedJson-present':
			return (
				<MountedModal
					error={makeError({ parsedJson: { code: 429, retryAfter: 60 } })}
					recoveryActions={[]}
				/>
			);

		case 'agent-error-modal-omits-agent-context-when-no-agentName-or-sessionName':
			return (
				<MountedModal
					error={makeError({ type: 'network_error', message: 'Network unreachable' })}
					recoveryActions={[]}
				/>
			);

		case 'agent-error-modal-omits-json-toggle-when-parsedJson-undefined':
			return <MountedModal error={makeError({ parsedJson: undefined })} recoveryActions={[]} />;

		case 'agent-error-modal-omits-dismiss-row-when-dismissible-false':
			return (
				<MountedModal
					error={makeError()}
					recoveryActions={[
						{ id: 're-auth', label: 'Re-authenticate', primary: true, onClick: noop },
					]}
					dismissible={false}
				/>
			);

		case 'agent-error-modal-falls-back-to-generic-title-for-unknown-type':
			return (
				<MountedModal
					error={makeError({ type: 'unknown', message: 'Something went wrong' })}
					recoveryActions={[]}
				/>
			);

		case 'agent-error-modal-escape-key-closes-when-dismissible':
			return <EscapeDriver />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: agentErrorModalParityCatalog as ParityStory[],
	render,
};

export default adapter;
