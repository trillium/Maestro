/**
 * CallbackRegistry - Manages callback functions for the WebServer
 *
 * Centralizes all callback storage and provides typed getter/setter methods.
 * This separates callback management from the core WebServer logic.
 */

import { logger } from '../../utils/logger';
import type {
	GetSessionsCallback,
	GetSessionDetailCallback,
	WriteToSessionCallback,
	ExecuteCommandCallback,
	InterruptSessionCallback,
	SwitchModeCallback,
	SelectSessionCallback,
	SelectTabCallback,
	NewTabCallback,
	CreateSessionCallback,
	CreateSessionRequest,
	CloseTabCallback,
	RenameTabCallback,
	StarTabCallback,
	ReorderTabCallback,
	ToggleBookmarkCallback,
	GetThemeCallback,
	GetBionifyReadingModeCallback,
	GetCustomCommandsCallback,
	GetHistoryCallback,
	ProcessSpawnCallback,
	ProcessSpawnRequest,
	ProcessKillCallback,
} from '../types';

const LOG_CONTEXT = 'CallbackRegistry';

/**
 * All callback types supported by the WebServer
 */
export interface WebServerCallbacks {
	getSessions: GetSessionsCallback | null;
	getSessionDetail: GetSessionDetailCallback | null;
	getTheme: GetThemeCallback | null;
	getBionifyReadingMode: GetBionifyReadingModeCallback | null;
	getCustomCommands: GetCustomCommandsCallback | null;
	writeToSession: WriteToSessionCallback | null;
	executeCommand: ExecuteCommandCallback | null;
	interruptSession: InterruptSessionCallback | null;
	switchMode: SwitchModeCallback | null;
	selectSession: SelectSessionCallback | null;
	selectTab: SelectTabCallback | null;
	newTab: NewTabCallback | null;
	createSession: CreateSessionCallback | null;
	closeTab: CloseTabCallback | null;
	renameTab: RenameTabCallback | null;
	starTab: StarTabCallback | null;
	reorderTab: ReorderTabCallback | null;
	toggleBookmark: ToggleBookmarkCallback | null;
	getHistory: GetHistoryCallback | null;
	/** WS process-lifecycle family — umbrella Decision 2026-06-08. */
	processSpawn: ProcessSpawnCallback | null;
	/** WS process-lifecycle family — umbrella Decision 2026-06-08. */
	processKill: ProcessKillCallback | null;
}

export class CallbackRegistry {
	private callbacks: WebServerCallbacks = {
		getSessions: null,
		getSessionDetail: null,
		getTheme: null,
		getBionifyReadingMode: null,
		getCustomCommands: null,
		writeToSession: null,
		executeCommand: null,
		interruptSession: null,
		switchMode: null,
		selectSession: null,
		selectTab: null,
		newTab: null,
		createSession: null,
		closeTab: null,
		renameTab: null,
		starTab: null,
		reorderTab: null,
		toggleBookmark: null,
		getHistory: null,
		processSpawn: null,
		processKill: null,
	};

	// ============ Getter Methods ============

	getSessions(): ReturnType<GetSessionsCallback> | [] {
		return this.callbacks.getSessions?.() ?? [];
	}

	getSessionDetail(sessionId: string, tabId?: string): ReturnType<GetSessionDetailCallback> | null {
		return this.callbacks.getSessionDetail?.(sessionId, tabId) ?? null;
	}

	getTheme(): ReturnType<GetThemeCallback> | null {
		return this.callbacks.getTheme?.() ?? null;
	}

	getBionifyReadingMode(): ReturnType<GetBionifyReadingModeCallback> {
		return this.callbacks.getBionifyReadingMode?.() ?? false;
	}

	getCustomCommands(): ReturnType<GetCustomCommandsCallback> | [] {
		return this.callbacks.getCustomCommands?.() ?? [];
	}

	writeToSession(sessionId: string, data: string): boolean {
		return this.callbacks.writeToSession?.(sessionId, data) ?? false;
	}

	async executeCommand(
		sessionId: string,
		command: string,
		inputMode?: 'ai' | 'terminal'
	): Promise<boolean> {
		if (!this.callbacks.executeCommand) return false;
		return this.callbacks.executeCommand(sessionId, command, inputMode);
	}

	async interruptSession(sessionId: string): Promise<boolean> {
		return this.callbacks.interruptSession?.(sessionId) ?? false;
	}

	async switchMode(sessionId: string, mode: 'ai' | 'terminal'): Promise<boolean> {
		if (!this.callbacks.switchMode) return false;
		return this.callbacks.switchMode(sessionId, mode);
	}

	async selectSession(sessionId: string, tabId?: string): Promise<boolean> {
		if (!this.callbacks.selectSession) return false;
		return this.callbacks.selectSession(sessionId, tabId);
	}

	async selectTab(sessionId: string, tabId: string): Promise<boolean> {
		if (!this.callbacks.selectTab) return false;
		return this.callbacks.selectTab(sessionId, tabId);
	}

	async newTab(sessionId: string): Promise<{ tabId: string } | null> {
		if (!this.callbacks.newTab) return null;
		return this.callbacks.newTab(sessionId);
	}

	async createSession(request: CreateSessionRequest): Promise<{ sessionId: string } | null> {
		if (!this.callbacks.createSession) return null;
		return this.callbacks.createSession(request);
	}

	async closeTab(sessionId: string, tabId: string): Promise<boolean> {
		if (!this.callbacks.closeTab) return false;
		return this.callbacks.closeTab(sessionId, tabId);
	}

	async renameTab(sessionId: string, tabId: string, newName: string): Promise<boolean> {
		if (!this.callbacks.renameTab) return false;
		return this.callbacks.renameTab(sessionId, tabId, newName);
	}

	async starTab(sessionId: string, tabId: string, starred: boolean): Promise<boolean> {
		if (!this.callbacks.starTab) return false;
		return this.callbacks.starTab(sessionId, tabId, starred);
	}

	async reorderTab(sessionId: string, fromIndex: number, toIndex: number): Promise<boolean> {
		if (!this.callbacks.reorderTab) return false;
		return this.callbacks.reorderTab(sessionId, fromIndex, toIndex);
	}

	async toggleBookmark(sessionId: string): Promise<boolean> {
		if (!this.callbacks.toggleBookmark) return false;
		return this.callbacks.toggleBookmark(sessionId);
	}

	getHistory(projectPath?: string, sessionId?: string): ReturnType<GetHistoryCallback> | [] {
		return this.callbacks.getHistory?.(projectPath, sessionId) ?? [];
	}

	/**
	 * WS process-lifecycle family — proxy through to the registered
	 * `processSpawn` callback. Returns `null` when no callback is registered
	 * (the Electron desktop server omits this surface).
	 */
	async processSpawn(
		request: ProcessSpawnRequest
	): Promise<{ pid: number; success: boolean; sshRemoteUsed?: string | null } | null> {
		if (!this.callbacks.processSpawn) return null;
		return this.callbacks.processSpawn(request);
	}

	/**
	 * WS process-lifecycle family — proxy through to the registered
	 * `processKill` callback. Returns `false` when no callback is registered.
	 */
	async processKill(sessionId: string): Promise<boolean> {
		if (!this.callbacks.processKill) return false;
		return this.callbacks.processKill(sessionId);
	}

	// ============ Setter Methods ============

	setGetSessionsCallback(callback: GetSessionsCallback): void {
		this.callbacks.getSessions = callback;
	}

	setGetSessionDetailCallback(callback: GetSessionDetailCallback): void {
		this.callbacks.getSessionDetail = callback;
	}

	setGetThemeCallback(callback: GetThemeCallback): void {
		this.callbacks.getTheme = callback;
	}

	setGetBionifyReadingModeCallback(callback: GetBionifyReadingModeCallback): void {
		this.callbacks.getBionifyReadingMode = callback;
	}

	setGetCustomCommandsCallback(callback: GetCustomCommandsCallback): void {
		this.callbacks.getCustomCommands = callback;
	}

	setWriteToSessionCallback(callback: WriteToSessionCallback): void {
		this.callbacks.writeToSession = callback;
	}

	setExecuteCommandCallback(callback: ExecuteCommandCallback): void {
		this.callbacks.executeCommand = callback;
	}

	setInterruptSessionCallback(callback: InterruptSessionCallback): void {
		this.callbacks.interruptSession = callback;
	}

	setSwitchModeCallback(callback: SwitchModeCallback): void {
		logger.info('[CallbackRegistry] setSwitchModeCallback called', LOG_CONTEXT);
		this.callbacks.switchMode = callback;
	}

	setSelectSessionCallback(callback: SelectSessionCallback): void {
		logger.info('[CallbackRegistry] setSelectSessionCallback called', LOG_CONTEXT);
		this.callbacks.selectSession = callback;
	}

	setSelectTabCallback(callback: SelectTabCallback): void {
		logger.info('[CallbackRegistry] setSelectTabCallback called', LOG_CONTEXT);
		this.callbacks.selectTab = callback;
	}

	setNewTabCallback(callback: NewTabCallback): void {
		logger.info('[CallbackRegistry] setNewTabCallback called', LOG_CONTEXT);
		this.callbacks.newTab = callback;
	}

	setCreateSessionCallback(callback: CreateSessionCallback): void {
		logger.info('[CallbackRegistry] setCreateSessionCallback called', LOG_CONTEXT);
		this.callbacks.createSession = callback;
	}

	setCloseTabCallback(callback: CloseTabCallback): void {
		logger.info('[CallbackRegistry] setCloseTabCallback called', LOG_CONTEXT);
		this.callbacks.closeTab = callback;
	}

	setRenameTabCallback(callback: RenameTabCallback): void {
		logger.info('[CallbackRegistry] setRenameTabCallback called', LOG_CONTEXT);
		this.callbacks.renameTab = callback;
	}

	setStarTabCallback(callback: StarTabCallback): void {
		this.callbacks.starTab = callback;
	}

	setReorderTabCallback(callback: ReorderTabCallback): void {
		this.callbacks.reorderTab = callback;
	}

	setToggleBookmarkCallback(callback: ToggleBookmarkCallback): void {
		this.callbacks.toggleBookmark = callback;
	}

	setGetHistoryCallback(callback: GetHistoryCallback): void {
		this.callbacks.getHistory = callback;
	}

	setProcessSpawnCallback(callback: ProcessSpawnCallback): void {
		logger.info('[CallbackRegistry] setProcessSpawnCallback called', LOG_CONTEXT);
		this.callbacks.processSpawn = callback;
	}

	setProcessKillCallback(callback: ProcessKillCallback): void {
		logger.info('[CallbackRegistry] setProcessKillCallback called', LOG_CONTEXT);
		this.callbacks.processKill = callback;
	}

	// ============ Check Methods ============

	hasCallback(name: keyof WebServerCallbacks): boolean {
		return this.callbacks[name] !== null;
	}
}
