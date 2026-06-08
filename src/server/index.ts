/**
 * Maestro Server — headless entrypoint.
 *
 * Runs Maestro's existing Fastify+WebSocket server (`src/main/web-server/WebServer`)
 * as a vanilla Node process. NO electron import, NO BrowserWindow.
 *
 * Layer 0a — boot-only. READ callbacks wired to file-backed stores.
 * Layer 0b — WRITE callbacks that need a real pty: writeToSession,
 *            executeCommand, interruptSession via ServerProcessManagerAdapter.
 * Layer 0c — WRITE callbacks that are pure store mutations + broadcast:
 *            switchMode, closeTab, renameTab, starTab, reorderTab,
 *            toggleBookmark via sessions-mutator + WebServer broadcast*.
 *            Plus selectSession / selectTab as headless no-ops (each browser
 *            tab owns its view state in web mode).
 *
 * Deferred: newTab (needs spawn pipeline — L0d scope).
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
import * as mutator from './sessions-mutator';

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
// Layer 0b wired writeToSession, executeCommand, and interruptSession through
// ServerProcessManagerAdapter (pty-side, no sessions-store mutation).
//
// Layer 0c wires 8 more callbacks through the sessions store. The strategic
// framing per callback (decided in the parent brief and recorded in ISA.md):
//
//   (A) Persist + broadcast — the op IS state. Mutate sessions store, write
//       back, broadcast via WebServer.broadcast* so other connected web
//       clients see the change.
//          switchMode, closeTab, renameTab, starTab, reorderTab, toggleBookmark
//
//   (C) Defer to UI-orchestration layer — the op is a "drive the desktop
//       window" call that has no equivalent in headless mode. Each browser
//       tab manages its own view state. Log + return true so the WS round-
//       trips cleanly without breaking the client.
//          selectSession, selectTab
//
//   Out of scope for L0c (deferred): newTab. It has to actually spawn a
//   process (not just mutate store), which needs a server-side session-
//   creation pipeline that is L0d scope. Kept as a stub returning null.

const notImplementedWrite = (op: string) => (..._args: unknown[]): false | null => {
	console.warn(
		`[maestro-server] WRITE op "${op}" not implemented; deferred to a later layer.`
	);
	return false;
};

// Helper: read sessions, apply a mutator, persist, broadcast. Returns true
// iff the mutator produced a non-null result (i.e. the session existed and
// the mutation was applicable).
function applyMutation(
	op: string,
	mutate: (sessions: StoredSession[]) => mutator.MutationResult<StoredSession> | null,
	onSuccess: (session: StoredSession) => void
): boolean {
	const sessions = sessionsStore.get<StoredSession[]>('sessions', []);
	const result = mutate(sessions);
	if (!result) {
		console.warn(`[maestro-server] ${op}: session not found or no-op; skipping`);
		return false;
	}
	try {
		sessionsStore.set('sessions', result.sessions);
	} catch (err) {
		console.error(`[maestro-server] ${op}: failed to persist sessions`, err);
		return false;
	}
	try {
		onSuccess(result.session);
	} catch (err) {
		console.error(`[maestro-server] ${op}: broadcast threw (mutation already persisted)`, err);
	}
	return true;
}

// AITabData shape required by broadcastTabsChange. Mirrors src/main/web-server/types.ts.
function tabsForBroadcast(session: StoredSession): {
	aiTabs: Array<{
		id: string;
		agentSessionId: string | null;
		name: string | null;
		starred: boolean;
		inputValue: string;
		usageStats?: unknown;
		createdAt: number;
		state: 'idle' | 'busy';
		thinkingStartTime?: number | null;
	}>;
	activeTabId: string;
} {
	const aiTabs = (session.aiTabs ?? []).map((tab) => ({
		id: tab.id as string,
		agentSessionId: (tab.agentSessionId as string | null | undefined) ?? null,
		name: (tab.name as string | null | undefined) ?? null,
		starred: Boolean(tab.starred),
		inputValue: (tab.inputValue as string | undefined) ?? '',
		usageStats: (tab.usageStats as unknown) ?? null,
		createdAt: (tab.createdAt as number | undefined) ?? Date.now(),
		state: ((tab.state as 'idle' | 'busy' | undefined) ?? 'idle') as 'idle' | 'busy',
		thinkingStartTime: (tab.thinkingStartTime as number | null | undefined) ?? null,
	}));
	const activeTabId =
		session.activeTabId ?? (aiTabs.length > 0 ? aiTabs[0].id : '');
	return { aiTabs, activeTabId };
}

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

// switchMode — (A) mutate inputMode, broadcast as a session_state_change
// carrying the new inputMode (matches desktop persistence handler's existing
// broadcast contract; renderer side already special-cases inputMode here).
server.setSwitchModeCallback(async (sessionId: string, mode: 'ai' | 'terminal'): Promise<boolean> => {
	const ok = applyMutation(
		'switchMode',
		(sessions) => mutator.switchMode(sessions, sessionId, mode),
		(session) => {
			server.broadcastSessionStateChange(sessionId, session.state ?? 'idle', {
				name: session.name,
				toolType: session.toolType,
				inputMode: session.inputMode,
				cwd: session.cwd,
			});
		}
	);
	console.log(`[maestro-server] switchMode ${sessionId} -> ${mode}: ${ok}`);
	return ok;
});

// selectSession — (C) headless has no global "visible session"; each browser
// tab manages its own view state. Acknowledge the call so the WS handler does
// not surface a generic error to the client.
server.setSelectSessionCallback(async (sessionId: string, tabId?: string): Promise<boolean> => {
	console.log(
		`[maestro-server] selectSession ${sessionId}${tabId ? ` tab=${tabId}` : ''} — ` +
			`no-op in headless mode (web clients manage their own view)`
	);
	return true;
});

// selectTab — (C) same rationale as selectSession; renderer-only concept.
server.setSelectTabCallback(async (sessionId: string, tabId: string): Promise<boolean> => {
	console.log(
		`[maestro-server] selectTab ${sessionId}/${tabId} — no-op in headless mode`
	);
	return true;
});

// newTab — DEFERRED. Spawning is a real side effect, not a store mutation
// (needs ProcessManager.spawn + the renderer's session-creation pipeline).
// Out of scope for L0c; tracked in ISA.md.
server.setNewTabCallback((async (sessionId: string) => {
	console.warn(
		`[maestro-server] newTab ${sessionId}: deferred — spawn pipeline is L0d scope`
	);
	return null;
}) as any);

// closeTab — (A) drop the tab from aiTabs, broadcast new tab array.
server.setCloseTabCallback(async (sessionId: string, tabId: string): Promise<boolean> => {
	const ok = applyMutation(
		'closeTab',
		(sessions) => mutator.closeTab(sessions, sessionId, tabId),
		(session) => {
			const { aiTabs, activeTabId } = tabsForBroadcast(session);
			server.broadcastTabsChange(sessionId, aiTabs, activeTabId);
		}
	);
	console.log(`[maestro-server] closeTab ${sessionId}/${tabId}: ${ok}`);
	return ok;
});

// renameTab — (A) mutate tab name, broadcast new tab array.
server.setRenameTabCallback(
	async (sessionId: string, tabId: string, newName: string): Promise<boolean> => {
		const ok = applyMutation(
			'renameTab',
			(sessions) => mutator.renameTab(sessions, sessionId, tabId, newName),
			(session) => {
				const { aiTabs, activeTabId } = tabsForBroadcast(session);
				server.broadcastTabsChange(sessionId, aiTabs, activeTabId);
			}
		);
		console.log(`[maestro-server] renameTab ${sessionId}/${tabId} -> "${newName}": ${ok}`);
		return ok;
	}
);

// starTab — (A) flip starred flag on tab, broadcast new tab array.
server.setStarTabCallback(
	async (sessionId: string, tabId: string, starred: boolean): Promise<boolean> => {
		const ok = applyMutation(
			'starTab',
			(sessions) => mutator.starTab(sessions, sessionId, tabId, starred),
			(session) => {
				const { aiTabs, activeTabId } = tabsForBroadcast(session);
				server.broadcastTabsChange(sessionId, aiTabs, activeTabId);
			}
		);
		console.log(`[maestro-server] starTab ${sessionId}/${tabId} -> ${starred}: ${ok}`);
		return ok;
	}
);

// reorderTab — (A) splice the aiTabs array, broadcast new order.
server.setReorderTabCallback(
	async (sessionId: string, fromIndex: number, toIndex: number): Promise<boolean> => {
		const ok = applyMutation(
			'reorderTab',
			(sessions) => mutator.reorderTab(sessions, sessionId, fromIndex, toIndex),
			(session) => {
				const { aiTabs, activeTabId } = tabsForBroadcast(session);
				server.broadcastTabsChange(sessionId, aiTabs, activeTabId);
			}
		);
		console.log(`[maestro-server] reorderTab ${sessionId} ${fromIndex}->${toIndex}: ${ok}`);
		return ok;
	}
);

// toggleBookmark — (A) flip bookmarked flag. No dedicated broadcast channel
// exists for bookmark in the WebServer surface (the desktop renderer only
// updates Zustand locally), so we mirror the desktop renderer's behavior and
// skip broadcast on this op. Web clients pick up the new state on next
// getSessions read or sessions_list broadcast.
server.setToggleBookmarkCallback(async (sessionId: string): Promise<boolean> => {
	const ok = applyMutation(
		'toggleBookmark',
		(sessions) => mutator.toggleBookmark(sessions, sessionId),
		() => {
			/* no dedicated broadcast — same as desktop renderer */
		}
	);
	console.log(`[maestro-server] toggleBookmark ${sessionId}: ${ok}`);
	return ok;
});

// notImplementedWrite is kept around because newTab's signature differs
// (returns `null` not `false`). Suppressed-unused below.
void notImplementedWrite;

// ============ Lifecycle ============

async function main() {
	const result = await server.start();
	console.log(`[maestro-server] listening at ${result.url}`);
	console.log(`[maestro-server] data directory: ${dataDir}`);
	console.log(`[maestro-server] sessions visible: ${sessionsStore.get<StoredSession[]>('sessions', []).length}`);
	console.log(
		'[maestro-server] Layer 0c: 9/10 WRITE callbacks active ' +
			'(L0b: writeToSession, executeCommand, interruptSession via ProcessManager; ' +
			'L0c-A: switchMode, closeTab, renameTab, starTab, reorderTab, toggleBookmark ' +
			'via sessions store + broadcast; ' +
			'L0c-C: selectSession, selectTab as headless no-ops). ' +
			'newTab deferred to L0d (requires server-side spawn pipeline).'
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
