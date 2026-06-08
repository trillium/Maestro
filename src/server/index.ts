/**
 * Maestro Server — headless entrypoint.
 *
 * Runs Maestro's existing Fastify+WebSocket server (`src/main/web-server/WebServer`)
 * as a vanilla Node process. NO electron import, NO BrowserWindow.
 *
 * Layer 0a — boot-only. The READ callbacks (sessions, themes, history, custom
 * commands) are wired to file-backed stores so an existing Maestro data
 * directory can be browsed read-only. The WRITE callbacks
 * (`executeCommand`, `interruptSession`, `switchMode`, tab ops, etc.)
 * currently log a warning and return false — server-side write paths are
 * Layer 0b work (see `WEB_PORT_ORDER.md`).
 *
 * Launch:
 *   node dist/server/index.js
 *
 * Env:
 *   MAESTRO_DATA_DIR — where to read settings/sessions JSON.
 *                      Defaults to `~/.config/maestro`.
 *                      Point at `~/Library/Application Support/maestro-dev`
 *                      to mirror a running dev Electron instance.
 *   MAESTRO_WEB_PORT — preferred port (default 0 = OS-assigned).
 */

import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { WebServer } from '../main/web-server/WebServer';
import { getThemeById } from '../main/themes';
import { FileStore } from '../shared/file-store';
import { getDataDir } from '../shared/data-dir';
import { ServerProcessManagerAdapter } from './process-manager-adapter';

type StoredSession = {
	id: string;
	name?: string;
	toolType?: string;
	state?: string;
	inputMode?: string;
	cwd?: string;
	groupId?: string | null;
	usageStats?: unknown;
	aiTabs?: Array<Record<string, unknown>>;
	activeTabId?: string;
	bookmarked?: boolean;
	agentSessionId?: string | null;
	thinkingStartTime?: number | null;
	parentSessionId?: string | null;
	worktreeBranch?: string | null;
	shellLogs?: unknown[];
	isGitRepo?: boolean;
};

type StoredGroup = { id: string; name?: string; emoji?: string };

const dataDir = getDataDir();
const port = process.env.MAESTRO_WEB_PORT ? parseInt(process.env.MAESTRO_WEB_PORT, 10) : 0;

console.log(`[maestro-server] dataDir = ${dataDir}`);

// File-backed stores — preserve electron-store on-disk schema (`<name>.json`).
const settingsStore = new FileStore<Record<string, unknown>>({
	name: 'maestro-settings',
	cwd: dataDir,
	defaults: {},
});

const sessionsStore = new FileStore<{ sessions: StoredSession[] }>({
	name: 'maestro-sessions',
	cwd: dataDir,
	defaults: { sessions: [] },
});

const groupsStore = new FileStore<{ groups: StoredGroup[] }>({
	name: 'maestro-groups',
	cwd: dataDir,
	defaults: { groups: [] },
});

// Persistent token: stored in settings if present, otherwise ephemeral per boot.
// FileStore's generic-V overload is shadowed by the keyof-T overload when T is
// Record<string, unknown>, so the result widens to `unknown`. Cast at the call
// site rather than redesigning the overload set.
let securityToken = settingsStore.get<string>('webAuthToken', '') as string;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!securityToken || !UUID_V4_REGEX.test(securityToken)) {
	securityToken = randomUUID();
	console.log('[maestro-server] using ephemeral token (no valid webAuthToken in settings)');
}

// Layer 0b — ProcessManager adapter. Owns a single ProcessManager instance,
// reads the live sessions store on every call to resolve `-ai` vs `-terminal`
// suffix, and is shut down on SIGINT/SIGTERM below.
const processManagerAdapter = new ServerProcessManagerAdapter((sessionId) => {
	const sessions = sessionsStore.get<StoredSession[]>('sessions', []);
	return sessions.find((s) => s.id === sessionId) ?? null;
});

const server = new WebServer(port, securityToken);

// ============ READ callbacks (functional in headless mode) ============

server.setGetSessionsCallback(() => {
	const sessions = sessionsStore.get<StoredSession[]>('sessions', []);
	const groups = groupsStore.get<StoredGroup[]>('groups', []);
	return sessions.map((s) => {
		const group = s.groupId ? groups.find((g) => g.id === s.groupId) : null;

		// Build mobile-preview lastResponse (replicates web-server-factory logic)
		let lastResponse: { text: string; timestamp: number; source: string; fullLength: number } | null =
			null;
		const activeTab =
			(s.aiTabs?.find((t) => t.id === s.activeTabId) as Record<string, unknown> | undefined) ||
			(s.aiTabs?.[0] as Record<string, unknown> | undefined);
		const tabLogs = (activeTab?.logs as Array<Record<string, unknown>>) || [];
		if (tabLogs.length > 0) {
			const lastAiLog = [...tabLogs]
				.reverse()
				.find((log) => log.source === 'stdout' || log.source === 'stderr');
			if (lastAiLog && typeof lastAiLog.text === 'string') {
				const fullText = lastAiLog.text;
				const lines = fullText.split('\n').slice(0, 3);
				let previewText = lines.join('\n');
				if (previewText.length > 500) {
					previewText = previewText.slice(0, 497) + '...';
				} else if (fullText.length > previewText.length) {
					previewText = previewText + '...';
				}
				lastResponse = {
					text: previewText,
					timestamp: lastAiLog.timestamp as number,
					source: lastAiLog.source as string,
					fullLength: fullText.length,
				};
			}
		}

		const aiTabs =
			s.aiTabs?.map((tab) => ({
				id: tab.id,
				agentSessionId: tab.agentSessionId ?? null,
				name: tab.name ?? null,
				starred: tab.starred ?? false,
				inputValue: tab.inputValue ?? '',
				usageStats: tab.usageStats ?? null,
				createdAt: tab.createdAt,
				state: tab.state ?? 'idle',
				thinkingStartTime: tab.thinkingStartTime ?? null,
			})) ?? [];

		return {
			id: s.id,
			name: s.name,
			toolType: s.toolType,
			state: s.state,
			inputMode: s.inputMode,
			cwd: s.cwd,
			groupId: s.groupId ?? null,
			groupName: group?.name ?? null,
			groupEmoji: group?.emoji ?? null,
			usageStats: s.usageStats ?? null,
			lastResponse,
			agentSessionId: s.agentSessionId ?? null,
			thinkingStartTime: s.thinkingStartTime ?? null,
			aiTabs,
			activeTabId: s.activeTabId ?? (aiTabs.length > 0 ? (aiTabs[0].id as string) : undefined),
			bookmarked: s.bookmarked ?? false,
			parentSessionId: s.parentSessionId ?? null,
			worktreeBranch: s.worktreeBranch ?? null,
		};
	}) as any;
});

server.setGetSessionDetailCallback((sessionId: string, tabId?: string) => {
	const sessions = sessionsStore.get<StoredSession[]>('sessions', []);
	const session = sessions.find((s) => s.id === sessionId);
	if (!session) return null;

	let aiLogs: any[] = [];
	const targetTabId = tabId || session.activeTabId;
	if (session.aiTabs && session.aiTabs.length > 0) {
		const targetTab =
			(session.aiTabs.find((t) => t.id === targetTabId) as Record<string, unknown> | undefined) ||
			(session.aiTabs[0] as Record<string, unknown> | undefined);
		const rawLogs = (targetTab?.logs as Array<Record<string, unknown>>) || [];
		aiLogs = rawLogs.filter((log) => log.source !== 'thinking' && log.source !== 'tool');
	}

	return {
		id: session.id,
		name: session.name,
		toolType: session.toolType,
		state: session.state,
		inputMode: session.inputMode,
		cwd: session.cwd,
		aiLogs,
		shellLogs: session.shellLogs || [],
		usageStats: session.usageStats,
		agentSessionId: session.agentSessionId,
		isGitRepo: session.isGitRepo,
		activeTabId: targetTabId,
	} as any;
});

server.setGetThemeCallback(() => {
	const themeId = settingsStore.get<string>('activeThemeId', 'dracula') as string;
	return getThemeById(themeId);
});

server.setGetBionifyReadingModeCallback(() => {
	return settingsStore.get<boolean>('bionifyReadingMode', false);
});

server.setGetCustomCommandsCallback(() => {
	return settingsStore.get<
		Array<{ id: string; command: string; description: string; prompt: string }>
	>('customAICommands', []);
});

server.setGetHistoryCallback(() => {
	// Layer 0a stub — history requires the HistoryManager which imports electron.
	// Returning empty until Layer 0b ports HistoryManager to a server-side variant.
	return [];
});

// ============ WRITE callbacks ============
//
// Layer 0b: writeToSession, executeCommand, and interruptSession are wired
// through ServerProcessManagerAdapter. The other 7 callbacks (switchMode,
// tab ops, bookmark) remain stubbed — they need write-back to the sessions
// store and broadcast plumbing, which is the Layer 0c scope.

const notImplementedWrite = (op: string) => (..._args: unknown[]): false | null => {
	console.warn(
		`[maestro-server] WRITE op "${op}" called but not implemented yet. ` +
			`Layer 0c will add server-side implementations for store + broadcast.`
	);
	return false;
};

// writeToSession — direct write to ProcessManager. The route at
// POST /:token/api/session/:id/send already appends '\n' before calling this.
server.setWriteToSessionCallback((sessionId: string, data: string): boolean => {
	const result = processManagerAdapter.write(sessionId, data);
	console.log(
		`[maestro-server] writeToSession ${sessionId} (${data.length} bytes) -> ${result}`
	);
	return result;
});

// executeCommand — Layer 0b minimum: route through writeToSession after
// suffix resolution, with a trailing newline. The renderer-side version
// additionally spawns a new session if none exists; that "session creation"
// flow lives in the renderer today and is out of scope for L0b.
server.setExecuteCommandCallback(
	async (sessionId: string, command: string, inputMode?: 'ai' | 'terminal'): Promise<boolean> => {
		const result = await processManagerAdapter.executeCommand(sessionId, command, inputMode);
		console.log(
			`[maestro-server] executeCommand ${sessionId} (mode=${inputMode ?? 'auto'}, ` +
				`${command.length} chars) -> ${result}`
		);
		return result;
	}
);

// interruptSession — forwards to ProcessManager.interrupt (Ctrl-C / SIGINT).
server.setInterruptSessionCallback(async (sessionId: string): Promise<boolean> => {
	const result = await processManagerAdapter.interrupt(sessionId);
	console.log(`[maestro-server] interruptSession ${sessionId} -> ${result}`);
	return result;
});

server.setSwitchModeCallback(notImplementedWrite('switchMode') as any);
server.setSelectSessionCallback(notImplementedWrite('selectSession') as any);
server.setSelectTabCallback(notImplementedWrite('selectTab') as any);
server.setNewTabCallback((async () => {
	console.warn('[maestro-server] WRITE op "newTab" not implemented in Layer 0a');
	return null;
}) as any);
server.setCloseTabCallback(notImplementedWrite('closeTab') as any);
server.setRenameTabCallback(notImplementedWrite('renameTab') as any);
server.setStarTabCallback(notImplementedWrite('starTab') as any);
server.setReorderTabCallback(notImplementedWrite('reorderTab') as any);
server.setToggleBookmarkCallback(notImplementedWrite('toggleBookmark') as any);

// ============ Lifecycle ============

async function main() {
	const result = await server.start();
	console.log(`[maestro-server] listening at ${result.url}`);
	console.log(`[maestro-server] data directory: ${dataDir}`);
	console.log(`[maestro-server] sessions visible: ${sessionsStore.get<StoredSession[]>('sessions', []).length}`);
	console.log(
		'[maestro-server] Layer 0b: 3/10 WRITE callbacks active ' +
			'(writeToSession, executeCommand, interruptSession via ProcessManager). ' +
			'switchMode, tab ops, bookmark still stubbed.'
	);
}

main().catch((err) => {
	console.error('[maestro-server] failed to start', err);
	process.exit(1);
});

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		console.log(`[maestro-server] received ${signal}, shutting down`);
		try {
			processManagerAdapter.shutdown();
		} catch (err) {
			console.error('[maestro-server] processManagerAdapter.shutdown() threw', err);
		}
		server.stop().finally(() => process.exit(0));
	});
}
