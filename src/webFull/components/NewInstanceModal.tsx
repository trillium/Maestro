/**
 * NewInstanceModal — webFull lift
 *
 * webFull-native port of `src/renderer/components/NewInstanceModal.tsx`
 * (1822 LOC, "create a new agent" entry point + companion EditAgentModal).
 * This is the biggest single-modal user-felt unlock remaining in the
 * leaf-parade — the modal users open to spin up a fresh provider session.
 *
 * Lands on top of all five IPC-shim Decision route clusters (fs / agents /
 * marketplace / autorun-via-FsProvider.writeDoc / ssh-remotes, all CLOSED
 * server-side on origin/main 2e410f9d6 per the umbrella
 * `ISC-44.shim.big_3_ipc_strategy` Decision 2026-06-08). Two of the three
 * sub-surfaces this modal needs (agents writers + sshRemote writers) ship
 * as READ-ONLY on the server side per W3-agents and W3-ssh-remotes; the
 * write half is deferred per those agents' explicit posture (see their doc-
 * comments at `src/server/agents-manager.ts` and `ssh-remotes-manager.ts`).
 * This lift handles that by strip-and-promoting the write surface to props
 * — the host wires real persistence later (Electron via IPC; future
 * webFull-host via the writer routes once they ship).
 *
 * ## Audit count holds: 18 IPC sites = 18 (no transitive surprise)
 *
 * The leaf-parade brief warned of an audit-correction event if the audited
 * 18 IPC callsites in the renderer source ballooned via transitive hook
 * consumers (the MarketplaceModal precedent: an audit of 5 modal-file
 * callsites turned into 12 once `useMarketplace` was counted).
 * NewInstanceModal differs from MarketplaceModal in shape: ALL of its
 * IPC fan-out is inline in the modal source (no batch hooks, no transitive
 * useFoo() consumers). Pre-flight grep on the renderer source returned 18
 * sites, matching the audit. NO transitive hooks pulled in.
 *
 * Both sub-components (`AgentConfigPanel` 696 LOC, `SshRemoteSelector` 174
 * LOC) are also pure presentational — verified via grep before this lift.
 * They are lifted verbatim to `src/webFull/components/shared/` with
 * import-path adapts only.
 *
 * ## IPC-site mapping table (18 sites)
 *
 * | # | Renderer site (line)                              | Adapt           |
 * |---|---------------------------------------------------|-----------------|
 * | 1 | `fs.homeDir()`               (NewInstance:129)    | Route           |
 * | 2 | `fs.stat(path, sshRemoteId)` (NewInstance:200)    | Strip+Promote   |
 * | 3 | `agents.detect(sshRemoteId)` (NewInstance:240)    | Route           |
 * | 4 | `agents.getConfig(agentId)`  (NewInstance:284)    | Promote (prop)  |
 * | 5 | `dialog.selectFolder()`      (NewInstance:371)    | Promote (prop)  |
 * | 6 | `agents.refresh(agentId)`    (NewInstance:381)    | Route           |
 * | 7 | `agents.getModels(...)`      (NewInstance:405)    | Promote (prop)  |
 * | 8 | `sshRemote.getConfigs()`     (NewInstance:602)    | Route           |
 * | 9 | `agents.setConfig(id,cfg)`   (NewInstance:971)    | Promote (prop)  |
 * |10 | `shell.openExternal(url)`    (NewInstance:1000)   | window.open swap|
 * |11 | `agents.detect()`            (Edit:1270)          | Route           |
 * |12 | `agents.getModels(t)`        (Edit:1277)          | Promote (prop)  |
 * |13 | `agents.getConfig(t)`        (Edit:1288)          | Promote (prop)  |
 * |14 | `sshRemote.getConfigs()`     (Edit:1312)          | Route           |
 * |15 | `fs.stat(projRoot, sshId)`   (Edit:1385)          | Strip+Promote   |
 * |16 | `agents.getModels(t, true)`  (Edit:1482)          | Promote (prop)  |
 * |17 | `agents.refresh(t)`          (Edit:1495)          | Route           |
 * |18 | `agents.setConfig(t, cfg)`   (Edit:1791)          | Promote (prop)  |
 *
 * Route count: 7 (homeDir, detect ×3, refresh ×2, sshRemote.getConfigs ×2).
 * Promote count: 9 (selectFolder, getConfig ×2, setConfig ×2, getModels ×3,
 * remote-stat ×2 collapsed into one `onRemotePathValidate` prop family).
 * window.open swap count: 1.
 * Renderer grep on the lifted file: 0 (verified via the IPC-namespace
 * grep proof required by the leaf-parade brief).
 *
 * ## Strip-and-promote prop adapts (in detail)
 *
 * ### `agents.getConfig` / `agents.setConfig` → `onAgentConfig` /
 *     `onAgentConfigSave` props
 *
 * The W3-agents Decision shipped detection + capabilities as the READ
 * sub-surface (`/api/agents/detected`, `/api/agents/detect/:id`,
 * `/api/agents/capabilities/:id`) and DEFERRED the config CRUD surface
 * pending design of a server-side config store. Until that lands, the
 * webFull host owns config persistence — passes an initial `agentConfigs`
 * map (resolved once at host mount) and an `onAgentConfigSave(agentId,
 * config)` callback fired on every config blur. The renderer wires
 * Electron IPC; webFull-host can wire localStorage / settings-API /
 * eventual `/api/agents/config` PATCH (once that route lands).
 *
 * Defaulting: when neither prop is supplied, `agentConfigs` defaults to an
 * empty object (the modal still renders, the user still configures, the
 * config just isn't persisted between modal opens — graceful degradation
 * vs crash). Mirrors the SaveMarkdownModal `onBrowseFolder` precedent.
 *
 * ### `agents.getModels` → `availableModels` + `onRefreshModels` props
 *
 * The W3-agents Decision also deferred local model discovery (per-agent
 * subcommand fan-out — different shape per provider). webFull host owns
 * the model list: passes `availableModels: Record<agentId, string[]>` and
 * `onRefreshModels(agentId, forceRefresh)` callback. When the model list
 * is empty (host couldn't / didn't discover), the AgentConfigPanel
 * gracefully falls back to text-input-only (no dropdown). Mirrors the
 * MarketplaceModal `onFolderPick` precedent — the absence of host
 * cooperation degrades to a slightly less convenient UX, not a crash.
 *
 * ### `sshRemote.saveConfig` / `deleteConfig` / `setDefaultId` → NOT
 *     SURFACED in this lift
 *
 * The renderer NewInstanceModal does not write SSH remote configs — it
 * only reads them (line 602, 1312 — both via `sshRemote.getConfigs()`,
 * routed). The writer surface is only used by Settings, which is a
 * separate modal out of scope here. NO prop surface needed; future
 * Settings-modal lift handles those.
 *
 * ### `dialog.selectFolder` → `onFolderPick` prop
 *
 * Renderer line 371 reaches the dialog.selectFolder IPC channel from
 * `handleSelectFolder`. The webFull lift promotes this to an optional
 * `onFolderPick` prop following the SaveMarkdownModal / MarketplaceModal
 * precedent (2026-06-08 L2.5 lifts). When the prop is undefined OR
 * `isSshEnabled === true`, the folder-browse button is hidden / disabled
 * (the renderer already hides the affordance under SSH; the webFull lift
 * extends "hide" to also cover "no host pick capability"). The Cmd+O
 * keyboard shortcut is also gated by `onFolderPick` presence so the
 * shortcut doesn't fire a silent no-op.
 *
 * ### `fs.stat(path, sshRemoteId)` → `onRemotePathValidate` prop
 *
 * The W3-fs route DELIBERATELY 501s on `?sshRemoteId=` (see
 * `apiRoutes.ts:1602` and the manager doc-comment) — the SSH-remote
 * stat surface is out of scope for the headless server. The renderer
 * uses it for live "does this remote directory exist?" validation as
 * the user types. The webFull lift strip-and-promotes the validate
 * effect: when `onRemotePathValidate` is supplied, the lifted modal
 * fires it on debounce; when undefined, the validation effect is
 * skipped (the remote-path indicator simply doesn't render). The
 * renderer comment "Remote path validation is informational only —
 * don't block creation" confirms this is safe to degrade.
 *
 * ### `shell.openExternal(url)` → `window.open(url, '_blank',
 *     'noopener,noreferrer')` swap
 *
 * Renderer line 1000 fires the shell.openExternal IPC channel from the
 * "MAESTRO_SESSION_RESUMED" docs link. Per the StandingOvationOverlay /
 * MarketplaceModal precedent (2026-06-08 L2.5 lifts), replaced with
 * `window.open(url, '_blank', 'noopener,noreferrer')` — security-hardened
 * per OWASP / MDN (`noopener` prevents the opened page from touching
 * `window.opener`, `noreferrer` prevents the Referer header from leaking
 * back). Same UX shape (new tab / window), zero IPC.
 *
 * ## Route adapts (in detail)
 *
 * Per-route URL refs hoisted to `useRef` at first render (per the
 * MarketplaceModal precedent — `buildApiUrl` reads
 * `window.__MAESTRO_CONFIG__` which is stable post-mount, so freezing
 * the URLs avoids reading the config on every render).
 *
 * - `GET /api/fs/home-dir` — `{path, timestamp}` reply shape; extract
 *   `.path` and feed to `setHomeDir`. The renderer reply is a bare
 *   string; the route wraps it in an envelope per the rest of the
 *   `/api/*` surface convention.
 * - `GET /api/agents/detected` — `{agents, timestamp}` reply shape;
 *   extract `.agents` (renderer reply is a bare array; same envelope-
 *   wrap pattern). NO `?sshRemoteId=` because the route 501s on it;
 *   webFull host that needs SSH must use the Electron IPC path.
 * - `GET /api/agents/detect/:agentId` — `{agents, debugInfo, timestamp}`
 *   shape; extract `{agents, debugInfo}` and feed to the existing
 *   `setAgents(result.agents) + setDebugInfo(result.debugInfo)` flow.
 * - `GET /api/ssh-remotes` — `{configs, timestamp}` shape; extract
 *   `.configs`. The renderer wraps this in `{success: true, configs}`;
 *   the lift constructs the same `{success: true}` envelope from the
 *   route reply for parity with the renderer's downstream check.
 *
 * Error handling matches the MarketplaceModal precedent: try/catch,
 * webLogger.error on failure, no error UI thrown — the existing
 * try/catch blocks in the renderer already swallow detection failures
 * with `console.error`, and the lift preserves that posture (replaced
 * `console.error` with `webLogger.error` for routing through the
 * webFull observability path).
 *
 * ## Import-path adapts
 *
 * - `AgentConfig, Session, ToolType` from `'../types'` →
 *   `'../../renderer/types'` (type-only re-import; established webFull
 *   pattern per SendToAgentModal:108, TerminalOutput:121).
 * - `SshRemoteConfig, AgentSshRemoteConfig` from `'../../shared/types'`
 *   → unchanged (shared module reachable from both forks).
 * - `MODAL_PRIORITIES` from `'../constants/modalPriorities'` —
 *   unchanged; webFull's constants module re-exports verbatim.
 * - `validateNewSession, validateEditSession` from
 *   `'../utils/sessionValidation'` — unchanged path (lifted to
 *   `src/webFull/utils/sessionValidation.ts` as a sibling leaf).
 * - `FormInput, Modal, ModalFooter` from `'./ui/FormInput' + './ui/Modal'`
 *   — unchanged (already in webFull at the same sibling paths).
 * - `AgentConfigPanel` from `'./shared/AgentConfigPanel'` — unchanged
 *   path (lifted verbatim).
 * - `SshRemoteSelector` from `'./shared/SshRemoteSelector'` — unchanged
 *   path (lifted verbatim).
 * - `formatShortcutKeys` from `'../utils/shortcutFormatter'` — unchanged;
 *   webFull's shortcutFormatter mirrors the renderer's public API.
 * - `safeClipboardWrite` from `'../utils/clipboard'` — unchanged;
 *   webFull's clipboard.ts re-exports `safeClipboardWrite` verbatim
 *   (the `safeClipboardWriteImage` surface is the only IPC-bearing
 *   helper, and it isn't used here).
 * - `isBetaAgent, getAgentDisplayName` from `'../../shared/agentMetadata'`
 *   — unchanged (shared module, pure).
 * - `Theme` not imported directly — it comes through via the prop
 *   typings on the existing `theme: any` shape inherited from the
 *   renderer source. The renderer also uses `theme: any` because the
 *   Theme shape is provider-driven and not worth re-typing at the
 *   leaf level.
 *
 * ## What this file does NOT change vs the renderer source
 *
 * Verbatim: agent list ordering (supported first, coming-soon at the
 * bottom); chevron toggle on the agent header; expand-on-select for
 * supported agents only; SSH-config _pending_ slot transferring to the
 * selected agent on selection (the workaround for the user-might-pick-
 * SSH-before-agent ordering); auto-acknowledgment reset on directory
 * change; nudgeMessage character-cap UI + textarea; debounce timing
 * for remote-path validation (300ms); Cmd+Enter create / Cmd+O folder
 * shortcuts (Cmd+O gated by `onFolderPick` presence in the lift);
 * EditAgentModal's customHeader with copy-session-id button; agent
 * provider switcher in EditAgentModal with the "your tabs will be
 * cleared" warning callout when changed.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Folder, RefreshCw, ChevronRight, AlertTriangle, Copy, Check, X } from 'lucide-react';
import type { AgentConfig, Session, ToolType } from '../../renderer/types';
import type { SshRemoteConfig, AgentSshRemoteConfig } from '../../shared/types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { validateNewSession, validateEditSession } from '../utils/sessionValidation';
import { FormInput } from './ui/FormInput';
import { Modal, ModalFooter } from './ui/Modal';
import { AgentConfigPanel } from './shared/AgentConfigPanel';
import { SshRemoteSelector } from './shared/SshRemoteSelector';
import { formatShortcutKeys } from '../utils/shortcutFormatter';
import { safeClipboardWrite } from '../utils/clipboard';
import { isBetaAgent, getAgentDisplayName } from '../../shared/agentMetadata';
import { buildApiUrl } from '../utils/config';
import { webLogger } from '../utils/logger';

// Maximum character length for nudge message
const NUDGE_MESSAGE_MAX_LENGTH = 1000;

interface AgentDebugInfo {
	agentId: string;
	available: boolean;
	path: string | null;
	binaryName: string;
	envPath: string;
	homeDir: string;
	platform: string;
	whichCommand: string;
	error: string | null;
}

/**
 * Result shape of a remote-path validate prop call. Mirrors the renderer's
 * inline `fs.stat` result shape so the consumer effect stays verbatim:
 *
 * - `valid: true` + `isDirectory: true`  → "Remote directory found" green
 * - `valid: false` + `error`             → red error indicator
 * - `valid: false` + no error            → "Path not found or not accessible"
 * - Promise rejection                    → same as "not found", caught upstream
 */
export interface RemotePathValidateResult {
	valid: boolean;
	isDirectory: boolean;
	error?: string;
}

/**
 * Host-provided remote-path validation. Fired on a 300ms debounce when SSH
 * is enabled and a path is in the input. When omitted, the remote-path
 * indicator does not render (the renderer comment marks this as
 * informational only — does not block agent creation).
 */
export type RemotePathValidate = (
	path: string,
	sshRemoteId: string
) => Promise<RemotePathValidateResult>;

interface NewInstanceModalProps {
	isOpen: boolean;
	onClose: () => void;
	onCreate: (
		agentId: string,
		workingDir: string,
		name: string,
		nudgeMessage?: string,
		customPath?: string,
		customArgs?: string,
		customEnvVars?: Record<string, string>,
		customModel?: string,
		customContextWindow?: number,
		customProviderPath?: string,
		sessionSshRemoteConfig?: {
			enabled: boolean;
			remoteId: string | null;
			workingDirOverride?: string;
		},
		groupId?: string
	) => void;
	theme: any;
	existingSessions: Session[];
	sourceSession?: Session; // Optional session to duplicate from
	/**
	 * Host-provided per-agent config (model, contextWindow, providerPath, etc.).
	 * Replaces the renderer's agents.getConfig IPC fan-out per
	 * the W3-agents read-sub-surface posture (config CRUD deferred to a future
	 * follow-up brief). Defaults to `{}` when omitted.
	 */
	agentConfigs?: Record<string, Record<string, any>>;
	/**
	 * Host-provided per-agent model list. Replaces the renderer's
	 * agents.getModels IPC fan-out. Defaults to `{}` (no models
	 * → text-input-only fallback in AgentConfigPanel).
	 */
	availableModels?: Record<string, string[]>;
	/**
	 * Host-provided model refresh. Called when the user clicks the refresh
	 * button in AgentConfigPanel's model dropdown. Optional — when omitted,
	 * the refresh button still renders but is a no-op (matches the renderer
	 * behavior for agents that don't support model selection).
	 */
	onRefreshModels?: (agentId: string, forceRefresh: boolean) => void;
	/**
	 * Host-provided config save. Called on AgentConfigPanel's `onConfigBlur`
	 * with the full updated config for that agent. Optional — when omitted,
	 * config changes are local-only.
	 */
	onAgentConfigSave?: (agentId: string, config: Record<string, any>) => void;
	/**
	 * Host-provided folder picker. When omitted OR when SSH is enabled, the
	 * folder-browse button is hidden and the Cmd+O shortcut becomes a no-op.
	 * Returns the picked path string, or null/undefined to leave the input
	 * unchanged.
	 */
	onFolderPick?: () => Promise<string | null | undefined>;
	/**
	 * Host-provided remote-path validator. Replaces the renderer's
	 * `fs.stat(path, sshRemoteId)` for live remote-directory existence
	 * checks. When omitted, the remote-path indicator does not render.
	 */
	onRemotePathValidate?: RemotePathValidate;
}

interface EditAgentModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSave: (
		sessionId: string,
		name: string,
		toolType?: ToolType,
		nudgeMessage?: string,
		customPath?: string,
		customArgs?: string,
		customEnvVars?: Record<string, string>,
		customModel?: string,
		customContextWindow?: number,
		sessionSshRemoteConfig?: {
			enabled: boolean;
			remoteId: string | null;
			workingDirOverride?: string;
		}
	) => void;
	theme: any;
	session: Session | null;
	existingSessions: Session[];
	/** See NewInstanceModalProps.agentConfigs. */
	agentConfigs?: Record<string, Record<string, any>>;
	/** See NewInstanceModalProps.availableModels. */
	availableModels?: Record<string, string[]>;
	/** See NewInstanceModalProps.onRefreshModels. */
	onRefreshModels?: (agentId: string, forceRefresh: boolean) => void;
	/** See NewInstanceModalProps.onAgentConfigSave. */
	onAgentConfigSave?: (agentId: string, config: Record<string, any>) => void;
	/** See NewInstanceModalProps.onRemotePathValidate. */
	onRemotePathValidate?: RemotePathValidate;
}

// Supported agents that are fully implemented
const SUPPORTED_AGENTS = ['claude-code', 'opencode', 'codex', 'factory-droid'];

export function NewInstanceModal({
	isOpen,
	onClose,
	onCreate,
	theme,
	existingSessions,
	sourceSession,
	agentConfigs: hostAgentConfigs,
	availableModels: hostAvailableModels,
	onRefreshModels: hostRefreshModels,
	onAgentConfigSave,
	onFolderPick,
	onRemotePathValidate,
}: NewInstanceModalProps) {
	// Route URL refs — frozen at mount per the MarketplaceModal precedent
	// (buildApiUrl reads window.__MAESTRO_CONFIG__ which is stable post-mount).
	const homeDirUrlRef = useRef<string>(buildApiUrl('/fs/home-dir'));
	const detectedUrlRef = useRef<string>(buildApiUrl('/agents/detected'));
	const sshRemotesUrlRef = useRef<string>(buildApiUrl('/ssh-remotes'));

	const [agents, setAgents] = useState<AgentConfig[]>([]);
	const [selectedAgent, setSelectedAgent] = useState('');
	const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
	const [workingDir, setWorkingDir] = useState('');
	const [instanceName, setInstanceName] = useState('');
	const [nudgeMessage, setNudgeMessage] = useState('');
	const [loading, setLoading] = useState(true);
	const [refreshingAgent, setRefreshingAgent] = useState<string | null>(null);
	const [debugInfo, setDebugInfo] = useState<AgentDebugInfo | null>(null);
	const [homeDir, setHomeDir] = useState<string>('');
	const [customAgentPaths, setCustomAgentPaths] = useState<Record<string, string>>({});
	const [customAgentArgs, setCustomAgentArgs] = useState<Record<string, string>>({});
	const [customAgentEnvVars, setCustomAgentEnvVars] = useState<
		Record<string, Record<string, string>>
	>({});
	// Local agent configs — seeded from `hostAgentConfigs` prop (replaces the
	// renderer's `agents.getConfig` fan-out). User edits are tracked locally;
	// `onAgentConfigSave` is fired on blur for persistence.
	const [agentConfigs, setAgentConfigs] = useState<Record<string, Record<string, any>>>({});
	// Local model loading state — only used when `hostRefreshModels` resolves
	// asynchronously through a host hook (the host owns the actual model list).
	const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
	const [directoryWarningAcknowledged, setDirectoryWarningAcknowledged] = useState(false);
	// SSH Remote configuration
	const [sshRemotes, setSshRemotes] = useState<SshRemoteConfig[]>([]);
	const [agentSshRemoteConfigs, setAgentSshRemoteConfigs] = useState<
		Record<string, AgentSshRemoteConfig>
	>({});
	// Remote path validation state (only used when SSH is enabled AND
	// `onRemotePathValidate` host prop is supplied)
	const [remotePathValidation, setRemotePathValidation] = useState<{
		checking: boolean;
		valid: boolean;
		isDirectory: boolean;
		error?: string;
	}>({ checking: false, valid: false, isDirectory: false });
	// SSH connection error state - shown when we can't connect to the selected remote
	const [sshConnectionError, setSshConnectionError] = useState<string | null>(null);

	const nameInputRef = useRef<HTMLInputElement>(null);

	// Fetch home directory on mount for tilde expansion via `/api/fs/home-dir`
	// (replaces the renderer's fs.homeDir IPC site).
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(homeDirUrlRef.current);
				if (!res.ok) {
					webLogger.warn(`Failed to fetch home directory: HTTP ${res.status}`, 'NewInstanceModal');
					return;
				}
				const json = (await res.json()) as { path?: string };
				if (!cancelled && typeof json.path === 'string') {
					setHomeDir(json.path);
				}
			} catch (e: any) {
				webLogger.error(`Failed to fetch home directory: ${e?.message || e}`, 'NewInstanceModal');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Expand tilde in path
	const expandTilde = (path: string): string => {
		if (!homeDir) return path;
		if (path === '~') return homeDir;
		if (path.startsWith('~/')) return homeDir + path.slice(1);
		return path;
	};

	const handleWorkingDirChange = React.useCallback((value: string) => {
		setWorkingDir(value);
		setDirectoryWarningAcknowledged(false);
	}, []);

	// Validate session uniqueness
	const validation = useMemo(() => {
		const name = instanceName.trim();
		const expandedDir = expandTilde(workingDir.trim());
		if (!name || !expandedDir || !selectedAgent) {
			return { valid: true }; // Don't show errors until fields are filled
		}
		const sshConfig = agentSshRemoteConfigs[selectedAgent] || agentSshRemoteConfigs['_pending_'];
		const sshRemoteId = sshConfig?.enabled ? sshConfig?.remoteId : null;
		return validateNewSession(
			name,
			expandedDir,
			selectedAgent as ToolType,
			existingSessions,
			sshRemoteId
		);
	}, [instanceName, workingDir, selectedAgent, existingSessions, homeDir, agentSshRemoteConfigs]);

	// Check SSH remote configuration for the selected agent or pending config.
	// When no agent is selected, check the _pending_ config (user may select SSH before choosing agent).
	const activeSshRemoteId = useMemo(() => {
		const config = selectedAgent
			? agentSshRemoteConfigs[selectedAgent]
			: agentSshRemoteConfigs['_pending_'];
		return config?.enabled ? config.remoteId : null;
	}, [selectedAgent, agentSshRemoteConfigs]);
	const isSshEnabled = !!activeSshRemoteId;

	// Get SSH remote host for display (moved up for use in validation)
	// Also works with pending config when no agent is selected
	const sshRemoteHost = useMemo(() => {
		if (!activeSshRemoteId) return undefined;
		const remote = sshRemotes.find((r) => r.id === activeSshRemoteId);
		return remote?.host;
	}, [activeSshRemoteId, sshRemotes]);

	// Validate remote path when SSH is enabled (debounced).
	// Promoted from inline `fs.stat(path, sshRemoteId)` to the host-provided
	// `onRemotePathValidate` prop because the server-side `/api/fs/stat`
	// route deliberately 501s on `?sshRemoteId=` (see apiRoutes.ts:1602).
	// When the host does not supply the prop, the validation indicator does
	// not render — the renderer marks this as "informational only — don't
	// block creation," so degrading to "no indicator" is safe.
	useEffect(() => {
		// Only validate when SSH is enabled and host supplied the validator
		if (!isSshEnabled || !onRemotePathValidate) {
			setRemotePathValidation({ checking: false, valid: false, isDirectory: false });
			return;
		}

		const trimmedPath = workingDir.trim();
		if (!trimmedPath) {
			setRemotePathValidation({ checking: false, valid: false, isDirectory: false });
			return;
		}

		// Debounce the validation
		const timeoutId = setTimeout(async () => {
			setRemotePathValidation((prev) => ({ ...prev, checking: true }));

			try {
				const stat = await onRemotePathValidate(trimmedPath, activeSshRemoteId!);
				if (stat && stat.isDirectory && stat.valid) {
					setRemotePathValidation({
						checking: false,
						valid: true,
						isDirectory: true,
					});
				} else if (stat && stat.error) {
					setRemotePathValidation({
						checking: false,
						valid: false,
						isDirectory: false,
						error: stat.error,
					});
				} else {
					setRemotePathValidation({
						checking: false,
						valid: false,
						isDirectory: false,
						error: 'Path not found or not accessible',
					});
				}
			} catch {
				setRemotePathValidation({
					checking: false,
					valid: false,
					isDirectory: false,
					error: 'Path not found or not accessible',
				});
			}
		}, 300);

		return () => clearTimeout(timeoutId);
	}, [workingDir, isSshEnabled, activeSshRemoteId, onRemotePathValidate]);

	// Define handlers first before they're used in effects.
	// Adapted from the renderer's `loadAgents` — replaces `agents.detect()`
	// (and the per-agent `agents.getConfig()` fan-out) with `/api/agents/detected`
	// + host-provided `hostAgentConfigs`. SSH-remote re-detection is not
	// supported here (the server route 501s on `?sshRemoteId=`); when the
	// host needs SSH re-detection it must route through the Electron IPC.
	const loadAgents = async (source?: Session, sshRemoteId?: string) => {
		setLoading(true);
		setSshConnectionError(null);
		try {
			// SSH remote detection is out of scope server-side (see W3-agents
			// posture: "sshRemoteId is not supported by the server-side
			// agents routes"). When a remote is requested, surface a friendly
			// error so the user can switch back to local without confusion.
			if (sshRemoteId) {
				setSshConnectionError(
					'Agent detection on SSH remotes is not yet available in the web interface. Switch to Local Execution or use the desktop app.'
				);
				setLoading(false);
				return;
			}

			const res = await fetch(detectedUrlRef.current);
			if (!res.ok) {
				webLogger.error(`Failed to detect agents: HTTP ${res.status}`, 'NewInstanceModal');
				setLoading(false);
				return;
			}
			const json = (await res.json()) as { agents?: AgentConfig[] };
			const detectedAgents: AgentConfig[] = json.agents || [];

			setAgents(detectedAgents);

			// Per-agent config (path, args, env vars) starts empty - each agent gets its own config
			// Only reset if NOT duplicating (source session will provide values)
			if (!source) {
				setCustomAgentPaths({});
				setCustomAgentArgs({});
				setCustomAgentEnvVars({});
				setAgentSshRemoteConfigs({});
			}

			// Seed configs from the host-provided `hostAgentConfigs` prop
			// (replaces the renderer's per-agent `agents.getConfig` fan-out).
			// Host owns the source of truth — modal just renders + reports
			// blur events back via `onAgentConfigSave`.
			const configs: Record<string, Record<string, any>> = {};
			const paths: Record<string, string> = {};
			const args: Record<string, string> = {};
			const envVars: Record<string, Record<string, string>> = {};

			for (const agent of detectedAgents) {
				const config: Record<string, any> = { ...(hostAgentConfigs?.[agent.id] || {}) };
				configs[agent.id] = config;

				// Extract per-agent settings from the loaded config
				if (config.customPath) {
					paths[agent.id] = config.customPath;
				}
				if (config.customArgs) {
					args[agent.id] = config.customArgs;
				}
				if (config.customEnvVars && Object.keys(config.customEnvVars).length > 0) {
					envVars[agent.id] = config.customEnvVars;
				}
			}

			// If duplicating, merge source session config values into loaded configs
			if (source) {
				const sourceConfig: Record<string, any> = { ...configs[source.toolType] };
				if (source.customModel) {
					sourceConfig.model = source.customModel;
				}
				if (source.customContextWindow) {
					sourceConfig.contextWindow = source.customContextWindow;
				}
				if (source.customProviderPath) {
					sourceConfig.providerPath = source.customProviderPath;
				}
				configs[source.toolType] = sourceConfig;
			}

			setAgentConfigs(configs);
			setCustomAgentPaths(paths);
			setCustomAgentArgs(args);
			setCustomAgentEnvVars(envVars);

			// Select first available non-hidden agent (or source agent if duplicating)
			// (hidden agents like 'terminal' should never be auto-selected)
			if (source) {
				setSelectedAgent(source.toolType);
			} else {
				const firstAvailable = detectedAgents.find((a: AgentConfig) => a.available && !a.hidden);
				if (firstAvailable) {
					setSelectedAgent(firstAvailable.id);
				}
			}

			// Pre-fill form fields AFTER agents are loaded (ensures no race condition)
			if (source) {
				handleWorkingDirChange(source.cwd);
				setInstanceName(`${source.name} (Copy)`);
				setNudgeMessage(source.nudgeMessage || '');

				// Pre-fill custom agent configuration
				setCustomAgentPaths((prev) => ({
					...prev,
					[source.toolType]: source.customPath || '',
				}));
				setCustomAgentArgs((prev) => ({
					...prev,
					[source.toolType]: source.customArgs || '',
				}));
				setCustomAgentEnvVars((prev) => ({
					...prev,
					[source.toolType]: source.customEnvVars || {},
				}));

				// Pre-fill SSH remote configuration if source session has it
				if (source.sessionSshRemoteConfig?.enabled && source.sessionSshRemoteConfig?.remoteId) {
					setAgentSshRemoteConfigs((prev) => ({
						...prev,
						[source.toolType]: {
							enabled: true,
							remoteId: source.sessionSshRemoteConfig!.remoteId!,
							workingDirOverride: source.sessionSshRemoteConfig!.workingDirOverride,
						},
					}));
				}
			}
		} catch (error: any) {
			webLogger.error(`Failed to load agents: ${error?.message || error}`, 'NewInstanceModal');
		} finally {
			setLoading(false);
		}
	};

	// Folder picker — promoted to host prop. Gated by both `onFolderPick`
	// presence (no prop → no affordance) and `isSshEnabled` (the renderer
	// already disables the picker under SSH because the host filesystem
	// doesn't apply to remote paths).
	const handleSelectFolder = React.useCallback(async () => {
		if (!onFolderPick) return;
		const folder = await onFolderPick();
		if (folder) {
			handleWorkingDirChange(folder);
		}
	}, [handleWorkingDirChange, onFolderPick]);

	// Refresh an individual agent's detection via
	// `GET /api/agents/detect/:agentId` (replaces `agents.refresh(agentId)`).
	const handleRefreshAgent = React.useCallback(async (agentId: string) => {
		setRefreshingAgent(agentId);
		setDebugInfo(null);
		try {
			const res = await fetch(buildApiUrl(`/agents/detect/${encodeURIComponent(agentId)}`));
			if (!res.ok) {
				webLogger.error(
					`Failed to refresh agent ${agentId}: HTTP ${res.status}`,
					'NewInstanceModal'
				);
				return;
			}
			const json = (await res.json()) as {
				agents?: AgentConfig[];
				debugInfo?: AgentDebugInfo | null;
			};
			if (json.agents) {
				setAgents(json.agents);
			}
			if (json.debugInfo && !json.debugInfo.available) {
				setDebugInfo(json.debugInfo);
			}
		} catch (error: any) {
			webLogger.error(`Failed to refresh agent: ${error?.message || error}`, 'NewInstanceModal');
		} finally {
			setRefreshingAgent(null);
		}
	}, []);

	// Load available models for an agent — promoted to host. When the host
	// supplies `hostRefreshModels`, we delegate (and reflect loading state
	// locally for the spinner). When it doesn't, this is a no-op (the model
	// dropdown gracefully falls back to text-input-only).
	const loadModelsForAgent = React.useCallback(
		async (agentId: string, forceRefresh = false) => {
			// Check if agent supports model selection
			const agent = agents.find((a) => a.id === agentId);
			if (!agent?.capabilities?.supportsModelSelection) return;

			// Skip if already loaded and not forcing refresh
			if (!forceRefresh && (hostAvailableModels?.[agentId]?.length ?? 0) > 0) return;

			if (!hostRefreshModels) return;

			setLoadingModels((prev) => ({ ...prev, [agentId]: true }));
			try {
				await hostRefreshModels(agentId, forceRefresh);
			} catch (error: any) {
				webLogger.error(
					`Failed to load models for ${agentId}: ${error?.message || error}`,
					'NewInstanceModal'
				);
			} finally {
				setLoadingModels((prev) => ({ ...prev, [agentId]: false }));
			}
		},
		[agents, hostAvailableModels, hostRefreshModels]
	);

	// Hoist groupId out of the callback so `sourceSession` reference changes
	// (which we already know happen mid-modal — see the prefill effect below)
	// don't strand a stale value behind the useCallback memo.
	const sourceGroupId = sourceSession?.groupId;

	const handleCreate = React.useCallback(() => {
		const name = instanceName.trim();
		if (!name) return; // Name is required
		// Expand tilde before passing to callback
		const expandedWorkingDir = expandTilde(workingDir.trim());

		// Validate before creating
		const sshConfig = agentSshRemoteConfigs[selectedAgent] || agentSshRemoteConfigs['_pending_'];
		const sshRemoteId = sshConfig?.enabled ? sshConfig?.remoteId : null;
		const result = validateNewSession(
			name,
			expandedWorkingDir,
			selectedAgent as ToolType,
			existingSessions,
			sshRemoteId
		);
		if (!result.valid) return;

		// Get per-agent config values
		const agentCustomPath = customAgentPaths[selectedAgent]?.trim() || undefined;
		const agentCustomArgs = customAgentArgs[selectedAgent]?.trim() || undefined;
		const agentCustomEnvVars =
			customAgentEnvVars[selectedAgent] && Object.keys(customAgentEnvVars[selectedAgent]).length > 0
				? customAgentEnvVars[selectedAgent]
				: undefined;
		// Get model from agent config - this will become per-session
		const agentCustomModel = agentConfigs[selectedAgent]?.model?.trim() || undefined;
		// Get contextWindow and providerPath from agent config
		const agentCustomContextWindow = agentConfigs[selectedAgent]?.contextWindow || undefined;
		const agentCustomProviderPath = agentConfigs[selectedAgent]?.providerPath?.trim() || undefined;

		// Get SSH remote configuration for this session (stored per-session, not per-agent)
		const sshRemoteConfig = agentSshRemoteConfigs[selectedAgent];
		// Convert to session-level format: ALWAYS pass explicitly to override any agent-level config
		// For new sessions, this ensures consistent behavior with the UI selection
		const sessionSshRemoteConfig =
			sshRemoteConfig?.enabled && sshRemoteConfig?.remoteId
				? {
						enabled: true,
						remoteId: sshRemoteConfig.remoteId,
						workingDirOverride: sshRemoteConfig.workingDirOverride,
					}
				: { enabled: false, remoteId: null };

		onCreate(
			selectedAgent,
			expandedWorkingDir,
			name,
			nudgeMessage.trim() || undefined,
			agentCustomPath,
			agentCustomArgs,
			agentCustomEnvVars,
			agentCustomModel,
			agentCustomContextWindow,
			agentCustomProviderPath,
			sessionSshRemoteConfig,
			sourceGroupId
		);
		onClose();

		// Reset
		setInstanceName('');
		handleWorkingDirChange('');
		setNudgeMessage('');
		// Reset per-agent config for selected agent
		setCustomAgentPaths((prev) => ({ ...prev, [selectedAgent]: '' }));
		setCustomAgentArgs((prev) => ({ ...prev, [selectedAgent]: '' }));
		setCustomAgentEnvVars((prev) => ({ ...prev, [selectedAgent]: {} }));
		setAgentSshRemoteConfigs((prev) => {
			const newConfigs = { ...prev };
			delete newConfigs[selectedAgent];
			return newConfigs;
		});
	}, [
		instanceName,
		selectedAgent,
		workingDir,
		nudgeMessage,
		customAgentPaths,
		customAgentArgs,
		customAgentEnvVars,
		agentConfigs,
		agentSshRemoteConfigs,
		onCreate,
		onClose,
		expandTilde,
		handleWorkingDirChange,
		existingSessions,
		sourceGroupId,
	]);

	// Check if form is valid for submission
	const isFormValid = useMemo(() => {
		const hasWarningThatNeedsAck = validation.warning && !directoryWarningAcknowledged;
		const agent = agents.find((a) => a.id === selectedAgent);
		// Agent is considered available if:
		// 1. It was auto-detected (agent.available), OR
		// 2. User specified a custom path for it
		const hasCustomPath = customAgentPaths[selectedAgent]?.trim();
		const isAgentUsable = agent?.available || !!hasCustomPath;
		// Remote path validation is informational only - don't block creation
		// Users may want to set up agent for a remote before the path exists
		return (
			selectedAgent &&
			isAgentUsable &&
			workingDir.trim() &&
			instanceName.trim() &&
			validation.valid &&
			!hasWarningThatNeedsAck
		);
	}, [
		selectedAgent,
		agents,
		workingDir,
		instanceName,
		validation.valid,
		validation.warning,
		directoryWarningAcknowledged,
		customAgentPaths,
	]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle Cmd+O for folder picker (disabled when SSH remote is active OR no host prop)
			if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				e.stopPropagation();
				if (!isSshEnabled && onFolderPick) {
					handleSelectFolder();
				}
				return;
			}
			// Handle Cmd+Enter for creating agent
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				e.stopPropagation();
				if (isFormValid) {
					handleCreate();
				}
				return;
			}
		},
		[handleSelectFolder, handleCreate, isFormValid, isSshEnabled, onFolderPick]
	);

	// Sort agents: supported first, then coming soon at the bottom
	const sortedAgents = useMemo(() => {
		const visible = agents.filter((a) => !a.hidden);
		const supported = visible.filter((a) => SUPPORTED_AGENTS.includes(a.id));
		const comingSoon = visible.filter((a) => !SUPPORTED_AGENTS.includes(a.id));
		return [...supported, ...comingSoon];
	}, [agents]);

	// Effects - load agents and optionally pre-fill from source session
	// Depend on sourceSession?.id (not the full object) so store updates that
	// create a new sourceSession reference don't re-fire and overwrite the name
	// the user has already typed.
	const sourceSessionId = sourceSession?.id;
	useEffect(() => {
		if (isOpen) {
			// Pass sourceSession to loadAgents to handle pre-fill AFTER agents are loaded
			// This prevents the race condition where loadAgents would overwrite pre-filled values
			loadAgents(sourceSession);
			// Keep all agents collapsed by default, or expand when duplicating to show custom config
			if (sourceSession) {
				setExpandedAgent(sourceSession.toolType);
			} else {
				setExpandedAgent(null);
			}
			// Reset warning acknowledgment when modal opens
			setDirectoryWarningAcknowledged(false);
		}
	}, [isOpen, sourceSessionId]);

	// Load SSH remote configurations independently of agent detection.
	// Replaces `sshRemote.getConfigs()` with `GET /api/ssh-remotes`.
	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(sshRemotesUrlRef.current);
				if (!res.ok) {
					webLogger.warn(`Failed to fetch SSH remotes: HTTP ${res.status}`, 'NewInstanceModal');
					return;
				}
				const json = (await res.json()) as { configs?: SshRemoteConfig[] };
				if (!cancelled && json.configs) {
					setSshRemotes(json.configs);
				}
			} catch (sshError: any) {
				webLogger.error(
					`Failed to load SSH remote configs: ${sshError?.message || sshError}`,
					'NewInstanceModal'
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isOpen]);

	// Transfer pending SSH config to selected agent automatically
	// This ensures SSH config is preserved when agent is auto-selected or manually clicked
	useEffect(() => {
		if (
			selectedAgent &&
			agentSshRemoteConfigs['_pending_'] &&
			!agentSshRemoteConfigs[selectedAgent]
		) {
			setAgentSshRemoteConfigs((prev) => ({
				...prev,
				[selectedAgent]: prev['_pending_'],
			}));
		}
	}, [selectedAgent, agentSshRemoteConfigs]);

	// Track the current SSH remote ID for re-detection
	// Uses _pending_ key when no agent is selected, which is the shared SSH config
	const currentSshRemoteId = useMemo(() => {
		const config = agentSshRemoteConfigs['_pending_'] || agentSshRemoteConfigs[selectedAgent];
		return config?.enabled ? config.remoteId : null;
	}, [agentSshRemoteConfigs, selectedAgent]);

	// Track initial load to avoid re-running on first mount
	const initialLoadDoneRef = useRef(false);

	// Re-detect agents when SSH remote selection changes
	// This allows users to see which agents are available on remote vs local.
	// NOTE: server route 501s on SSH remotes, so changing the SSH remote here
	// will surface the "Agent detection on SSH remotes is not yet available
	// in the web interface" message via sshConnectionError. This is intentional
	// — the modal still renders and the user can switch back to local.
	useEffect(() => {
		// Skip if modal not open
		if (!isOpen) {
			initialLoadDoneRef.current = false;
			return;
		}

		// Skip the initial load (handled by the isOpen effect above)
		if (!initialLoadDoneRef.current) {
			initialLoadDoneRef.current = true;
			return;
		}

		// Re-run agent detection with the new SSH remote ID
		loadAgents(undefined, currentSshRemoteId ?? undefined);
	}, [isOpen, currentSshRemoteId]);

	if (!isOpen) return null;

	return (
		<div onKeyDown={handleKeyDown} role="group" aria-label="Create new agent dialog">
			<Modal
				theme={theme}
				title="Create New Agent"
				priority={MODAL_PRIORITIES.NEW_INSTANCE}
				onClose={onClose}
				width={600}
				initialFocusRef={nameInputRef}
				footer={
					<ModalFooter
						theme={theme}
						onCancel={onClose}
						onConfirm={handleCreate}
						confirmLabel="Create Agent"
						confirmDisabled={!isFormValid}
					/>
				}
			>
				<div className="space-y-5">
					{/* Agent Name */}
					<FormInput
						ref={nameInputRef}
						id="agent-name-input"
						theme={theme}
						label="Agent Name"
						value={instanceName}
						onChange={setInstanceName}
						placeholder=""
						error={validation.errorField === 'name' ? validation.error : undefined}
						heightClass="p-2"
					/>

					{/* Agent Selection */}
					<div>
						<div
							className="block text-xs font-bold opacity-70 uppercase mb-2"
							style={{ color: theme.colors.textMain }}
						>
							Agent Provider
						</div>
						{loading ? (
							<div className="text-sm opacity-50">Loading agents...</div>
						) : sshConnectionError ? (
							/* SSH Connection Error State */
							<div
								className="flex flex-col items-center justify-center p-6 rounded-lg border-2 text-center"
								style={{
									backgroundColor: `${theme.colors.error}10`,
									borderColor: theme.colors.error,
								}}
							>
								<AlertTriangle className="w-10 h-10 mb-3" style={{ color: theme.colors.error }} />
								<h4
									className="text-base font-semibold mb-2"
									style={{ color: theme.colors.textMain }}
								>
									Unable to Connect
								</h4>
								<p className="text-sm mb-3" style={{ color: theme.colors.textDim }}>
									{sshConnectionError}
								</p>
								<p className="text-xs" style={{ color: theme.colors.textDim }}>
									Select a different remote host or switch to Local Execution.
								</p>
							</div>
						) : (
							<div className="space-y-1">
								{sortedAgents.map((agent) => {
									const isSupported = SUPPORTED_AGENTS.includes(agent.id);
									const isExpanded = expandedAgent === agent.id;
									const isSelected = selectedAgent === agent.id;

									const handleAgentHeaderActivate = () => {
										if (isSupported) {
											// Toggle expansion
											const nowExpanded = !isExpanded;
											setExpandedAgent(nowExpanded ? agent.id : null);
											// Always select when clicking a supported agent (even if not available)
											// User can configure a custom path to make it usable
											setSelectedAgent(agent.id);
											// Transfer pending SSH config to the newly selected agent if it doesn't have one
											setAgentSshRemoteConfigs((prev) => {
												const pendingConfig = prev['_pending_'];
												if (pendingConfig && !prev[agent.id]) {
													return {
														...prev,
														[agent.id]: pendingConfig,
													};
												}
												return prev;
											});
											// Load models when expanding an agent that supports model selection
											if (nowExpanded && agent.capabilities?.supportsModelSelection) {
												loadModelsForAgent(agent.id);
											}
										}
									};

									return (
										<div
											key={agent.id}
											className={`rounded border transition-all overflow-hidden ${
												isSelected ? 'ring-2' : ''
											}`}
											style={
												{
													borderColor: theme.colors.border,
													backgroundColor: isSelected ? theme.colors.accentDim : 'transparent',
													'--tw-ring-color': theme.colors.accent,
												} as React.CSSProperties
											}
										>
											{/* Collapsed header row */}
											<div
												onClick={handleAgentHeaderActivate}
												onKeyDown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														handleAgentHeaderActivate();
													}
												}}
												className={`w-full text-left px-3 py-2 flex items-center justify-between ${
													!isSupported
														? 'opacity-40 cursor-not-allowed'
														: 'hover:bg-white/5 cursor-pointer'
												}`}
												style={{ color: theme.colors.textMain }}
												role="option"
												aria-selected={isSelected}
												aria-expanded={isExpanded}
												tabIndex={isSupported ? 0 : -1}
											>
												<div className="flex items-center gap-2">
													{/* Expand/collapse chevron for supported agents */}
													{isSupported && (
														<ChevronRight
															className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
															style={{ color: theme.colors.textDim }}
														/>
													)}
													<span className="font-medium">{agent.name}</span>
													{/* "Beta" badge for Codex, OpenCode, and Factory Droid */}
													{isBetaAgent(agent.id) && (
														<span
															className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
															style={{
																backgroundColor: theme.colors.warning + '30',
																color: theme.colors.warning,
															}}
														>
															Beta
														</span>
													)}
												</div>
												<div className="flex items-center gap-2">
													{isSupported ? (
														<>
															{agent.available ? (
																<span
																	className="text-xs px-2 py-0.5 rounded"
																	style={{
																		backgroundColor: theme.colors.success + '20',
																		color: theme.colors.success,
																	}}
																>
																	Available
																</span>
															) : (
																<span
																	className="text-xs px-2 py-0.5 rounded"
																	style={{
																		backgroundColor: theme.colors.error + '20',
																		color: theme.colors.error,
																	}}
																>
																	Not Found
																</span>
															)}
															<button
																onClick={(e) => {
																	e.stopPropagation();
																	handleRefreshAgent(agent.id);
																}}
																className="p-1 rounded hover:bg-white/10 transition-colors"
																title="Refresh detection"
																style={{ color: theme.colors.textDim }}
															>
																<RefreshCw
																	className={`w-3 h-3 ${refreshingAgent === agent.id ? 'animate-spin' : ''}`}
																/>
															</button>
														</>
													) : (
														<span
															className="text-xs px-2 py-0.5 rounded"
															style={{
																backgroundColor: theme.colors.warning + '20',
																color: theme.colors.warning,
															}}
														>
															Coming Soon
														</span>
													)}
												</div>
											</div>

											{/* Expanded details for supported agents */}
											{/* Per-agent config (path, args, env vars) is local state only - saved to agent on create */}
											{isSupported && isExpanded && (
												<div className="px-3 pb-3 pt-2">
													<AgentConfigPanel
														theme={theme}
														agent={agent}
														customPath={customAgentPaths[agent.id] || ''}
														onCustomPathChange={(value) => {
															setCustomAgentPaths((prev) => ({ ...prev, [agent.id]: value }));
														}}
														onCustomPathBlur={() => {
															/* Saved on agent create */
														}}
														onCustomPathClear={() => {
															setCustomAgentPaths((prev) => {
																const newPaths = { ...prev };
																delete newPaths[agent.id];
																return newPaths;
															});
														}}
														customArgs={customAgentArgs[agent.id] || ''}
														onCustomArgsChange={(value) => {
															setCustomAgentArgs((prev) => ({ ...prev, [agent.id]: value }));
														}}
														onCustomArgsBlur={() => {
															/* Saved on agent create */
														}}
														onCustomArgsClear={() => {
															setCustomAgentArgs((prev) => {
																const newArgs = { ...prev };
																delete newArgs[agent.id];
																return newArgs;
															});
														}}
														customEnvVars={customAgentEnvVars[agent.id] || {}}
														onEnvVarKeyChange={(oldKey, newKey, value) => {
															const currentVars = { ...customAgentEnvVars[agent.id] };
															delete currentVars[oldKey];
															currentVars[newKey] = value;
															setCustomAgentEnvVars((prev) => ({
																...prev,
																[agent.id]: currentVars,
															}));
														}}
														onEnvVarValueChange={(key, value) => {
															setCustomAgentEnvVars((prev) => ({
																...prev,
																[agent.id]: {
																	...prev[agent.id],
																	[key]: value,
																},
															}));
														}}
														onEnvVarRemove={(key) => {
															const currentVars = { ...customAgentEnvVars[agent.id] };
															delete currentVars[key];
															if (Object.keys(currentVars).length > 0) {
																setCustomAgentEnvVars((prev) => ({
																	...prev,
																	[agent.id]: currentVars,
																}));
															} else {
																setCustomAgentEnvVars((prev) => {
																	const newVars = { ...prev };
																	delete newVars[agent.id];
																	return newVars;
																});
															}
														}}
														onEnvVarAdd={() => {
															const currentVars = customAgentEnvVars[agent.id] || {};
															let newKey = 'NEW_VAR';
															let counter = 1;
															while (currentVars[newKey]) {
																newKey = `NEW_VAR_${counter}`;
																counter++;
															}
															setCustomAgentEnvVars((prev) => ({
																...prev,
																[agent.id]: {
																	...prev[agent.id],
																	[newKey]: '',
																},
															}));
														}}
														onEnvVarsBlur={() => {
															/* Saved on agent create */
														}}
														agentConfig={agentConfigs[agent.id] || {}}
														onConfigChange={(key, value) => {
															setAgentConfigs((prev) => ({
																...prev,
																[agent.id]: {
																	...prev[agent.id],
																	[key]: value,
																},
															}));
														}}
														onConfigBlur={(key, value) => {
															const updatedConfig = {
																...(agentConfigs[agent.id] || {}),
																[key]: value,
															};
															// Promoted from the agents.setConfig IPC channel to the
															// host-provided `onAgentConfigSave` prop. Host owns
															// persistence (Electron via IPC, future webFull-host via
															// the deferred config-CRUD writer routes).
															if (onAgentConfigSave) {
																try {
																	onAgentConfigSave(agent.id, updatedConfig);
																} catch (error: any) {
																	webLogger.error(
																		`Failed to persist config for ${agent.id}: ${error?.message || error}`,
																		'NewInstanceModal'
																	);
																}
															}
														}}
														availableModels={hostAvailableModels?.[agent.id] || []}
														loadingModels={loadingModels[agent.id] || false}
														onRefreshModels={() => loadModelsForAgent(agent.id, true)}
														onRefreshAgent={() => handleRefreshAgent(agent.id)}
														refreshingAgent={refreshingAgent === agent.id}
														showBuiltInEnvVars
													/>
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}

						{/* Hook behavior note. Renderer used `shell.openExternal`; the
						    lift uses `window.open(url, '_blank',
						    'noopener,noreferrer')` per the StandingOvationOverlay /
						    MarketplaceModal precedent. */}
						<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
							Agent hooks run per-message. Use{' '}
							<button
								type="button"
								className="underline hover:opacity-80"
								style={{ color: theme.colors.accent }}
								onClick={() =>
									window.open(
										'https://docs.runmaestro.ai/autorun-playbooks#environment-variables',
										'_blank',
										'noopener,noreferrer'
									)
								}
							>
								MAESTRO_SESSION_RESUMED
							</button>{' '}
							to skip on resumed sessions.
						</p>

						{/* Debug Info Display */}
						{debugInfo && (
							<div
								className="mt-3 p-3 rounded border text-xs font-mono overflow-auto max-h-40"
								style={{
									backgroundColor: theme.colors.error + '10',
									borderColor: theme.colors.error + '40',
									color: theme.colors.textMain,
								}}
							>
								<div className="font-bold mb-2" style={{ color: theme.colors.error }}>
									Debug Info: {debugInfo.binaryName} not found
								</div>
								{debugInfo.error && <div className="mb-2 text-red-400">{debugInfo.error}</div>}
								<div className="space-y-1 opacity-70">
									<div>
										<span className="opacity-50">Platform:</span> {debugInfo.platform}
									</div>
									<div>
										<span className="opacity-50">Home:</span> {debugInfo.homeDir}
									</div>
									<div>
										<span className="opacity-50">PATH:</span>
									</div>
									<div className="pl-2 break-all text-[10px]">
										{debugInfo.envPath.split(':').map((p) => (
											<div key={`${debugInfo.platform}-${p}`}>{p}</div>
										))}
									</div>
								</div>
								<button
									onClick={() => setDebugInfo(null)}
									className="mt-2 text-xs underline"
									style={{ color: theme.colors.textDim }}
								>
									Dismiss
								</button>
							</div>
						)}
					</div>

					{/* Working Directory */}
					<FormInput
						theme={theme}
						label="Working Directory"
						value={workingDir}
						onChange={handleWorkingDirChange}
						placeholder={
							isSshEnabled
								? `Enter remote path${sshRemoteHost ? ` on ${sshRemoteHost}` : ''} (e.g., /home/user/project)`
								: 'Select directory...'
						}
						monospace
						heightClass="p-2"
						addon={
							onFolderPick ? (
								<button
									onClick={isSshEnabled ? undefined : handleSelectFolder}
									disabled={isSshEnabled}
									className={`p-2 rounded border transition-colors ${isSshEnabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-opacity-10'}`}
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
									title={
										isSshEnabled
											? `Folder picker unavailable for SSH remote${sshRemoteHost ? ` (${sshRemoteHost})` : ''}. Enter the remote path manually.`
											: `Browse folders (${formatShortcutKeys(['Meta', 'o'])})`
									}
								>
									<Folder className="w-5 h-5" />
								</button>
							) : undefined
						}
					/>

					{/* Remote path validation status — only shown when SSH is enabled
					    AND the host supplied `onRemotePathValidate` (server-side
					    `/api/fs/stat` 501s on ?sshRemoteId=). */}
					{isSshEnabled && onRemotePathValidate && workingDir.trim() && (
						<div className="mt-2 text-xs flex items-center gap-1.5">
							{remotePathValidation.checking ? (
								<>
									<div
										className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
										style={{ borderColor: theme.colors.textDim, borderTopColor: 'transparent' }}
									/>
									<span style={{ color: theme.colors.textDim }}>Checking remote path...</span>
								</>
							) : remotePathValidation.valid ? (
								<>
									<Check className="w-3.5 h-3.5" style={{ color: theme.colors.success }} />
									<span style={{ color: theme.colors.success }}>Remote directory found</span>
								</>
							) : remotePathValidation.error ? (
								<>
									<X className="w-3.5 h-3.5" style={{ color: theme.colors.error }} />
									<span style={{ color: theme.colors.error }}>{remotePathValidation.error}</span>
								</>
							) : null}
						</div>
					)}

					{/* Directory Warning with Acknowledgment */}
					{validation.warning && validation.warningField === 'directory' && (
						<div
							className="p-3 rounded border"
							style={{
								backgroundColor: theme.colors.warning + '15',
								borderColor: theme.colors.warning + '50',
							}}
						>
							<div className="flex items-start gap-2">
								<AlertTriangle
									className="w-4 h-4 flex-shrink-0 mt-0.5"
									style={{ color: theme.colors.warning }}
								/>
								<div className="flex-1">
									<p className="text-sm" style={{ color: theme.colors.textMain }}>
										{validation.warning}
									</p>
									<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
										We recommend using a unique directory for each managed agent.
									</p>
									<label className="flex items-center gap-2 mt-3 cursor-pointer">
										<input
											type="checkbox"
											checked={directoryWarningAcknowledged}
											onChange={(e) => setDirectoryWarningAcknowledged(e.target.checked)}
											className="w-4 h-4 rounded"
											style={{ accentColor: theme.colors.warning }}
										/>
										<span className="text-sm" style={{ color: theme.colors.textMain }}>
											I understand the risk and want to proceed
										</span>
									</label>
								</div>
							</div>
						</div>
					)}

					{/* SSH Remote Execution - Top Level */}
					{/* Show SSH selector when remotes are configured, regardless of agent selection */}
					{/* This allows users to see and configure SSH settings even while troubleshooting agent detection */}
					{/* Uses '_pending_' key when no agent selected, transfers to agent when selected */}
					{sshRemotes.length > 0 && (
						<SshRemoteSelector
							theme={theme}
							sshRemotes={sshRemotes}
							sshRemoteConfig={
								agentSshRemoteConfigs[selectedAgent] || agentSshRemoteConfigs['_pending_']
							}
							onSshRemoteConfigChange={(config) => {
								setAgentSshRemoteConfigs((prev) => {
									const newConfigs: Record<string, AgentSshRemoteConfig> = {
										...prev,
										_pending_: config,
									};
									if (selectedAgent) {
										newConfigs[selectedAgent] = config;
									}
									return newConfigs;
								});
							}}
						/>
					)}

					{/* Nudge Message */}
					<div>
						<div
							className="block text-xs font-bold opacity-70 uppercase mb-2"
							style={{ color: theme.colors.textMain }}
						>
							Nudge Message <span className="font-normal opacity-50">(optional)</span>
						</div>
						<textarea
							value={nudgeMessage}
							onChange={(e) => setNudgeMessage(e.target.value.slice(0, NUDGE_MESSAGE_MAX_LENGTH))}
							placeholder="Instructions appended to every message you send..."
							className="w-full p-2 rounded border bg-transparent outline-none resize-none text-sm"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								minHeight: '80px',
							}}
							maxLength={NUDGE_MESSAGE_MAX_LENGTH}
						/>
						<p className="mt-1 text-xs" style={{ color: theme.colors.textDim }}>
							{nudgeMessage.length}/{NUDGE_MESSAGE_MAX_LENGTH} characters. This text is added to
							every message you send to the agent (not visible in chat).
						</p>
					</div>
				</div>
			</Modal>
		</div>
	);
}

/**
 * EditAgentModal - Modal for editing an existing agent's settings
 *
 * Allows editing:
 * - Agent name
 * - Nudge message
 *
 * Does NOT allow editing:
 * - Agent provider (toolType)
 * - Working directory (projectRoot)
 *
 * webFull-lift adapts mirror NewInstanceModal: agents.detect / agents.refresh
 * via `/api/agents/*` routes; sshRemote.getConfigs via `/api/ssh-remotes`;
 * agents.getConfig / setConfig / getModels promoted to props; remote-path
 * validation promoted to `onRemotePathValidate` prop. The `Copy ID`
 * affordance in the custom header uses the lifted webFull
 * `safeClipboardWrite` (pure `navigator.clipboard.writeText`, no IPC).
 */
export function EditAgentModal({
	isOpen,
	onClose,
	onSave,
	theme,
	session,
	existingSessions,
	agentConfigs: hostAgentConfigs,
	availableModels: hostAvailableModels,
	onRefreshModels: hostRefreshModels,
	onAgentConfigSave,
	onRemotePathValidate,
}: EditAgentModalProps) {
	const detectedUrlRef = useRef<string>(buildApiUrl('/agents/detected'));
	const sshRemotesUrlRef = useRef<string>(buildApiUrl('/ssh-remotes'));

	const [instanceName, setInstanceName] = useState('');
	const [nudgeMessage, setNudgeMessage] = useState('');
	const [agent, setAgent] = useState<AgentConfig | null>(null);
	const [agentConfig, setAgentConfig] = useState<Record<string, any>>({});
	const [loadingModels, setLoadingModels] = useState(false);
	const [customPath, setCustomPath] = useState('');
	const [customArgs, setCustomArgs] = useState('');
	const [customEnvVars, setCustomEnvVars] = useState<Record<string, string>>({});
	const [_customModel, setCustomModel] = useState('');
	const [refreshingAgent, setRefreshingAgent] = useState(false);
	const [copiedId, setCopiedId] = useState(false);
	// Provider change state
	const [selectedToolType, setSelectedToolType] = useState<ToolType>(
		session?.toolType ?? 'claude-code'
	);
	// SSH Remote configuration
	const [sshRemotes, setSshRemotes] = useState<SshRemoteConfig[]>([]);
	const [sshRemoteConfig, setSshRemoteConfig] = useState<AgentSshRemoteConfig | undefined>(
		undefined
	);
	// Remote path validation state (validates projectRoot exists on remote when SSH enabled)
	const [remotePathValidation, setRemotePathValidation] = useState<{
		checking: boolean;
		valid: boolean;
		isDirectory: boolean;
		error?: string;
	}>({ checking: false, valid: false, isDirectory: false });

	const nameInputRef = useRef<HTMLInputElement>(null);

	// Copy session ID to clipboard
	const handleCopySessionId = useCallback(async () => {
		const ok = await safeClipboardWrite(session!.id);
		if (ok) {
			setCopiedId(true);
			setTimeout(() => setCopiedId(false), 2000);
		}
	}, [session]);

	// Track whether provider has been changed from the original
	const providerChanged = session ? selectedToolType !== session.toolType : false;

	// Load agent info, config, custom settings, and models when modal opens or provider changes
	useEffect(() => {
		if (!(isOpen && session)) return;
		let cancelled = false;
		(async () => {
			const activeToolType = selectedToolType;
			const isProviderSwitch = activeToolType !== session.toolType;

			// Load agent definition to get configOptions — via /api/agents/detected
			try {
				const res = await fetch(detectedUrlRef.current);
				if (res.ok) {
					const json = (await res.json()) as { agents?: AgentConfig[] };
					const allAgents = json.agents || [];
					const foundAgent = allAgents.find((a) => a.id === activeToolType);
					if (!cancelled) {
						setAgent(foundAgent || null);

						// Load models if agent supports model selection — via host prop
						if (foundAgent?.capabilities?.supportsModelSelection && hostRefreshModels) {
							setLoadingModels(true);
							try {
								await hostRefreshModels(activeToolType, false);
							} catch (err: any) {
								webLogger.error(`Failed to load models: ${err?.message || err}`, 'EditAgentModal');
							} finally {
								if (!cancelled) setLoadingModels(false);
							}
						}
					}
				}
			} catch (err: any) {
				webLogger.error(`Failed to detect agents: ${err?.message || err}`, 'EditAgentModal');
			}

			// Load agent config for defaults — via host prop (replaces agents.getConfig)
			if (!cancelled) {
				const globalConfig: Record<string, any> = { ...(hostAgentConfigs?.[activeToolType] || {}) };
				if (isProviderSwitch) {
					setAgentConfig(globalConfig);
				} else {
					const modelValue = session.customModel ?? globalConfig.model ?? '';
					const contextWindowValue = session.customContextWindow ?? globalConfig.contextWindow;
					setAgentConfig({ ...globalConfig, model: modelValue, contextWindow: contextWindowValue });
				}
			}

			// Load SSH remote config from session (per-session, not global)
			if (!cancelled) {
				if (session.sessionSshRemoteConfig?.enabled && session.sessionSshRemoteConfig?.remoteId) {
					setSshRemoteConfig({
						enabled: true,
						remoteId: session.sessionSshRemoteConfig.remoteId,
						workingDirOverride: session.sessionSshRemoteConfig.workingDirOverride,
					});
				} else {
					setSshRemoteConfig(undefined);
				}
			}

			// Load SSH remote configurations — via /api/ssh-remotes
			try {
				const res = await fetch(sshRemotesUrlRef.current);
				if (res.ok) {
					const json = (await res.json()) as { configs?: SshRemoteConfig[] };
					if (!cancelled && json.configs) {
						setSshRemotes(json.configs);
					}
				}
			} catch (err: any) {
				webLogger.error(`Failed to load SSH remotes: ${err?.message || err}`, 'EditAgentModal');
			}

			// Load per-session config (stored on the session/agent instance)
			// When provider changed, clear provider-specific overrides
			if (!cancelled) {
				if (isProviderSwitch) {
					setCustomPath('');
					setCustomArgs('');
					setCustomEnvVars({});
					setCustomModel('');
				} else {
					setCustomPath(session.customPath ?? '');
					setCustomArgs(session.customArgs ?? '');
					setCustomEnvVars(session.customEnvVars ?? {});
					setCustomModel(session.customModel ?? '');
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isOpen, session, selectedToolType, hostAgentConfigs, hostRefreshModels]);

	// Populate form when session changes or modal opens
	useEffect(() => {
		if (isOpen && session) {
			setInstanceName(session.name);
			setNudgeMessage(session.nudgeMessage || '');
			setSelectedToolType(session.toolType);
		}
	}, [isOpen, session]);

	// Validate session name uniqueness (excluding current session)
	const validation = useMemo(() => {
		const name = instanceName.trim();
		if (!name || !session) {
			return { valid: true }; // Don't show errors until fields are filled
		}
		return validateEditSession(name, session.id, existingSessions);
	}, [instanceName, session, existingSessions]);

	// Check if SSH remote is enabled
	const editSshRemoteId = sshRemoteConfig?.enabled ? sshRemoteConfig.remoteId : null;
	const isSshEnabled = !!editSshRemoteId;

	// Get SSH remote host for display
	const sshRemoteHost = useMemo(() => {
		if (!editSshRemoteId) return undefined;
		const remote = sshRemotes.find((r) => r.id === editSshRemoteId);
		return remote?.host;
	}, [editSshRemoteId, sshRemotes]);

	// Validate remote path when SSH is enabled (debounced).
	// Promoted to `onRemotePathValidate` host prop — same reason as
	// NewInstanceModal (server-side /api/fs/stat 501s on ?sshRemoteId=).
	useEffect(() => {
		// Only validate when SSH is enabled, host supplied validator, and we have a session
		if (!editSshRemoteId || !session || !onRemotePathValidate) {
			setRemotePathValidation({ checking: false, valid: false, isDirectory: false });
			return;
		}

		const projectRoot = session.projectRoot;
		if (!projectRoot) {
			setRemotePathValidation({ checking: false, valid: false, isDirectory: false });
			return;
		}

		// Debounce the validation (useful when user is switching remotes)
		const timeoutId = setTimeout(async () => {
			setRemotePathValidation((prev) => ({ ...prev, checking: true }));

			try {
				const stat = await onRemotePathValidate(projectRoot, editSshRemoteId);
				if (stat && stat.isDirectory && stat.valid) {
					setRemotePathValidation({
						checking: false,
						valid: true,
						isDirectory: true,
					});
				} else if (stat && stat.error) {
					setRemotePathValidation({
						checking: false,
						valid: false,
						isDirectory: false,
						error: stat.error,
					});
				} else {
					setRemotePathValidation({
						checking: false,
						valid: false,
						isDirectory: false,
						error: 'Path not found on remote',
					});
				}
			} catch {
				setRemotePathValidation({
					checking: false,
					valid: false,
					isDirectory: false,
					error: 'Path not found on remote',
				});
			}
		}, 300);

		return () => clearTimeout(timeoutId);
	}, [editSshRemoteId, session, onRemotePathValidate]);

	const handleSave = useCallback(() => {
		const currentSession = session!;
		const name = instanceName.trim();
		if (!name) return;

		// Validate before saving
		const result = validateEditSession(name, currentSession.id, existingSessions);
		if (!result.valid) return;

		// Get model and contextWindow from agentConfig (which is updated via onConfigChange)
		const modelValue = agentConfig.model?.trim() || undefined;
		const contextWindowValue =
			typeof agentConfig.contextWindow === 'number' && agentConfig.contextWindow > 0
				? agentConfig.contextWindow
				: undefined;

		// Build per-session SSH remote config: ALWAYS pass explicitly to override any agent-level config
		// When disabled or no remoteId, we explicitly pass enabled: false to ensure local execution
		const sessionSshRemoteConfig =
			sshRemoteConfig?.enabled && sshRemoteConfig?.remoteId
				? {
						enabled: true,
						remoteId: sshRemoteConfig.remoteId,
						workingDirOverride: sshRemoteConfig.workingDirOverride,
					}
				: { enabled: false, remoteId: null };

		// Save with per-session config fields including model, contextWindow, and SSH config
		onSave(
			currentSession.id,
			name,
			providerChanged ? selectedToolType : undefined,
			nudgeMessage.trim() || undefined,
			customPath.trim() || undefined,
			customArgs.trim() || undefined,
			Object.keys(customEnvVars).length > 0 ? customEnvVars : undefined,
			modelValue,
			contextWindowValue,
			sessionSshRemoteConfig
		);
		onClose();
	}, [
		session,
		instanceName,
		nudgeMessage,
		customPath,
		customArgs,
		customEnvVars,
		agentConfig,
		sshRemoteConfig,
		selectedToolType,
		providerChanged,
		onSave,
		onClose,
		existingSessions,
	]);

	// Refresh available models — promoted to host prop (no-op if host
	// doesn't supply `hostRefreshModels`).
	const refreshModels = useCallback(async () => {
		if (!agent?.capabilities?.supportsModelSelection) return;
		if (!hostRefreshModels) return;
		setLoadingModels(true);
		try {
			await hostRefreshModels(selectedToolType, true);
		} catch (err: any) {
			webLogger.error(`Failed to refresh models: ${err?.message || err}`, 'EditAgentModal');
		} finally {
			setLoadingModels(false);
		}
	}, [selectedToolType, agent, hostRefreshModels]);

	// Refresh agent detection — via /api/agents/detect/:agentId
	const handleRefreshAgent = useCallback(async () => {
		setRefreshingAgent(true);
		try {
			const res = await fetch(
				buildApiUrl(`/agents/detect/${encodeURIComponent(selectedToolType)}`)
			);
			if (res.ok) {
				const json = (await res.json()) as { agents?: AgentConfig[] };
				const allAgents = json.agents || [];
				const foundAgent = allAgents.find((a) => a.id === selectedToolType);
				setAgent(foundAgent || null);
			} else {
				webLogger.error(`Failed to refresh agent: HTTP ${res.status}`, 'EditAgentModal');
			}
		} catch (error: any) {
			webLogger.error(`Failed to refresh agent: ${error?.message || error}`, 'EditAgentModal');
		} finally {
			setRefreshingAgent(false);
		}
	}, [selectedToolType]);

	// Check if form is valid for submission
	const isFormValid = useMemo(() => {
		// Remote path validation is informational only - don't block save
		// Users may want to configure SSH remote before the path exists
		return !!instanceName.trim() && validation.valid;
	}, [instanceName, validation.valid]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle Cmd+Enter for saving
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				e.stopPropagation();
				if (isFormValid) {
					handleSave();
				}
				return;
			}
		},
		[handleSave, isFormValid]
	);

	if (!isOpen || !session) return null;

	const agentName = getAgentDisplayName(selectedToolType);

	return (
		<div onKeyDown={handleKeyDown} role="group" aria-label="Edit agent dialog">
			<Modal
				theme={theme}
				title={`Edit Agent: ${session.name}`}
				priority={MODAL_PRIORITIES.NEW_INSTANCE}
				onClose={onClose}
				width={600}
				initialFocusRef={nameInputRef}
				customHeader={
					<div
						className="p-4 border-b flex items-center justify-between shrink-0"
						style={{ borderColor: theme.colors.border }}
					>
						<h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
							Edit Agent: {session.name}
						</h2>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={handleCopySessionId}
								className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase transition-colors hover:opacity-80"
								style={{
									backgroundColor: copiedId
										? theme.colors.success + '20'
										: theme.colors.accent + '20',
									color: copiedId ? theme.colors.success : theme.colors.accent,
									border: `1px solid ${copiedId ? theme.colors.success : theme.colors.accent}40`,
								}}
								title={copiedId ? 'Copied!' : `Click to copy: ${session.id}`}
							>
								{copiedId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
								<span>{session.id.slice(0, 8)}</span>
							</button>
							<button
								type="button"
								onClick={onClose}
								className="p-1 rounded hover:bg-white/10 transition-colors"
								style={{ color: theme.colors.textDim }}
								aria-label="Close modal"
							>
								<X className="w-4 h-4" />
							</button>
						</div>
					</div>
				}
				footer={
					<ModalFooter
						theme={theme}
						onCancel={onClose}
						onConfirm={handleSave}
						confirmLabel="Save Changes"
						confirmDisabled={!isFormValid}
					/>
				}
			>
				<div className="space-y-5">
					{/* Agent Name */}
					<FormInput
						ref={nameInputRef}
						id="edit-agent-name-input"
						theme={theme}
						label="Agent Name"
						value={instanceName}
						onChange={setInstanceName}
						placeholder=""
						error={validation.errorField === 'name' ? validation.error : undefined}
						heightClass="p-2"
					/>

					{/* Agent Provider */}
					<div>
						<div
							className="block text-xs font-bold opacity-70 uppercase mb-2"
							style={{ color: theme.colors.textMain }}
						>
							Agent Provider
						</div>
						<select
							value={selectedToolType}
							onChange={(e) => setSelectedToolType(e.target.value as ToolType)}
							className="w-full p-2 rounded border bg-transparent outline-none text-sm"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								backgroundColor: theme.colors.bgMain,
							}}
						>
							{SUPPORTED_AGENTS.map((agentId) => (
								<option key={agentId} value={agentId}>
									{getAgentDisplayName(agentId)}
								</option>
							))}
						</select>
						{providerChanged && (
							<div
								className="mt-2 p-2 rounded border text-xs flex items-start gap-2"
								style={{
									borderColor: theme.colors.warning + '60',
									backgroundColor: theme.colors.warning + '10',
									color: theme.colors.warning,
								}}
							>
								<AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
								<span>
									Changing the provider will clear your session list (tabs). Your history panel data
									will persist.
								</span>
							</div>
						)}
					</div>

					{/* Working Directory (read-only) */}
					<div>
						<div
							className="block text-xs font-bold opacity-70 uppercase mb-2"
							style={{ color: theme.colors.textMain }}
						>
							Working Directory
						</div>
						<div
							className="p-2 rounded border font-mono text-sm overflow-hidden text-ellipsis"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textDim,
								backgroundColor: theme.colors.bgActivity,
							}}
							title={session.projectRoot}
						>
							{session.projectRoot}
						</div>
						<p className="mt-1 text-xs" style={{ color: theme.colors.textDim }}>
							Directory cannot be changed. Create a new agent for a different directory.
						</p>
						{/* Remote path validation status — only shown when SSH is enabled
						    AND the host supplied `onRemotePathValidate`. */}
						{isSshEnabled && onRemotePathValidate && (
							<div className="mt-2 text-xs flex items-center gap-1.5">
								{remotePathValidation.checking ? (
									<>
										<div
											className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
											style={{ borderColor: theme.colors.textDim, borderTopColor: 'transparent' }}
										/>
										<span style={{ color: theme.colors.textDim }}>
											Checking path on {sshRemoteHost || 'remote'}...
										</span>
									</>
								) : remotePathValidation.valid ? (
									<>
										<Check className="w-3.5 h-3.5" style={{ color: theme.colors.success }} />
										<span style={{ color: theme.colors.success }}>
											Directory found on {sshRemoteHost || 'remote'}
										</span>
									</>
								) : remotePathValidation.error ? (
									<>
										<X className="w-3.5 h-3.5" style={{ color: theme.colors.error }} />
										<span style={{ color: theme.colors.error }}>
											{remotePathValidation.error}
											{sshRemoteHost ? ` (${sshRemoteHost})` : ''}
										</span>
									</>
								) : null}
							</div>
						)}
					</div>

					{/* Nudge Message */}
					<div>
						<div
							className="block text-xs font-bold opacity-70 uppercase mb-2"
							style={{ color: theme.colors.textMain }}
						>
							Nudge Message <span className="font-normal opacity-50">(optional)</span>
						</div>
						<textarea
							value={nudgeMessage}
							onChange={(e) => setNudgeMessage(e.target.value.slice(0, NUDGE_MESSAGE_MAX_LENGTH))}
							placeholder="Instructions appended to every message you send..."
							className="w-full p-2 rounded border bg-transparent outline-none resize-none text-sm"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								minHeight: '80px',
							}}
							maxLength={NUDGE_MESSAGE_MAX_LENGTH}
						/>
						<p className="mt-1 text-xs" style={{ color: theme.colors.textDim }}>
							{nudgeMessage.length}/{NUDGE_MESSAGE_MAX_LENGTH} characters. This text is added to
							every message you send to the agent (not visible in chat).
						</p>
					</div>

					{/* Agent Configuration (custom path, args, env vars, agent-specific settings) */}
					{/* Per-session config (path, args, env vars) saved on modal save, not on blur */}
					{agent && (
						<div>
							<div
								className="block text-xs font-bold opacity-70 uppercase mb-2"
								style={{ color: theme.colors.textMain }}
							>
								{agentName} Settings
							</div>
							<AgentConfigPanel
								theme={theme}
								agent={agent}
								customPath={customPath}
								onCustomPathChange={setCustomPath}
								onCustomPathBlur={() => {
									/* Saved on modal save */
								}}
								onCustomPathClear={() => setCustomPath('')}
								customArgs={customArgs}
								onCustomArgsChange={setCustomArgs}
								onCustomArgsBlur={() => {
									/* Saved on modal save */
								}}
								onCustomArgsClear={() => setCustomArgs('')}
								customEnvVars={customEnvVars}
								onEnvVarKeyChange={(oldKey, newKey, value) => {
									const newVars = { ...customEnvVars };
									delete newVars[oldKey];
									newVars[newKey] = value;
									setCustomEnvVars(newVars);
								}}
								onEnvVarValueChange={(key, value) => {
									setCustomEnvVars((prev) => ({ ...prev, [key]: value }));
								}}
								onEnvVarRemove={(key) => {
									const newVars = { ...customEnvVars };
									delete newVars[key];
									setCustomEnvVars(newVars);
								}}
								onEnvVarAdd={() => {
									let newKey = 'NEW_VAR';
									let counter = 1;
									while (customEnvVars[newKey]) {
										newKey = `NEW_VAR_${counter}`;
										counter++;
									}
									setCustomEnvVars((prev) => ({ ...prev, [newKey]: '' }));
								}}
								onEnvVarsBlur={() => {
									/* Saved on modal save */
								}}
								agentConfig={agentConfig}
								onConfigChange={(key, value) => {
									setAgentConfig((prev) => ({ ...prev, [key]: value }));
								}}
								onConfigBlur={(key, value) => {
									// Both model and contextWindow are now saved per-session on modal save;
									// other config options (if any) are persisted at agent level via host prop.
									const updatedConfig = { ...agentConfig, [key]: value };
									const {
										model: _model,
										contextWindow: _contextWindow,
										...otherConfig
									} = updatedConfig;
									if (Object.keys(otherConfig).length > 0 && onAgentConfigSave) {
										try {
											onAgentConfigSave(selectedToolType, otherConfig);
										} catch (error: any) {
											webLogger.error(
												`Failed to persist config for ${selectedToolType}: ${error?.message || error}`,
												'EditAgentModal'
											);
										}
									}
								}}
								availableModels={hostAvailableModels?.[selectedToolType] || []}
								loadingModels={loadingModels}
								onRefreshModels={refreshModels}
								onRefreshAgent={handleRefreshAgent}
								refreshingAgent={refreshingAgent}
								showBuiltInEnvVars
								isSshEnabled={isSshEnabled}
							/>
						</div>
					)}

					{/* SSH Remote Execution - Top Level */}
					{sshRemotes.length > 0 && (
						<SshRemoteSelector
							theme={theme}
							sshRemotes={sshRemotes}
							sshRemoteConfig={sshRemoteConfig}
							onSshRemoteConfigChange={setSshRemoteConfig}
						/>
					)}
				</div>
			</Modal>
		</div>
	);
}
