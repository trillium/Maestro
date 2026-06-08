/**
 * conversationManager.ts (webFull)
 *
 * Port of `src/renderer/components/Wizard/services/conversationManager.ts`
 * per Phase 3A of WIZARD_LIFT_PLAN.md.
 *
 * What changed vs. the renderer source:
 *
 * 1. `window.maestro.process.{spawn,kill,onData,onExit,onThinkingChunk,
 *    onToolExecution}` are routed through the WS process-lifecycle client
 *    defined in `src/webFull/services/processLifecycle.webfull.ts`. The
 *    client is injected via the module-level `setProcessLifecycleClient()`
 *    setter so the singleton `conversationManager` doesn't need a React
 *    context. The host (typically `App.tsx`) calls the setter once at
 *    mount time after building the lifecycle client from `useWebSocket().
 *    send`. Setter pattern mirrors the project Sentry policy — module-level
 *    init, called once, idempotent.
 *
 * 2. `window.maestro.agents.get(agentId)` has no REST equivalent today; the
 *    closest route is `GET /api/agents/detected` which returns the full
 *    detected list. Stubbed via `setAgentResolver()`. When unwired the
 *    sendMessage path surfaces the same "configuration not found" error
 *    the renderer would surface for a genuinely missing agent, matching
 *    the existing failure mode rather than introducing a new one. Phase 3B
 *    wiring should hand a real resolver (e.g. derived from the same
 *    `/api/agents/detected` list the screens use).
 *
 * 3. `wizardDebugLogger` is imported from a sibling Phase-1 leaf
 *    (`./wizardDebugLogger`) rather than transiting through `phaseGenerator`
 *    — see WIZARD_LIFT_PLAN.md §368 for the rationale.
 *
 * 4. `getStdinFlags` is imported from the webFull port at
 *    `src/webFull/utils/spawnHelpers.ts` (created in the same commit).
 *
 * Behaviour-equivalence guarantees:
 *
 * - Optional capability fields (`onThinkingChunk`, `onToolExecution`) are
 *   guarded with optional chaining (`?.`) on the renderer side; the
 *   processLifecycle client surfaces those methods as required (not
 *   optional) but the underlying frame is OPTIONAL — the server only
 *   emits them for agents that surface partial-thinking / structured-
 *   tool-execution. Per WIZARD_LIFT_PLAN.md §338, the call-site optional
 *   chaining is preserved with `?.` against the client itself for parity
 *   with the renderer shape — keeps the lift copy-paste-compatible.
 *
 * - Activity-based 20-minute inactivity timeout is verbatim.
 * - Stream-json output parsing (Claude Code result frames, OpenCode text
 *   parts, Codex agent_message/message frames) is verbatim.
 * - Cleanup ordering on session-end + early-resolve paths is verbatim.
 *
 * Stub list (count: 1):
 *   - `agents.get(agentId)` — defaults to returning `null` until a resolver
 *     is wired via `setAgentResolver()`. Surfaces a `console.warn` once
 *     so callers see it in dev.
 */

import type { ToolType, LogEntry } from '../../../../renderer/types';
import type { WizardMessage } from '../contexts/WizardContext';
import {
	generateSystemPrompt,
	parseStructuredOutput,
	formatUserMessage,
	isReadyToProceed,
	type StructuredAgentResponse,
	type ParsedResponse,
	type ExistingDocument,
	READY_CONFIDENCE_THRESHOLD,
} from './wizardPrompts';
import {
	detectWizardError,
	createGenericErrorMessage,
	type WizardError,
} from './wizardErrorDetection';
import { wizardDebugLogger } from './wizardDebugLogger';
import { getStdinFlags } from '../../../utils/spawnHelpers';
import type {
	ProcessLifecycleClient,
	ProcessSpawnConfig,
	ToolExecutionEvent,
} from '../../../services/processLifecycle.webfull';

// ---------------------------------------------------------------------------
// Host-injected dependencies — see file header section 1 + 2.
// ---------------------------------------------------------------------------

/**
 * Shape that the webFull lifecycle client honors. We type the binding as
 * `ProcessLifecycleClient` (the full surface) but the manager only uses
 * `spawn / kill / onData / onExit / onThinkingChunk / onToolExecution`
 * which are guaranteed by the contract in
 * `src/webFull/services/processLifecycle.webfull.ts`.
 */
let processLifecycleClient: ProcessLifecycleClient | null = null;

/**
 * Wire the WS process-lifecycle client. Call once at App mount with the
 * client built from `useWebSocket().send`. Pass `null` to detach
 * (e.g. during a forced WS reconnect that produces a new `send`).
 */
export function setProcessLifecycleClient(client: ProcessLifecycleClient | null): void {
	processLifecycleClient = client;
}

function requireProcessLifecycleClient(): ProcessLifecycleClient | null {
	if (!processLifecycleClient) {
		// Surface a warning on the first call so dev sees the missing wiring;
		// don't throw — the wizard surfaces its own error via the existing
		// `error` return path so the UX matches the "agent not configured"
		// case rather than crashing the host React tree.
		 
		console.warn(
			'[webFull] conversationManager: processLifecycleClient is not wired. Call setProcessLifecycleClient() from App.tsx after building the WS client.'
		);
	}
	return processLifecycleClient;
}

/**
 * Shape of the agent config the wizard consumes. Subset of the renderer's
 * `AgentConfig` to keep the contract minimal; matches what `window.maestro.
 * agents.get()` returns on the renderer side (defined at
 * `src/main/preload/agents.ts:39-47`).
 */
export interface WizardAgentInfo {
	id?: string;
	name?: string;
	command: string;
	path?: string;
	args?: string[];
	available?: boolean;
	capabilities?: {
		supportsStreamJsonInput?: boolean;
		[key: string]: unknown;
	};
	batchModeArgs?: string[];
	jsonOutputArgs?: string[];
	[key: string]: unknown;
}

/**
 * Resolver: given an agent id, return its runtime config (or null when
 * unknown). The default resolver returns `null` and logs a one-time warn —
 * Phase 3B should swap this for a real implementation backed by
 * `/api/agents/detected` (or a future `/api/agents/get/:id` route).
 */
export type AgentResolver = (agentId: ToolType) => Promise<WizardAgentInfo | null>;

let warnedAgentResolverMissing = false;
let agentResolver: AgentResolver = async () => {
	if (!warnedAgentResolverMissing) {
		warnedAgentResolverMissing = true;
		 
		console.warn(
			'[webFull] conversationManager: agentResolver not wired. Wire via setAgentResolver() from App.tsx. TODO: route /api/agents/get/:id (not yet implemented).'
		);
	}
	return null;
};

/**
 * Wire the agent resolver. Call once at App mount with a function that
 * resolves an agent id to its runtime config. Pass a no-op resolver to
 * reset (returns null → wizard surfaces "configuration not found").
 */
export function setAgentResolver(resolver: AgentResolver): void {
	agentResolver = resolver;
}

// ---------------------------------------------------------------------------
// Public types — unchanged from the renderer source.
// ---------------------------------------------------------------------------

/**
 * Configuration for starting a conversation
 */
export interface ConversationConfig {
	/** The agent type to use for the conversation */
	agentType: ToolType;
	/** The working directory for the agent */
	directoryPath: string;
	/** Project name (used in system prompt) */
	projectName: string;
	/** Existing Auto Run documents (when continuing from previous session) */
	existingDocs?: ExistingDocument[];
	/** SSH remote configuration (for remote execution) */
	sshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
	/** Whether the message was sent and response received successfully */
	success: boolean;
	/** The parsed agent response */
	response?: ParsedResponse;
	/** Error message if unsuccessful */
	error?: string;
	/** The raw output data (for debugging) */
	rawOutput?: string;
	/** Detected provider error (auth, rate limit, etc.) */
	detectedError?: WizardError;
}

/**
 * Callback type for receiving agent output chunks
 */
export type OutputChunkCallback = (chunk: string) => void;

/**
 * Callback type for conversation state changes
 */
export interface ConversationCallbacks {
	/** Called when a message is being sent */
	onSending?: () => void;
	/** Called when agent starts responding */
	onReceiving?: () => void;
	/** Called with partial output chunks (for streaming display) */
	onChunk?: OutputChunkCallback;
	/** Called with thinking content chunks from the AI (for showThinking display) */
	onThinkingChunk?: (content: string) => void;
	/** Called when a tool execution event is received (for showThinking display) */
	onToolExecution?: (toolEvent: { toolName: string; state?: unknown; timestamp: number }) => void;
	/** Called when response is complete */
	onComplete?: (result: SendMessageResult) => void;
	/** Called when an error occurs */
	onError?: (error: string) => void;
}

/**
 * State of an active conversation session
 */
interface ConversationSession {
	/** Unique session ID for this wizard conversation */
	sessionId: string;
	/** The agent type */
	agentType: ToolType;
	/** Working directory */
	directoryPath: string;
	/** Project name */
	projectName: string;
	/** Whether the agent process is active */
	isActive: boolean;
	/** System prompt used for this session */
	systemPrompt: string;
	/** Accumulated output buffer for parsing */
	outputBuffer: string;
	/** Resolve function for pending message */
	pendingResolve?: (result: SendMessageResult) => void;
	/** Callbacks for the conversation */
	callbacks?: ConversationCallbacks;
	/** Cleanup function for data listener */
	dataListenerCleanup?: () => void;
	/** Cleanup function for exit listener */
	exitListenerCleanup?: () => void;
	/** Cleanup function for thinking chunk listener */
	thinkingListenerCleanup?: () => void;
	/** Cleanup function for tool execution listener */
	toolExecutionListenerCleanup?: () => void;
	/** Timeout ID for response inactivity timeout (for cleanup) */
	responseTimeoutId?: ReturnType<typeof setTimeout>;
	/** Function to reset the inactivity timeout (called on activity) */
	resetResponseTimeout?: () => void;
	/** SSH remote configuration (for remote execution) */
	sshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
}

/**
 * Generate a unique session ID for wizard conversations
 */
function generateWizardSessionId(): string {
	return `wizard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * ConversationManager class
 *
 * Manages a single conversation session between the wizard and an AI agent.
 * Handles:
 * - Spawning the agent process with the wizard system prompt
 * - Sending user messages with structured output reminders
 * - Parsing and validating agent responses
 * - Tracking conversation state and history
 */
class ConversationManager {
	/** Current active session (only one wizard conversation at a time) */
	private session: ConversationSession | null = null;

	/**
	 * Start a new conversation session
	 *
	 * @param config Configuration for the conversation
	 * @returns Session ID for the conversation
	 */
	async startConversation(config: ConversationConfig): Promise<string> {
		// End any existing session first
		if (this.session) {
			await this.endConversation();
		}

		const sessionId = generateWizardSessionId();
		const systemPrompt = generateSystemPrompt({
			agentName: config.projectName,
			agentPath: config.directoryPath,
			existingDocs: config.existingDocs,
		});

		this.session = {
			sessionId,
			agentType: config.agentType,
			directoryPath: config.directoryPath,
			projectName: config.projectName,
			isActive: true,
			systemPrompt,
			outputBuffer: '',
			sshRemoteConfig: config.sshRemoteConfig,
		};

		// Log conversation start
		wizardDebugLogger.log('info', 'Conversation started', {
			sessionId,
			agentType: config.agentType,
			directoryPath: config.directoryPath,
			projectName: config.projectName,
			hasExistingDocs: !!config.existingDocs,
			existingDocsCount: config.existingDocs?.length || 0,
			hasRemoteSsh: !!config.sshRemoteConfig?.enabled,
			remoteId: config.sshRemoteConfig?.remoteId || null,
		});

		return sessionId;
	}

	/**
	 * Send a message to the agent and wait for a response
	 *
	 * This method:
	 * 1. Spawns a new agent process with the full conversation context
	 * 2. Waits for the agent to complete its response
	 * 3. Parses the structured output
	 * 4. Returns the result
	 *
	 * @param userMessage The user's message to send
	 * @param conversationHistory Previous messages in the conversation
	 * @param callbacks Optional callbacks for progress updates
	 * @returns SendMessageResult with the parsed response
	 */
	async sendMessage(
		userMessage: string,
		conversationHistory: WizardMessage[],
		callbacks?: ConversationCallbacks
	): Promise<SendMessageResult> {
		if (!this.session) {
			return {
				success: false,
				error: 'No active conversation session. Call startConversation first.',
			};
		}

		// Update callbacks
		this.session.callbacks = callbacks;
		this.session.outputBuffer = '';

		// Log message send
		wizardDebugLogger.log('info', 'Sending message to agent', {
			sessionId: this.session.sessionId,
			messageLength: userMessage.length,
			historyLength: conversationHistory.length,
		});

		// Notify sending
		callbacks?.onSending?.();

		try {
			// Get the agent configuration (host-injected resolver — see file header §2)
			const agent = await agentResolver(this.session.agentType);

			// For SSH remote sessions, skip the availability check since we're executing remotely
			// The agent detector checks for binaries locally, but we need to execute on the remote host
			const isRemoteSession =
				this.session.sshRemoteConfig?.enabled && this.session.sshRemoteConfig?.remoteId;

			if (!agent) {
				const error = `Agent ${this.session.agentType} configuration not found`;
				wizardDebugLogger.log('error', 'Agent config not found', {
					agentType: this.session.agentType,
				});
				return {
					success: false,
					error,
				};
			}

			// Only check availability for local sessions
			if (!isRemoteSession && !agent.available) {
				const error = `Agent ${this.session.agentType} is not available locally`;
				wizardDebugLogger.log('error', 'Agent not available locally', {
					agentType: this.session.agentType,
					agent: {
						available: agent.available,
						path: agent.path,
						command: agent.command,
						customPath: (agent as { customPath?: string }).customPath,
					},
				});
				return {
					success: false,
					error,
				};
			}

			// For remote sessions, log that we're skipping the availability check
			if (isRemoteSession) {
				wizardDebugLogger.log(
					'info',
					'Executing agent on SSH remote (skipping local availability check)',
					{
						agentType: this.session.agentType,
						remoteId: this.session.sshRemoteConfig?.remoteId,
						agentCommand: agent.command,
						agentPath: agent.path,
						agentCustomPath: (agent as { customPath?: string }).customPath,
					}
				);
			}

			// Build the full prompt with conversation context
			const fullPrompt = this.buildPromptWithContext(userMessage, conversationHistory);

			// Spawn the agent process and wait for completion
			// spawnAgentForMessage returns when the agent exits with parsed response
			const result = await this.spawnAgentForMessage(agent, fullPrompt);

			if (!result.success) {
				wizardDebugLogger.log('error', 'Message send failed', {
					sessionId: this.session.sessionId,
					error: result.error,
					hasDetectedError: !!result.detectedError,
					detectedErrorType: result.detectedError?.type,
					rawOutputLength: result.rawOutput?.length || 0,
				});
				callbacks?.onError?.(result.error || 'Failed to get response from agent');
				return result;
			}

			// Log success
			wizardDebugLogger.log('info', 'Message response received', {
				sessionId: this.session.sessionId,
				parseSuccess: result.response?.parseSuccess,
				confidence: result.response?.structured?.confidence,
				ready: result.response?.structured?.ready,
			});

			// Notify complete with the result
			callbacks?.onComplete?.(result);

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			wizardDebugLogger.log('error', 'Message send exception', {
				sessionId: this.session?.sessionId,
				error: errorMessage,
			});
			callbacks?.onError?.(errorMessage);
			return {
				success: false,
				error: errorMessage,
			};
		}
	}

	/**
	 * Build the full prompt including conversation context
	 */
	private buildPromptWithContext(
		userMessage: string,
		conversationHistory: WizardMessage[]
	): string {
		if (!this.session) {
			return formatUserMessage(userMessage);
		}

		// Start with the system prompt
		let prompt = this.session.systemPrompt + '\n\n';

		// Add conversation history
		if (conversationHistory.length > 0) {
			prompt += '## Previous Conversation\n\n';
			for (const msg of conversationHistory) {
				if (msg.role === 'user') {
					prompt += `User: ${msg.content}\n\n`;
				} else if (msg.role === 'assistant') {
					prompt += `Assistant: ${msg.content}\n\n`;
				}
			}
		}

		// Add the current user message with the structured output suffix
		prompt += '## Current Message\n\n';
		prompt += formatUserMessage(userMessage);

		return prompt;
	}

	/**
	 * Spawn the agent process for a single message exchange
	 */
	private async spawnAgentForMessage(
		agent: WizardAgentInfo,
		prompt: string
	): Promise<SendMessageResult> {
		if (!this.session) {
			return { success: false, error: 'No active session' };
		}

		const lifecycle = requireProcessLifecycleClient();
		if (!lifecycle) {
			return {
				success: false,
				error: 'WS process lifecycle client is not wired. Cannot spawn agent.',
			};
		}

		return new Promise<SendMessageResult>((resolve) => {
			wizardDebugLogger.log('spawn', 'Setting up agent spawn', {
				sessionId: this.session!.sessionId,
				agentId: agent.id,
				agentCommand: agent.command,
				directoryPath: this.session!.directoryPath,
				promptLength: prompt.length,
			});

			// Activity-based timeout: resets whenever the agent produces output.
			// This prevents false timeouts on complex prompts where the agent is
			// actively reading files or thinking, while still catching true stalls.
			const INACTIVITY_TIMEOUT_MS = 1200000; // 20 minutes of inactivity
			let lastActivityTime = Date.now();

			const resetTimeout = () => {
				if (this.session?.responseTimeoutId) {
					clearTimeout(this.session.responseTimeoutId);
				}
				lastActivityTime = Date.now();
				const newTimeoutId = setTimeout(() => {
					const timeSinceLastActivity = Date.now() - lastActivityTime;
					wizardDebugLogger.log('timeout', 'Response inactivity timeout after 20 minutes', {
						sessionId: this.session?.sessionId,
						timeSinceLastActivityMs: timeSinceLastActivity,
						outputBufferLength: this.session?.outputBuffer?.length || 0,
						outputPreview: this.session?.outputBuffer?.slice(-500),
					});
					this.cleanupListeners();
					resolve({
						success: false,
						error: 'Response timeout - agent did not complete in time',
						rawOutput: this.session?.outputBuffer,
					});
				}, INACTIVITY_TIMEOUT_MS);

				this.session!.responseTimeoutId = newTimeoutId;
			};

			// Start the initial timeout and store the reset function for listeners
			resetTimeout();
			this.session!.resetResponseTimeout = resetTimeout;

			// Set up data listener — processLifecycle dispatches one chunk per
			// process_data frame, synchronously (contract vector 2 in
			// processLifecycle.webfull.ts).
			this.session!.dataListenerCleanup = lifecycle.onData(this.session!.sessionId, (event) => {
				if (event.sessionId === this.session?.sessionId) {
					this.session.outputBuffer += event.chunk;
					this.session.resetResponseTimeout?.();
					this.session.callbacks?.onChunk?.(event.chunk);
				}
			});

			// Set up thinking chunk listener - uses the dedicated event from process-manager
			// This receives parsed thinking content (isPartial text) that's already extracted.
			// Optional-chaining on the client method itself preserves the renderer
			// parity (`window.maestro.process.onThinkingChunk?.(...)`).
			if (this.session!.callbacks?.onThinkingChunk) {
				this.session!.thinkingListenerCleanup = lifecycle.onThinkingChunk?.(
					this.session!.sessionId,
					(sessionId: string, content: string) => {
						if (sessionId === this.session?.sessionId && content) {
							this.session.resetResponseTimeout?.();
							this.session.callbacks?.onThinkingChunk?.(content);
						}
					}
				);
			}

			// Set up tool execution listener - shows tool use (Read, Write, etc.) when showThinking is enabled
			// This is important because in batch mode, we don't get streaming assistant messages,
			// but we DO get tool execution events which show what the agent is doing.
			if (this.session!.callbacks?.onToolExecution) {
				this.session!.toolExecutionListenerCleanup = lifecycle.onToolExecution?.(
					this.session!.sessionId,
					(sessionId: string, toolEvent: ToolExecutionEvent) => {
						if (sessionId === this.session?.sessionId) {
							this.session.resetResponseTimeout?.();
							this.session.callbacks?.onToolExecution?.(toolEvent);
						}
					}
				);
			}

			// Set up exit listener
			this.session!.exitListenerCleanup = lifecycle.onExit(this.session!.sessionId, (event) => {
				const sessionId = event.sessionId;
				const code = event.code;
				wizardDebugLogger.log('exit', 'Exit event received', {
					receivedId: sessionId,
					expectedId: this.session?.sessionId,
					code,
				});
				if (sessionId === this.session?.sessionId) {
					wizardDebugLogger.log('exit', 'Session ID matched, processing exit', { sessionId });

					// Agent finished - cleanupListeners() clears the inactivity timeout
					this.cleanupListeners();

					if (code === 0) {
						const parsedResponse = this.parseAgentOutput();
						wizardDebugLogger.log('data', 'Parsed agent response', {
							parseSuccess: parsedResponse.parseSuccess,
							hasStructured: !!parsedResponse.structured,
							confidence: parsedResponse.structured?.confidence,
							ready: parsedResponse.structured?.ready,
						});
						wizardDebugLogger.log('exit', `Agent exited successfully (code 0)`, {
							sessionId,
							outputBufferLength: this.session?.outputBuffer?.length || 0,
							parseSuccess: parsedResponse.parseSuccess,
						});
						resolve({
							success: true,
							response: parsedResponse,
							rawOutput: this.session?.outputBuffer,
						});
					} else {
						// Check for provider errors in the output
						const rawOutput = this.session?.outputBuffer || '';
						const detectedError = detectWizardError(rawOutput);

						if (detectedError) {
							wizardDebugLogger.log('error', 'Detected provider error', {
								errorType: detectedError.type,
								errorTitle: detectedError.title,
								errorMessage: detectedError.message,
							});
							wizardDebugLogger.log('exit', `Agent exited with provider error (code ${code})`, {
								sessionId,
								exitCode: code,
								errorType: detectedError.type,
								errorTitle: detectedError.title,
								errorMessage: detectedError.message,
								rawOutputLength: rawOutput.length,
								rawOutputPreview: rawOutput.slice(-500),
							});
							resolve({
								success: false,
								error: `${detectedError.title}: ${detectedError.message}`,
								rawOutput,
								detectedError,
							});
						} else {
							// Try to parse the output as a structured response
							const parsedResponse = this.parseAgentOutput();
							if (
								parsedResponse.parseSuccess &&
								(parsedResponse.structured || parsedResponse.rawText)
							) {
								wizardDebugLogger.log(
									'exit',
									`Agent exited nonzero but output parsed as valid response`,
									{
										sessionId,
										exitCode: code,
										parseSuccess: parsedResponse.parseSuccess,
										hasStructured: !!parsedResponse.structured,
										rawTextLength: parsedResponse.rawText?.length,
									}
								);
								resolve({
									success: true,
									response: parsedResponse,
									rawOutput,
								});
							} else {
								// No specific error detected, create generic message
								const errorMessage = createGenericErrorMessage(rawOutput, code);
								wizardDebugLogger.log('exit', `Agent exited with error (code ${code})`, {
									sessionId,
									exitCode: code,
									errorMessage,
									rawOutputLength: rawOutput.length,
									rawOutputPreview: rawOutput.slice(-500),
								});
								resolve({
									success: false,
									error: errorMessage,
									rawOutput,
								});
							}
						}
					}
				} else {
					wizardDebugLogger.log('exit', 'Session ID mismatch, ignoring exit event', {
						receivedId: sessionId,
						expectedId: this.session?.sessionId,
					});
				}
			});

			// Store resolve for potential early termination
			this.session!.pendingResolve = resolve;

			// Build args based on agent type
			// Each agent has different CLI structure for batch mode
			const argsForSpawn = this.buildArgsForAgent(agent);

			// Determine whether to send the prompt via stdin on Windows to avoid
			// exceeding the command line length limit. Uses agent capabilities and
			// SSH session flag to avoid interfering with remote execution paths.
			const isSshSession = Boolean(
				this.session!.sshRemoteConfig?.enabled && this.session!.sshRemoteConfig?.remoteId
			);
			const { sendPromptViaStdin: sendViaStdin, sendPromptViaStdinRaw: sendViaStdinRaw } =
				getStdinFlags({
					isSshSession,
					supportsStreamJsonInput: agent?.capabilities?.supportsStreamJsonInput ?? false,
				});
			if (sendViaStdin) {
				// Ensure the agent uses stream-json input format when sending JSON via stdin
				const inputFormatIndex = argsForSpawn.findIndex((arg) => arg === '--input-format');
				if (inputFormatIndex === -1) {
					argsForSpawn.push('--input-format', 'stream-json');
				} else if (argsForSpawn[inputFormatIndex + 1] !== 'stream-json') {
					argsForSpawn[inputFormatIndex + 1] = 'stream-json';
				}
			}

			// Use the agent's resolved path if available, falling back to command name
			// This is critical for packaged Electron apps where PATH may not include agent locations
			const commandToUse = agent.path || agent.command;

			// Log spawn details
			wizardDebugLogger.log('spawn', 'Preparing to spawn agent process', {
				sessionId: this.session!.sessionId,
				toolType: this.session!.agentType,
				command: commandToUse,
				agentPath: agent.path,
				agentCommand: agent.command,
				argsCount: argsForSpawn.length,
				cwd: this.session!.directoryPath,
				hasRemoteSsh: !!this.session!.sshRemoteConfig?.enabled,
				remoteId: this.session!.sshRemoteConfig?.remoteId || null,
			});

			wizardDebugLogger.log('spawn', 'Calling process.spawn', {
				sessionId: this.session!.sessionId,
				command: commandToUse,
				agentPath: agent.path,
				agentCommand: agent.command,
				args: argsForSpawn,
				cwd: this.session!.directoryPath,
				hasRemoteSsh: !!this.session!.sshRemoteConfig?.enabled,
				remoteId: this.session!.sshRemoteConfig?.remoteId || null,
			});

			if (sendViaStdin || sendViaStdinRaw) {
				wizardDebugLogger.log('spawn', 'Using stdin for Windows', {
					sessionId: this.session!.sessionId,
					platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
					promptLength: prompt.length,
					sendViaStdin,
					sendViaStdinRaw,
				});
			}

			// NOTE: The `process_spawn` WS frame on the server side accepts the
			// preload's full `ProcessConfig` shape; the webFull
			// `ProcessSpawnConfig` is the subset the client honors. The two
			// optional stdin flags (`sendPromptViaStdin`, `sendPromptViaStdinRaw`)
			// are part of the wire shape — passed through as extra fields. The
			// processLifecycle client spreads the config object into the frame
			// verbatim, so unrecognized fields fall through.
			const spawnPayload: ProcessSpawnConfig & {
				sendPromptViaStdin?: boolean;
				sendPromptViaStdinRaw?: boolean;
			} = {
				sessionId: this.session!.sessionId,
				toolType: this.session!.agentType,
				cwd: this.session!.directoryPath,
				command: commandToUse,
				args: argsForSpawn,
				prompt: prompt,
				sendPromptViaStdin: sendViaStdin,
				sendPromptViaStdinRaw: sendViaStdinRaw,
				sessionSshRemoteConfig: this.session!.sshRemoteConfig,
			};

			lifecycle
				.spawn(spawnPayload)
				.then(() => {
					wizardDebugLogger.log('spawn', 'Agent process spawned successfully', {
						sessionId: this.session?.sessionId,
					});
					// Notify that we're receiving
					this.session?.callbacks?.onReceiving?.();
				})
				.catch((error: Error) => {
					wizardDebugLogger.log('error', 'Failed to spawn agent process', {
						sessionId: this.session?.sessionId,
						error: error.message,
					});
					this.cleanupListeners();
					resolve({
						success: false,
						error: `Failed to spawn agent: ${error.message}`,
					});
				});
		});
	}

	/**
	 * Build CLI args for the agent based on its type and capabilities.
	 *
	 * Note: The server-side process.spawn handler automatically adds:
	 * - batchModePrefix (e.g., 'exec' for Codex, 'run' for OpenCode)
	 * - batchModeArgs (e.g., YOLO mode flags)
	 * - jsonOutputArgs (e.g., --json, --format json)
	 * - workingDirArgs (e.g., -C dir for Codex)
	 *
	 * So we only need to add agent-specific flags that aren't covered by
	 * the standard argument builders.
	 */
	private buildArgsForAgent(agent: WizardAgentInfo): string[] {
		const agentId = agent.id || this.session?.agentType;

		switch (agentId) {
			case 'claude-code': {
				// Claude Code: start with base args, add required flags for streaming and thinking
				const args = [...(agent.args || [])];
				// Ensure stream-json output format for proper parsing and thinking-chunk events
				if (!args.includes('--output-format')) {
					args.push('--output-format', 'stream-json');
				}
				if (!args.includes('--include-partial-messages')) {
					args.push('--include-partial-messages');
				}
				return args;
			}

			case 'codex': {
				// Codex requires exec batch mode with JSON output for wizard conversations
				// Must include these explicitly since wizard pre-builds args before IPC handler
				const args: string[] = [];

				// Add base args (if any) - batchModePrefix will be added by buildAgentArgs
				args.push(...(agent.args || []));

				// Add batch mode args: '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'
				if (agent.batchModeArgs) {
					args.push(...agent.batchModeArgs);
				}

				// Add JSON output: '--json'
				if (agent.jsonOutputArgs) {
					args.push(...agent.jsonOutputArgs);
				}

				return args;
			}

			case 'opencode': {
				// OpenCode requires 'run' batch mode with JSON output for wizard conversations
				const args: string[] = [];

				// Add base args (if any) - batchModePrefix will be added by buildAgentArgs
				args.push(...(agent.args || []));

				// Add JSON output: '--format json'
				if (agent.jsonOutputArgs) {
					args.push(...agent.jsonOutputArgs);
				}

				return args;
			}

			default: {
				// For unknown agents, use base args
				return [...(agent.args || [])];
			}
		}
	}

	/**
	 * Parse the accumulated agent output to extract the structured response
	 */
	private parseAgentOutput(): ParsedResponse {
		if (!this.session) {
			return {
				structured: null,
				rawText: '',
				parseSuccess: false,
				parseError: 'No active session',
			};
		}

		const output = this.session.outputBuffer;
		wizardDebugLogger.log('data', 'Raw output buffer details', {
			bufferLength: output.length,
			bufferPreview: output.slice(-500),
		});

		// Try to extract the result from stream-json format
		const extractedResult = this.extractResultFromStreamJson(output);
		const textToParse = extractedResult || output;

		wizardDebugLogger.log('data', 'Stream JSON extraction result', {
			extracted: !!extractedResult,
			textToParseLength: textToParse.length,
			textToParsePreview: textToParse.slice(0, 300),
		});

		const parsed = parseStructuredOutput(textToParse);
		wizardDebugLogger.log('data', 'Parse result', {
			parseSuccess: parsed.parseSuccess,
			hasStructured: !!parsed.structured,
			confidence: parsed.structured?.confidence,
			ready: parsed.structured?.ready,
			parseError: parsed.parseError,
		});

		return parsed;
	}

	/**
	 * Extract the result text from agent JSON output.
	 * Handles different agent output formats:
	 * - Claude Code: stream-json with { type: 'result', result: '...' }
	 * - OpenCode: JSONL with { type: 'text', part: { text: '...' } }
	 * - Codex: JSONL with { type: 'message', content: '...' } or similar
	 */
	private extractResultFromStreamJson(output: string): string | null {
		const agentType = this.session?.agentType;

		try {
			const lines = output.split('\n');

			// For OpenCode: concatenate all text parts
			if (agentType === 'opencode') {
				const textParts: string[] = [];
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						// OpenCode text messages have type: 'text' and part.text
						if (msg.type === 'text' && msg.part?.text) {
							textParts.push(msg.part.text);
						}
					} catch {
						// Ignore non-JSON lines
					}
				}
				if (textParts.length > 0) {
					return textParts.join('');
				}
			}

			// For Codex: look for message content
			if (agentType === 'codex') {
				const textParts: string[] = [];
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						// Codex uses agent_message type with content array
						if (msg.type === 'agent_message' && msg.content) {
							for (const block of msg.content) {
								if (block.type === 'text' && block.text) {
									textParts.push(block.text);
								}
							}
						}
						// Also check for message type with text field (older format)
						if (msg.type === 'message' && msg.text) {
							textParts.push(msg.text);
						}
					} catch {
						// Ignore non-JSON lines
					}
				}
				if (textParts.length > 0) {
					return textParts.join('');
				}
			}

			// For Claude Code: look for result message
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.type === 'result' && msg.result) {
						return msg.result;
					}
				} catch {
					// Ignore non-JSON lines
				}
			}
		} catch {
			// Fallback to raw output
		}
		return null;
	}

	/**
	 * Clean up event listeners and any pending timeouts
	 */
	private cleanupListeners(): void {
		if (this.session?.dataListenerCleanup) {
			this.session.dataListenerCleanup();
			this.session.dataListenerCleanup = undefined;
		}
		if (this.session?.exitListenerCleanup) {
			this.session.exitListenerCleanup();
			this.session.exitListenerCleanup = undefined;
		}
		if (this.session?.thinkingListenerCleanup) {
			this.session.thinkingListenerCleanup();
			this.session.thinkingListenerCleanup = undefined;
		}
		if (this.session?.toolExecutionListenerCleanup) {
			this.session.toolExecutionListenerCleanup();
			this.session.toolExecutionListenerCleanup = undefined;
		}
		if (this.session?.responseTimeoutId) {
			clearTimeout(this.session.responseTimeoutId);
			this.session.responseTimeoutId = undefined;
		}
		if (this.session) {
			this.session.resetResponseTimeout = undefined;
		}
	}

	/**
	 * End the current conversation session
	 */
	async endConversation(): Promise<void> {
		if (!this.session) return;

		this.cleanupListeners();

		// Kill any running process via the WS lifecycle client. If the client
		// isn't wired we silently skip (matches the renderer's tolerant catch).
		const lifecycle = processLifecycleClient;
		if (lifecycle) {
			try {
				await lifecycle.kill(this.session.sessionId);
			} catch {
				// Process may already be dead
			}
		}

		this.session = null;
	}

	/**
	 * Check if there's an active conversation
	 */
	isConversationActive(): boolean {
		return this.session !== null && this.session.isActive;
	}

	/**
	 * Get the current session ID (if any)
	 */
	getSessionId(): string | null {
		return this.session?.sessionId || null;
	}

	/**
	 * Get the ready confidence threshold
	 */
	getReadyThreshold(): number {
		return READY_CONFIDENCE_THRESHOLD;
	}

	/**
	 * Check if a response indicates ready to proceed
	 */
	checkIsReady(response: StructuredAgentResponse): boolean {
		return isReadyToProceed(response);
	}
}

// Export singleton instance
export const conversationManager = new ConversationManager();

/**
 * Helper function to create a user message for the conversation history
 */
export function createUserMessage(content: string): Omit<WizardMessage, 'id' | 'timestamp'> {
	return {
		role: 'user',
		content,
	};
}

/**
 * Helper function to create an assistant message for the conversation history
 */
export function createAssistantMessage(
	response: ParsedResponse
): Omit<WizardMessage, 'id' | 'timestamp'> {
	const structured = response.structured;
	return {
		role: 'assistant',
		content: structured?.message || response.rawText,
		confidence: structured?.confidence,
		ready: structured?.ready,
	};
}

/**
 * Helper function to determine if conversation should auto-proceed
 */
export function shouldAutoProceed(response: ParsedResponse): boolean {
	return (
		response.parseSuccess && response.structured !== null && isReadyToProceed(response.structured)
	);
}

/**
 * Generate a unique log entry ID
 */
function generateLogEntryId(): string {
	return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert wizard conversation history to session log entries.
 *
 * This function is used when the wizard completes to populate the
 * "Project Discovery" tab's conversation history with the wizard's
 * project discovery conversation.
 *
 * @param messages The wizard's conversation history (WizardMessage[])
 * @returns LogEntry[] suitable for populating an AITab's logs
 */
export function convertWizardMessagesToLogEntries(messages: WizardMessage[]): LogEntry[] {
	return messages.map((msg) => {
		const logEntry: LogEntry = {
			id: generateLogEntryId(),
			timestamp: msg.timestamp,
			source: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'ai' : 'system',
			text: msg.content,
		};

		// Mark user messages as delivered (they were successfully sent during wizard)
		if (msg.role === 'user') {
			logEntry.delivered = true;
		}

		return logEntry;
	});
}

/**
 * Create initial log entries for a Project Discovery tab.
 *
 * This prepends a system message indicating the conversation was from the
 * wizard setup, then includes the full conversation history.
 *
 * @param messages The wizard's conversation history
 * @param projectName The project name for the header message
 * @returns LogEntry[] with header and conversation
 */
export function createProjectDiscoveryLogs(
	messages: WizardMessage[],
	projectName: string
): LogEntry[] {
	const logs: LogEntry[] = [];

	// Add a system message to indicate this is from the wizard
	logs.push({
		id: generateLogEntryId(),
		timestamp: Date.now(),
		source: 'system',
		text: `📋 Project Discovery conversation from setup wizard for "${projectName || 'your project'}"`,
	});

	// Add the converted conversation history
	logs.push(...convertWizardMessagesToLogEntries(messages));

	return logs;
}

/**
 * Default name for the Project Discovery tab
 */
export const PROJECT_DISCOVERY_TAB_NAME = 'Project Discovery';
