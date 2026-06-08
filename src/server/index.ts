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
 * Layer 0d — newTab via sessions-mutator (pattern B: store-only mutation,
 *            no process spawn — first command-send on the tab triggers the
 *            ProcessManager on-demand spawn through the L0b write callback).
 * Layer 0e — Sentry wrapper modules scaffolded (src/server/sentry.ts +
 *            src/webFull/utils/sentry.ts) — replaces @sentry/electron per
 *            surface.
 * Layer 0f — Sentry init wired into main() so any error path can use
 *            captureException. Closes ISC-33 (explicit replacement, not
 *            just absence-from-dist).
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
import { ServerProcessManagerAdapter, resolveProcessId } from './process-manager-adapter';
import * as mutator from './sessions-mutator';
import { initSentry, captureException } from './sentry';
import { RawPtyMultiplexer } from './raw-pty-multiplexer';

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

// newTab — Layer 0f, pattern (B): store-only mutation. Append a tab to
// `aiTabs`, broadcast the new tab array, return `{ tabId }`. NO underlying
// process is spawned here — first command-send into the new tab triggers
// `ProcessManager` on-demand spawn through the L0b `writeToSession` /
// `executeCommand` callback chain. The trade-off (real spawn vs lazy spawn)
// is documented in ISA Decisions: pattern (A) "real spawn at newTab" would
// require lifting the renderer's spawn-config-building logic; pattern (B)
// matches what most web-driven flows expect and keeps the L0 scope tight.
//
// The CallbackRegistry contract is `Promise<{ tabId: string } | null>` — we
// return `null` when the session doesn't exist (matches L0c "session not
// found" pattern), otherwise `{ tabId }` with a fresh UUID.
server.setNewTabCallback(async (sessionId: string): Promise<{ tabId: string } | null> => {
	const sessions = sessionsStore.get<StoredSession[]>('sessions', []);
	const result = mutator.addTab(sessions, sessionId);
	if (!result) {
		console.warn(`[maestro-server] newTab: session ${sessionId} not found; skipping`);
		return null;
	}
	try {
		sessionsStore.set('sessions', result.sessions);
	} catch (err) {
		console.error(`[maestro-server] newTab ${sessionId}: failed to persist sessions`, err);
		return null;
	}
	try {
		const { aiTabs, activeTabId } = tabsForBroadcast(result.session);
		server.broadcastTabsChange(sessionId, aiTabs, activeTabId);
	} catch (err) {
		console.error(
			`[maestro-server] newTab ${sessionId}: broadcast threw (tab already persisted)`,
			err
		);
	}
	console.log(`[maestro-server] newTab ${sessionId} -> ${result.newTabId}`);
	return { tabId: result.newTabId };
});

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

// ============ Layer 6.1: raw PTY multiplexer ============
//
// Wires up the RawPtyMultiplexer between ProcessManager (producer, emits
// 'raw-pty-data' events on every PTY chunk via PtySpawner) and the WS
// broadcast surface (consumer, fans bytes out to subscribed web clients
// via WebServer.broadcastPtyData).
//
// Architecture (per scoping doc §1, §2, §3):
//   - Additive: the existing stripped-output path through DataBufferManager
//     stays exactly as before. Desktop renders the same as it always has.
//     This multiplexer is a parallel raw-byte path consumed only by web
//     clients with an active `pty_subscribe`.
//   - Location: in src/server/, not src/main/. The multiplexer is a
//     server-side concern (lives where the broadcaster lives) and never
//     runs in the Electron desktop process.
//   - Encoding (B): base64 over JSON. Single-protocol WS surface; ~33%
//     wire overhead accepted for simplicity. Binary frames deferred to
//     L6.3 if bandwidth measurements demand it.
//   - Budgets: 4 MB soft / 8 MB hard ring; 5 ms flush / 32 KB threshold
//     (see RAW_PTY_* constants in raw-pty-multiplexer.ts).
//
// Session-id resolution: the PtySpawner emits raw bytes keyed by the
// underlying process id (e.g. `<sessionId>-terminal`). WS clients send
// `pty_subscribe` with the bare `sessionId`. Both the client→multiplexer
// translation and the multiplexer→client translation use resolveProcessId
// so a single bare sessionId maps to the `-terminal`-suffixed multiplexer
// key. AI sessions (toolType !== 'terminal') do not use PTY in the
// shouldUsePty() sense, so pty_subscribe on a non-terminal session simply
// produces an empty backfill — harmless.

const rawPtyMultiplexer = new RawPtyMultiplexer();

// Map a bare-sessionId from the WS protocol to the multiplexer / PtySpawner
// key. Terminal sessions are 1:1 with PTYs in this codebase, so always
// suffix `-terminal` for the multiplexer lookup; this matches what
// PtySpawner emits (PtySpawner.spawn() is invoked with the suffixed id by
// the renderer-side spawn pipeline).
function ptyKeyForSession(sessionId: string): string {
	const session = sessionsStore
		.get<StoredSession[]>('sessions', [])
		.find((s) => s.id === sessionId);
	// Prefer the session's inputMode if known; otherwise default to
	// 'terminal' (raw PTY only matters for terminal-backed sessions anyway).
	return resolveProcessId(sessionId, session?.inputMode ?? 'terminal');
}

// Producer side: subscribe the multiplexer to ProcessManager's emitter so
// every `raw-pty-data` event (sent by PtySpawner.onData) lands in the ring.
rawPtyMultiplexer.attachProducer(processManagerAdapter.processManager);

// Consumer side: install the WS broadcaster shim. The multiplexer calls
// `sendData` / `sendDropped` per-subscriber; we route those through the
// WebServer's point-to-point broadcast helpers.
rawPtyMultiplexer.setBroadcaster({
	sendData: (clientId, ptyKey, bytes, seq) => {
		// Strip the trailing `-terminal` / `-ai` suffix when reporting the
		// sessionId back to the client — clients only know bare IDs.
		const bareSessionId = ptyKey.replace(/-(terminal|ai)$/, '');
		server.broadcastPtyData(clientId, bareSessionId, bytes, seq);
	},
	sendDropped: (clientId, ptyKey, droppedBytes, lastSeq) => {
		const bareSessionId = ptyKey.replace(/-(terminal|ai)$/, '');
		server.broadcastPtyDropped(clientId, bareSessionId, droppedBytes, lastSeq);
	},
});

// Message-handler side: install the four pty_* callbacks. Each translates
// the bare sessionId to the multiplexer key, delegates to the right
// underlying primitive (multiplexer.subscribe / processManager.write etc.),
// and (for subscribe) emits the backfill + dropped marker BEFORE returning.
server.setPtyMessageCallbacks({
	ptySubscribe: (clientId, sessionId, lastSeq) => {
		const key = ptyKeyForSession(sessionId);
		const slice = rawPtyMultiplexer.subscribe(key, clientId, lastSeq);
		if (slice.droppedBeforeBackfill > 0 && typeof lastSeq === 'number') {
			server.broadcastPtyDropped(clientId, sessionId, slice.droppedBeforeBackfill, lastSeq);
		}
		if (slice.bytes.length > 0 && slice.fromSeq !== null && slice.toSeq !== null) {
			server.broadcastPtyBackfill(clientId, sessionId, slice.bytes, slice.fromSeq, slice.toSeq);
		}
		// Note: subscribe always succeeds — the multiplexer auto-creates session
		// state on first reference (a PTY may publish before any client
		// subscribes). The boolean is "session exists in store" for client UX.
		const sessionExists = sessionsStore
			.get<StoredSession[]>('sessions', [])
			.some((s) => s.id === sessionId);
		console.log(
			`[maestro-server] pty_subscribe client=${clientId} session=${sessionId} key=${key} ` +
				`lastSeq=${lastSeq ?? 'none'} backfill=${slice.bytes.length}B ` +
				`dropped=${slice.droppedBeforeBackfill}`
		);
		return sessionExists;
	},
	ptyUnsubscribe: (clientId, sessionId) => {
		const key = ptyKeyForSession(sessionId);
		rawPtyMultiplexer.unsubscribe(key, clientId);
		console.log(`[maestro-server] pty_unsubscribe client=${clientId} session=${sessionId}`);
	},
	ptyInput: (sessionId, data) => {
		// Reuses the existing L0b write path — handles suffix resolution and
		// `lastCommand` snapshot for the stripped-output echo filter.
		const ok = processManagerAdapter.write(sessionId, data);
		return ok;
	},
	ptyResize: (sessionId, cols, rows) => {
		const key = ptyKeyForSession(sessionId);
		return processManagerAdapter.processManager.resize(key, cols, rows);
	},
});

// Disconnect GC: when a WS client drops, evict it from every session's
// subscriber set so the multiplexer doesn't try to send to a closed socket.
// Idempotent — safe even when the client never called pty_subscribe.
server.setClientDisconnectHook((clientId) => {
	rawPtyMultiplexer.unsubscribeAll(clientId);
});

// ============ Lifecycle ============

async function main() {
	// L0f: initialize Sentry FIRST so any subsequent error path can capture.
	// No-op when MAESTRO_SENTRY_DSN is not set (the default for dev runs).
	initSentry();
	const result = await server.start();
	console.log(`[maestro-server] listening at ${result.url}`);
	console.log(`[maestro-server] data directory: ${dataDir}`);
	console.log(`[maestro-server] sessions visible: ${sessionsStore.get<StoredSession[]>('sessions', []).length}`);
	console.log(
		'[maestro-server] Layer 0f: 10/10 WRITE callbacks active ' +
			'(L0b: writeToSession, executeCommand, interruptSession via ProcessManager; ' +
			'L0c-A: switchMode, closeTab, renameTab, starTab, reorderTab, toggleBookmark ' +
			'via sessions store + broadcast; ' +
			'L0c-C: selectSession, selectTab as headless no-ops; ' +
			'L0d: newTab via sessions store + broadcast, lazy process spawn on first command). ' +
			'L0f also wires Sentry init for error capture (no-op without MAESTRO_SENTRY_DSN).'
	);
	console.log(
		'[maestro-server] Layer 6.1: raw PTY multiplexer ready (subscribe/publish over WS)'
	);
}

main().catch((err) => {
	console.error('[maestro-server] failed to start', err);
	captureException(err, { context: 'main_startup' });
	process.exit(1);
});

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		console.log(`[maestro-server] received ${signal}, shutting down`);
		try {
			rawPtyMultiplexer.detachProducer();
		} catch (err) {
			console.error('[maestro-server] rawPtyMultiplexer.detachProducer() threw', err);
		}
		try {
			processManagerAdapter.shutdown();
		} catch (err) {
			console.error('[maestro-server] processManagerAdapter.shutdown() threw', err);
		}
		server.stop().finally(() => process.exit(0));
	});
}
