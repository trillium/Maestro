/**
 * WizardResumeModal.tsx (webFull lift — Phase 2 medium-IPC)
 *
 * Lifted from `src/renderer/components/Wizard/WizardResumeModal.tsx` per
 * `ISC-44.lift.wizard_resume_modal_lifted`. Behavior parity with the renderer
 * source; only the IPC seams change.
 *
 * IPC swaps:
 *
 *   1. `window.maestro.git.isRepo(directoryPath, sshRemoteId?, remoteCwd?)`
 *      → `GET /api/git/is-repo?cwd=<absolute>` (shipped in commit `aae40965f`,
 *      `ISC-44.server.api_git_cluster`). The webFull-side route is LOCAL-ONLY
 *      (returns 501 when `sshRemoteId` is supplied), so the SSH-remote branch
 *      of the renderer's `isRepo` call is dropped here: webFull cannot validate
 *      remote directories. For the resume-validation use case this is acceptable
 *      — local directories validate correctly, and a resume against a remote
 *      directory simply degrades to "assume invalid" (the renderer source's
 *      `.catch` branch also returns invalid on any failure). The renderer
 *      remains the SSH-aware path.
 *
 *   2. `window.maestro.agents.detect()` → `GET /api/agents/detected` reply
 *      `{agents, timestamp}`. The renderer side returns the agent array
 *      directly; the route wraps it. We unwrap `body.agents` to preserve the
 *      caller's expectation of an `AgentConfig[]`. Route is LOCAL-ONLY (501 on
 *      `sshRemoteId`).
 *
 * Cross-fork edges (type-only, established precedent):
 *
 *   - `AgentConfig` from `'../../../renderer/types'` — pure data shape.
 *   - `SerializableWizardState, WizardStep, STEP_INDEX, WIZARD_TOTAL_STEPS`
 *     from `'../../../renderer/components/Wizard/WizardContext'` — types +
 *     constants only; no runtime hook crossing.
 *
 * No host wiring; this lift makes the surface available in webFull without
 * yet mounting it. Phase 3 will mount the wizard orchestrator.
 */

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, FolderOpen, AlertTriangle, Bot } from 'lucide-react';
import type { Theme } from '../../../shared/theme-types';
import type { AgentConfig } from '../../../renderer/types';
import { useLayerStack } from '../../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import {
	STEP_INDEX,
	WIZARD_TOTAL_STEPS,
	type SerializableWizardState,
	type WizardStep,
} from '../../../renderer/components/Wizard/WizardContext';
import { buildApiUrl } from '../../utils/config';

interface WizardResumeModalProps {
	theme: Theme;
	resumeState: SerializableWizardState;
	onResume: (options?: { directoryInvalid?: boolean; agentInvalid?: boolean }) => void;
	onStartFresh: () => void;
	onClose: () => void;
}

/**
 * Get a human-readable description of the wizard step
 */
function getStepDescription(step: WizardStep): string {
	switch (step) {
		case 'agent-selection':
			return 'Agent Selection';
		case 'directory-selection':
			return 'Directory Selection';
		case 'conversation':
			return 'Project Discovery';
		case 'preparing-plan':
			return 'Preparing Playbooks';
		case 'phase-review':
			return 'Phase Review';
		default:
			return 'Setup';
	}
}

/**
 * Get progress percentage based on step
 */
function getProgressPercentage(step: WizardStep): number {
	return ((STEP_INDEX[step] - 1) / (WIZARD_TOTAL_STEPS - 1)) * 100;
}

/**
 * Fetch helper — replacement for `window.maestro.git.isRepo(cwd, ...)`.
 *
 * Local-only (matches the server route's contract). The SSH-remote branch of
 * the renderer call is intentionally NOT supported here — webFull validates
 * local directories only. Returns the boolean on success; throws on HTTP
 * error so the caller's `.catch` branch fires (matching the renderer
 * Promise's throw-on-error semantic).
 */
async function fetchIsRepo(cwd: string): Promise<boolean> {
	const url = buildApiUrl('/git/is-repo') + `?cwd=${encodeURIComponent(cwd)}`;
	const res = await fetch(url);
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(text || `HTTP ${res.status}`);
	}
	const body = (await res.json()) as { isRepo: boolean; timestamp: number };
	return body.isRepo;
}

/**
 * Fetch helper — replacement for `window.maestro.agents.detect()`.
 *
 * Unwraps the `{agents, timestamp}` envelope to the bare array shape the
 * renderer's IPC reply returned (so the existing caller surface
 * `agents.filter(...)` works unchanged).
 */
async function fetchDetectAgents(): Promise<AgentConfig[]> {
	const res = await fetch(buildApiUrl('/agents/detected'));
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(text || `HTTP ${res.status}`);
	}
	const body = (await res.json()) as { agents: AgentConfig[]; timestamp: number };
	return body.agents;
}

export function WizardResumeModal({
	theme,
	resumeState,
	onResume,
	onStartFresh,
	onClose,
}: WizardResumeModalProps) {
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();
	const resumeButtonRef = useRef<HTMLButtonElement>(null);
	const [focusedButton, setFocusedButton] = useState<'resume' | 'fresh'>('resume');
	const [directoryValid, setDirectoryValid] = useState<boolean | null>(null);
	const [agentValid, setAgentValid] = useState<boolean | null>(null);
	const [isValidating, setIsValidating] = useState(false);

	// Validate directory path and agent availability on mount
	useEffect(() => {
		let mounted = true;

		async function validateResumeState() {
			setIsValidating(true);

			// Validate directory if present
			let dirValid = true;
			if (resumeState.directoryPath) {
				try {
					// Use git is-repo which will fail if directory doesn't exist.
					// webFull is local-only — the SSH-remote branch from the renderer
					// source is dropped per the docblock above.
					await fetchIsRepo(resumeState.directoryPath);
				} catch {
					// Directory doesn't exist or is inaccessible
					dirValid = false;
				}
			}

			// Validate agent is still available
			let agentAvailable = true;
			if (resumeState.selectedAgent) {
				try {
					const agents = await fetchDetectAgents();
					// Filter out hidden agents (like terminal)
					const visibleAgents = agents.filter((a: AgentConfig) => !a.hidden);
					// Check if the selected agent is available
					const selectedAgentConfig = visibleAgents.find(
						(a: AgentConfig) => a.id === resumeState.selectedAgent && a.available
					);
					agentAvailable = !!selectedAgentConfig;
				} catch {
					// If agent detection fails, assume agent is not available
					agentAvailable = false;
				}
			}

			if (mounted) {
				setDirectoryValid(dirValid);
				setAgentValid(agentAvailable);
				setIsValidating(false);
			}
		}

		validateResumeState();
		return () => {
			mounted = false;
		};
	}, [resumeState.directoryPath, resumeState.selectedAgent]);

	// Focus resume button on mount
	useEffect(() => {
		resumeButtonRef.current?.focus();
	}, []);

	// Register layer on mount
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.WIZARD_RESUME,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Resume Setup Wizard',
			onEscape: onClose,
		});
		layerIdRef.current = id;
		return () => {
			if (layerIdRef.current) {
				unregisterLayer(layerIdRef.current);
			}
		};
	}, [registerLayer, unregisterLayer]);

	// Update handler when dependencies change
	useEffect(() => {
		if (layerIdRef.current) {
			updateLayerHandler(layerIdRef.current, onClose);
		}
	}, [onClose, updateLayerHandler]);

	// Handle resume click with validation status
	const handleResume = () => {
		onResume({
			directoryInvalid: directoryValid === false,
			agentInvalid: agentValid === false,
		});
	};

	// Handle keyboard navigation between buttons
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Tab') {
			e.preventDefault();
			setFocusedButton(focusedButton === 'resume' ? 'fresh' : 'resume');
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			setFocusedButton(focusedButton === 'resume' ? 'fresh' : 'resume');
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (focusedButton === 'resume') {
				handleResume();
			} else {
				onStartFresh();
			}
		}
	};

	// Auto-focus the correct button when focusedButton changes
	useEffect(() => {
		if (focusedButton === 'resume') {
			resumeButtonRef.current?.focus();
		}
	}, [focusedButton]);

	const progressPercentage = getProgressPercentage(resumeState.currentStep);
	const stepDescription = getStepDescription(resumeState.currentStep);

	return (
		<div
			className="fixed inset-0 modal-overlay flex items-center justify-center z-[10000] animate-in fade-in duration-200"
			role="dialog"
			aria-modal="true"
			aria-label="Resume Setup Wizard"
			tabIndex={-1}
			onKeyDown={handleKeyDown}
		>
			<div
				className="w-[480px] border rounded-xl shadow-2xl overflow-hidden"
				style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}
			>
				{/* Header */}
				<div className="p-5 border-b" style={{ borderColor: theme.colors.border }}>
					<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
						Resume Setup?
					</h2>
					<p className="text-sm mt-1" style={{ color: theme.colors.textDim }}>
						You have an incomplete project setup in progress.
					</p>
				</div>

				{/* Progress Summary */}
				<div className="p-5 space-y-4">
					{/* Progress bar */}
					<div>
						<div className="flex justify-between mb-2">
							<span className="text-xs font-medium" style={{ color: theme.colors.textDim }}>
								Progress
							</span>
							<span className="text-xs font-medium" style={{ color: theme.colors.accent }}>
								Step {STEP_INDEX[resumeState.currentStep]} of {WIZARD_TOTAL_STEPS}
							</span>
						</div>
						<div
							className="h-2 rounded-full overflow-hidden"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							<div
								className="h-full rounded-full transition-all duration-500"
								style={{
									backgroundColor: theme.colors.accent,
									width: `${progressPercentage}%`,
								}}
							/>
						</div>
					</div>

					{/* Saved state summary */}
					<div
						className="rounded-lg p-4 space-y-3"
						style={{ backgroundColor: theme.colors.bgActivity }}
					>
						<div className="flex items-center gap-3">
							<div
								className="w-8 h-8 rounded-lg flex items-center justify-center"
								style={{ backgroundColor: theme.colors.accent + '20' }}
							>
								<FolderOpen className="w-4 h-4" style={{ color: theme.colors.accent }} />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-xs" style={{ color: theme.colors.textDim }}>
									Current Step
								</p>
								<p
									className="text-sm font-medium truncate"
									style={{ color: theme.colors.textMain }}
								>
									{stepDescription}
								</p>
							</div>
						</div>

						{resumeState.agentName && (
							<div className="flex items-start gap-3">
								<div className="w-8" />
								<div>
									<p className="text-xs" style={{ color: theme.colors.textDim }}>
										Project Name
									</p>
									<p className="text-sm" style={{ color: theme.colors.textMain }}>
										{resumeState.agentName}
									</p>
								</div>
							</div>
						)}

						{resumeState.selectedAgent && (
							<div className="flex items-start gap-3">
								<div className="w-8" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="text-xs" style={{ color: theme.colors.textDim }}>
											AI Agent
										</p>
										{isValidating && (
											<div
												className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
												style={{ borderColor: theme.colors.accent, borderTopColor: 'transparent' }}
											/>
										)}
									</div>
									<div className="flex items-center gap-2">
										<Bot
											className="w-3.5 h-3.5"
											style={{
												color: agentValid === false ? theme.colors.error : theme.colors.accent,
											}}
										/>
										<p
											className="text-sm"
											style={{
												color: agentValid === false ? theme.colors.error : theme.colors.textMain,
											}}
										>
											{resumeState.selectedAgent === 'claude-code'
												? 'Claude Code'
												: resumeState.selectedAgent}
										</p>
									</div>
									{agentValid === false && (
										<div className="flex items-center gap-1.5 mt-1">
											<AlertTriangle
												className="w-3 h-3 flex-shrink-0"
												style={{ color: theme.colors.warning }}
											/>
											<p className="text-xs" style={{ color: theme.colors.warning }}>
												Agent no longer available — you'll need to select a different agent
											</p>
										</div>
									)}
								</div>
							</div>
						)}

						{resumeState.directoryPath && (
							<div className="flex items-start gap-3">
								<div className="w-8" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="text-xs" style={{ color: theme.colors.textDim }}>
											Directory
										</p>
										{isValidating && (
											<div
												className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
												style={{ borderColor: theme.colors.accent, borderTopColor: 'transparent' }}
											/>
										)}
									</div>
									<p
										className="text-sm font-mono truncate"
										style={{
											color: directoryValid === false ? theme.colors.error : theme.colors.textMain,
										}}
										title={resumeState.directoryPath}
									>
										{resumeState.directoryPath}
									</p>
									{directoryValid === false && (
										<div className="flex items-center gap-1.5 mt-1">
											<AlertTriangle
												className="w-3 h-3 flex-shrink-0"
												style={{ color: theme.colors.warning }}
											/>
											<p className="text-xs" style={{ color: theme.colors.warning }}>
												Directory no longer exists — you'll need to select a new location
											</p>
										</div>
									)}
								</div>
							</div>
						)}

						{resumeState.conversationHistory.length > 0 && (
							<div className="flex items-start gap-3">
								<div className="w-8" />
								<div>
									<p className="text-xs" style={{ color: theme.colors.textDim }}>
										Conversation Progress
									</p>
									<p className="text-sm" style={{ color: theme.colors.textMain }}>
										{resumeState.conversationHistory.length} messages exchanged
										{resumeState.confidenceLevel > 0 &&
											` (${resumeState.confidenceLevel}% confidence)`}
									</p>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Actions */}
				<div className="p-5 pt-0 space-y-3">
					<button
						ref={resumeButtonRef}
						onClick={handleResume}
						onFocus={() => setFocusedButton('resume')}
						disabled={isValidating}
						className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all duration-200 outline-none"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
							opacity: isValidating ? 0.7 : 1,
							boxShadow:
								focusedButton === 'resume'
									? `0 0 0 2px ${theme.colors.bgSidebar}, 0 0 0 4px ${theme.colors.accent}`
									: 'none',
						}}
					>
						{isValidating ? (
							<>
								<div
									className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
									style={{
										borderColor: theme.colors.accentForeground,
										borderTopColor: 'transparent',
									}}
								/>
								Checking...
							</>
						) : (
							<>
								<RefreshCw className="w-4 h-4" />
								Resume Where I Left Off
							</>
						)}
					</button>

					<button
						onClick={onStartFresh}
						onFocus={() => setFocusedButton('fresh')}
						className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-medium border transition-all duration-200 outline-none hover:bg-white/5"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							boxShadow:
								focusedButton === 'fresh'
									? `0 0 0 2px ${theme.colors.bgSidebar}, 0 0 0 4px ${theme.colors.accent}`
									: 'none',
						}}
					>
						<RotateCcw className="w-4 h-4" />
						Start Fresh
					</button>

					{/* Keyboard hints */}
					<p className="text-center text-xs pt-2" style={{ color: theme.colors.textDim }}>
						Press{' '}
						<kbd
							className="px-1.5 py-0.5 rounded text-[10px] font-mono"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							Tab
						</kbd>{' '}
						to switch,{' '}
						<kbd
							className="px-1.5 py-0.5 rounded text-[10px] font-mono"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							Enter
						</kbd>{' '}
						to confirm
					</p>
				</div>
			</div>
		</div>
	);
}
