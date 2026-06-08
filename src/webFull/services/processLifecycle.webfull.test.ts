/**
 * Tests for the webFull WS process-lifecycle client wrapper.
 *
 * Covers the three load-bearing contracts pinned by the umbrella Decision
 * 2026-06-08 (`docs/ws-process-lifecycle-decision`):
 *   1. SSH passthrough — `sessionSshRemoteConfig` is forwarded verbatim
 *      in the `process_spawn` WS frame.
 *   2. `onData` raw chunking — listeners fire per chunk, synchronously,
 *      in arrival order, with no batching.
 *   3. Optional capability flags — `onThinkingChunk` / `onToolExecution`
 *      subscribers MAY never fire; the dispatcher MUST tolerate frames
 *      that don't arrive without breaking the round-trip.
 */

import { describe, it, expect, vi } from 'vitest';
import { createProcessLifecycleClient, type ProcessSpawnConfig } from './processLifecycle.webfull';

function makeSend() {
	const sent: Array<Record<string, unknown>> = [];
	const send = vi.fn((msg: Record<string, unknown>) => {
		sent.push(msg);
		return true;
	});
	return { send, sent };
}

describe('processLifecycle.webfull — spawn round-trip', () => {
	it('sends a process_spawn frame and resolves on process_spawn_result', async () => {
		const { send, sent } = makeSend();
		const client = createProcessLifecycleClient(send);

		const config: ProcessSpawnConfig = {
			sessionId: 'sess-1',
			toolType: 'claude-code',
			cwd: '/tmp/proj',
			command: 'claude',
			args: ['--print'],
		};
		const promise = client.spawn(config);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			type: 'process_spawn',
			sessionId: 'sess-1',
			toolType: 'claude-code',
			command: 'claude',
			args: ['--print'],
		});

		client.handleFrame({
			type: 'process_spawn_result',
			sessionId: 'sess-1',
			success: true,
			pid: 4242,
			sshRemoteUsed: null,
		});

		await expect(promise).resolves.toEqual({
			pid: 4242,
			success: true,
			sshRemoteUsed: null,
		});
	});

	it('forwards sessionSshRemoteConfig verbatim (contract vector 1)', async () => {
		const { send, sent } = makeSend();
		const client = createProcessLifecycleClient(send);

		const config: ProcessSpawnConfig = {
			sessionId: 'sess-ssh',
			toolType: 'opencode',
			cwd: '/x',
			command: 'opencode',
			args: ['-p', 'hi'],
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: 'remote-1',
				workingDirOverride: '/remote/dir',
			},
			sessionCustomEnvVars: { FOO: 'bar' },
		};
		const promise = client.spawn(config);

		expect(sent[0]).toMatchObject({
			type: 'process_spawn',
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: 'remote-1',
				workingDirOverride: '/remote/dir',
			},
			sessionCustomEnvVars: { FOO: 'bar' },
		});

		client.handleFrame({
			type: 'process_spawn_result',
			sessionId: 'sess-ssh',
			success: true,
			pid: 1,
			sshRemoteUsed: 'remote-1',
		});

		const result = await promise;
		expect(result.sshRemoteUsed).toBe('remote-1');
	});

	it('rejects when the WS send returns false', async () => {
		const send = vi.fn(() => false);
		const client = createProcessLifecycleClient(send);
		await expect(
			client.spawn({
				sessionId: 's',
				toolType: 'terminal',
				cwd: '/',
				command: 'sh',
				args: [],
			})
		).rejects.toThrow(/WS send failed/);
	});

	it('rejects the prior pending spawn when a second spawn for the same sessionId is issued', async () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const first = client.spawn({
			sessionId: 's-dupe',
			toolType: 'claude-code',
			cwd: '/',
			command: 'claude',
			args: [],
		});
		// Don't await first — issue a second one.
		const second = client.spawn({
			sessionId: 's-dupe',
			toolType: 'claude-code',
			cwd: '/',
			command: 'claude',
			args: [],
		});
		await expect(first).rejects.toThrow(/Superseded/);
		client.handleFrame({
			type: 'process_spawn_result',
			sessionId: 's-dupe',
			success: true,
			pid: 99,
		});
		await expect(second).resolves.toMatchObject({ pid: 99, success: true });
	});
});

describe('processLifecycle.webfull — kill round-trip', () => {
	it('sends process_kill and resolves on process_kill_result', async () => {
		const { send, sent } = makeSend();
		const client = createProcessLifecycleClient(send);

		const promise = client.kill('sess-1');

		expect(sent).toEqual([{ type: 'process_kill', sessionId: 'sess-1' }]);

		client.handleFrame({
			type: 'process_kill_result',
			sessionId: 'sess-1',
			success: true,
		});

		await expect(promise).resolves.toBe(true);
	});

	it('resolves false when server reports failure', async () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const promise = client.kill('sess-2');
		client.handleFrame({
			type: 'process_kill_result',
			sessionId: 'sess-2',
			success: false,
		});
		await expect(promise).resolves.toBe(false);
	});
});

describe('processLifecycle.webfull — onData (contract vector 2: raw chunking)', () => {
	it('invokes listeners per chunk synchronously, in arrival order, no batching', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const chunks: Array<{ chunk: string; source: string }> = [];
		const unsubscribe = client.onData('sess-1', (event) => {
			chunks.push({ chunk: event.chunk, source: event.source });
		});

		client.handleFrame({
			type: 'process_data',
			sessionId: 'sess-1',
			chunk: 'hel',
			source: 'stdout',
		});
		client.handleFrame({
			type: 'process_data',
			sessionId: 'sess-1',
			chunk: 'lo',
			source: 'stdout',
		});
		client.handleFrame({
			type: 'process_data',
			sessionId: 'sess-1',
			chunk: '\n',
			source: 'stdout',
		});
		client.handleFrame({
			type: 'process_data',
			sessionId: 'sess-1',
			chunk: 'oops',
			source: 'stderr',
		});

		expect(chunks).toEqual([
			{ chunk: 'hel', source: 'stdout' },
			{ chunk: 'lo', source: 'stdout' },
			{ chunk: '\n', source: 'stdout' },
			{ chunk: 'oops', source: 'stderr' },
		]);

		unsubscribe();
		client.handleFrame({
			type: 'process_data',
			sessionId: 'sess-1',
			chunk: 'after-unsub',
			source: 'stdout',
		});
		expect(chunks).toHaveLength(4);
	});

	it('filters per-sessionId — other sessions are not delivered to this listener', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const a: string[] = [];
		const b: string[] = [];
		client.onData('A', (e) => a.push(e.chunk));
		client.onData('B', (e) => b.push(e.chunk));
		client.handleFrame({ type: 'process_data', sessionId: 'A', chunk: 'a1', source: 'stdout' });
		client.handleFrame({ type: 'process_data', sessionId: 'B', chunk: 'b1', source: 'stdout' });
		client.handleFrame({ type: 'process_data', sessionId: 'A', chunk: 'a2', source: 'stdout' });
		expect(a).toEqual(['a1', 'a2']);
		expect(b).toEqual(['b1']);
	});
});

describe('processLifecycle.webfull — onExit', () => {
	it('dispatches process_exit with code + signal', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const events: Array<{ code: number; signal: string | null }> = [];
		client.onExit('sess-1', (e) => events.push({ code: e.code, signal: e.signal }));

		client.handleFrame({ type: 'process_exit', sessionId: 'sess-1', code: 0, signal: null });
		client.handleFrame({
			type: 'process_exit',
			sessionId: 'sess-1',
			code: 137,
			signal: 'SIGKILL',
		});
		expect(events).toEqual([
			{ code: 0, signal: null },
			{ code: 137, signal: 'SIGKILL' },
		]);
	});
});

describe('processLifecycle.webfull — optional capabilities (contract vector 3)', () => {
	it('dispatches process_thinking_chunk when frames arrive', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const events: string[] = [];
		client.onThinkingChunk('sess-1', (_, content) => events.push(content));
		client.handleFrame({
			type: 'process_thinking_chunk',
			sessionId: 'sess-1',
			content: 'I am thinking',
		});
		expect(events).toEqual(['I am thinking']);
	});

	it('tolerates the absence of thinking/tool frames — listeners simply never fire', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const thinking = vi.fn();
		const tool = vi.fn();
		client.onThinkingChunk('sess-1', thinking);
		client.onToolExecution('sess-1', tool);
		// Only data + exit arrive — capability frames omitted (e.g. terminal).
		client.handleFrame({ type: 'process_data', sessionId: 'sess-1', chunk: 'x', source: 'stdout' });
		client.handleFrame({ type: 'process_exit', sessionId: 'sess-1', code: 0, signal: null });
		expect(thinking).not.toHaveBeenCalled();
		expect(tool).not.toHaveBeenCalled();
	});

	it('dispatches process_tool_execution with toolEvent payload', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const events: Array<{ toolName: string; timestamp: number }> = [];
		client.onToolExecution('sess-1', (_, toolEvent) =>
			events.push({ toolName: toolEvent.toolName, timestamp: toolEvent.timestamp })
		);
		client.handleFrame({
			type: 'process_tool_execution',
			sessionId: 'sess-1',
			toolEvent: { toolName: 'edit', state: { path: '/x' }, timestamp: 123 },
		});
		expect(events).toEqual([{ toolName: 'edit', timestamp: 123 }]);
	});
});

describe('processLifecycle.webfull — handleFrame return value', () => {
	it('returns true for known process-lifecycle frame types', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		expect(
			client.handleFrame({
				type: 'process_data',
				sessionId: 's',
				chunk: 'x',
				source: 'stdout',
			})
		).toBe(true);
		expect(client.handleFrame({ type: 'process_exit', sessionId: 's', code: 0 })).toBe(true);
		expect(
			client.handleFrame({ type: 'process_spawn_result', sessionId: 's', success: true })
		).toBe(true);
		expect(client.handleFrame({ type: 'process_kill_result', sessionId: 's', success: true })).toBe(
			true
		);
	});

	it('returns false for unknown frame types so the caller can chain', () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		expect(client.handleFrame({ type: 'something_else' })).toBe(false);
		expect(client.handleFrame({ type: 'session_output', sessionId: 's' })).toBe(false);
	});
});

describe('processLifecycle.webfull — dispose', () => {
	it('clears subscribers and rejects pending round-trips', async () => {
		const { send } = makeSend();
		const client = createProcessLifecycleClient(send);
		const spawnPromise = client.spawn({
			sessionId: 's-dispose',
			toolType: 'claude-code',
			cwd: '/',
			command: 'claude',
			args: [],
		});
		const killPromise = client.kill('s-dispose');
		const dataListener = vi.fn();
		client.onData('s-dispose', dataListener);

		client.dispose();
		await expect(spawnPromise).rejects.toThrow(/disposed/);
		await expect(killPromise).rejects.toThrow(/disposed/);
		client.handleFrame({
			type: 'process_data',
			sessionId: 's-dispose',
			chunk: 'after',
			source: 'stdout',
		});
		expect(dataListener).not.toHaveBeenCalled();
	});
});
