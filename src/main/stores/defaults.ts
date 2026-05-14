/**
 * Store Default Values
 *
 * Centralized default values for all stores.
 * Separated for easy modification and testing.
 */

import path from 'path';
import { isWindows } from '../../shared/platformDetection';

import type {
	MaestroSettings,
	SessionsData,
	GroupsData,
	AgentConfigsData,
	WindowState,
	ClaudeSessionOriginsData,
	AgentSessionOriginsData,
} from './types';

// ============================================================================
// Utility Functions for Defaults
// ============================================================================

/**
 * Get the default shell based on the current platform.
 */
export function getDefaultShell(): string {
	// Windows: $SHELL doesn't exist; default to PowerShell
	if (isWindows()) {
		return 'powershell';
	}
	// Unix: Respect user's configured login shell from $SHELL
	const shellPath = process.env.SHELL;
	if (shellPath) {
		const shellName = path.basename(shellPath);
		// Valid Unix shell IDs from shellDetector.ts
		if (['bash', 'zsh', 'fish', 'sh', 'tcsh'].includes(shellName)) {
			return shellName;
		}
	}
	// Fallback to bash (more portable than zsh on older Unix systems)
	return 'bash';
}

// ============================================================================
// Store Defaults
// ============================================================================

export const SETTINGS_DEFAULTS: MaestroSettings = {
	activeThemeId: 'dracula',
	llmProvider: 'openrouter',
	modelSlug: 'anthropic/claude-3.5-sonnet',
	apiKey: '',
	shortcuts: {},
	fontSize: 14,
	fontFamily: 'Roboto Mono, Menlo, "Courier New", monospace',
	customFonts: [],
	logLevel: 'info',
	defaultShell: getDefaultShell(),
	webAuthEnabled: false,
	webAuthToken: null,
	persistentWebLink: false,
	webInterfaceUseCustomPort: false,
	webInterfaceCustomPort: 8080,
	sshRemotes: [],
	defaultSshRemoteId: null,
	sshRemoteIgnorePatterns: ['.git', '.*cache*'],
	sshRemoteHonorGitignore: false,
	installationId: null,
	wakatimeEnabled: false,
	wakatimeApiKey: '',
	wakatimeDetailedTracking: false,
	totalActiveTimeMs: 0,
	spellCheck: false,
	// Claude Code headless mode. Phase 3 ships `'auto'` as the shipping default —
	// `maestro-p` is the cheapest viable mode per turn, with auto-fallback to
	// `claude --print` when the Max plan quota is hit. Users who explicitly chose
	// `'api'` under the phase 2 default are preserved by the migration in
	// `./migrations/claudeCodeHeadlessModeAuto.ts`. Nested under `claudeCode` so
	// electron-store dot-notation access works (e.g.
	// `settingsStore.get('claudeCode.headlessMode')`).
	claudeCode: {
		headlessMode: 'auto',
		autoFallbackToApiOnLimit: true,
	},
};

export const SESSIONS_DEFAULTS: SessionsData = {
	sessions: [],
};

export const GROUPS_DEFAULTS: GroupsData = {
	groups: [],
};

export const AGENT_CONFIGS_DEFAULTS: AgentConfigsData = {
	configs: {},
};

export const WINDOW_STATE_DEFAULTS: WindowState = {
	width: 1400,
	height: 900,
	isMaximized: false,
	isFullScreen: false,
};

export const CLAUDE_SESSION_ORIGINS_DEFAULTS: ClaudeSessionOriginsData = {
	origins: {},
};

export const AGENT_SESSION_ORIGINS_DEFAULTS: AgentSessionOriginsData = {
	origins: {},
};
