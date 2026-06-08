/**
 * Tests for ApiRoutes
 *
 * API Routes handle REST API requests from web clients.
 * Routes are protected by a security token prefix.
 *
 * Endpoints tested:
 * - GET /api/sessions - List all sessions with live info
 * - GET /api/session/:id - Get single session detail
 * - POST /api/session/:id/send - Send command to session
 * - GET /api/theme - Get current theme
 * - POST /api/session/:id/interrupt - Interrupt session
 * - GET /api/history - Get history entries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	ApiRoutes,
	type ApiRouteCallbacks,
	type RateLimitConfig,
	registerProcessesProvider,
	type ProcessesProvider,
	registerAutorunProvider,
	type AutorunProvider,
} from '../../../../main/web-server/routes/apiRoutes';

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

/**
 * Create mock callbacks with all methods as vi.fn()
 */
function createMockCallbacks(): ApiRouteCallbacks {
	return {
		getSessions: vi.fn().mockReturnValue([
			{
				id: 'session-1',
				name: 'Session 1',
				toolType: 'claude-code',
				state: 'idle',
				inputMode: 'ai',
				cwd: '/test/project',
				groupId: null,
			},
			{
				id: 'session-2',
				name: 'Session 2',
				toolType: 'codex',
				state: 'busy',
				inputMode: 'terminal',
				cwd: '/test/project2',
				groupId: 'group-1',
			},
		]),
		getSessionDetail: vi.fn().mockReturnValue({
			id: 'session-1',
			name: 'Session 1',
			toolType: 'claude-code',
			state: 'idle',
			inputMode: 'ai',
			cwd: '/test/project',
			aiTabs: [{ id: 'tab-1', name: 'Tab 1', logs: [] }],
			activeAITabId: 'tab-1',
		}),
		getTheme: vi.fn().mockReturnValue({
			name: 'dark',
			background: '#1a1a1a',
			foreground: '#ffffff',
		}),
		writeToSession: vi.fn().mockReturnValue(true),
		interruptSession: vi.fn().mockResolvedValue(true),
		getHistory: vi
			.fn()
			.mockReturnValue([{ id: '1', command: 'test command', timestamp: Date.now() }]),
		getLiveSessionInfo: vi.fn().mockReturnValue({
			sessionId: 'session-1',
			agentSessionId: 'claude-agent-123',
			enabledAt: Date.now(),
		}),
		isSessionLive: vi.fn().mockReturnValue(true),
	};
}

/**
 * Mock Fastify instance with route registration tracking
 */
function createMockFastify() {
	const routes: Map<string, { handler: Function; config?: any }> = new Map();

	return {
		get: vi.fn((path: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`GET:${path}`, { handler: h, config });
		}),
		post: vi.fn((path: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`POST:${path}`, { handler: h, config });
		}),
		patch: vi.fn((path: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`PATCH:${path}`, { handler: h, config });
		}),
		put: vi.fn((path: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`PUT:${path}`, { handler: h, config });
		}),
		delete: vi.fn((path: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`DELETE:${path}`, { handler: h, config });
		}),
		getRoute: (method: string, path: string) => routes.get(`${method}:${path}`),
		routes,
	};
}

/**
 * Mock reply object
 */
function createMockReply() {
	const reply: any = {
		code: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
		type: vi.fn().mockReturnThis(),
	};
	return reply;
}

describe('ApiRoutes', () => {
	const securityToken = 'test-token-123';
	const rateLimitConfig: RateLimitConfig = {
		max: 100,
		maxPost: 30,
		timeWindow: 60000, // 1 minute in milliseconds
		enabled: true,
	};

	let apiRoutes: ApiRoutes;
	let callbacks: ApiRouteCallbacks;
	let mockFastify: ReturnType<typeof createMockFastify>;

	beforeEach(() => {
		apiRoutes = new ApiRoutes(securityToken, rateLimitConfig);
		callbacks = createMockCallbacks();
		apiRoutes.setCallbacks(callbacks);
		mockFastify = createMockFastify();
		apiRoutes.registerRoutes(mockFastify as any);
	});

	describe('Route Registration', () => {
		it('should register at least the core API routes', () => {
			// Smoke-only floor check: at least the original GET set + the original POST
			// set landed. Specific route names are asserted in the next test, which is
			// the real spec. Floor numbers below are deliberately lower than current
			// reality so adding a route never forces a test bump — the rename / removal
			// of a core route is what would (correctly) break this.
			expect(mockFastify.get.mock.calls.length).toBeGreaterThanOrEqual(4);
			expect(mockFastify.post.mock.calls.length).toBeGreaterThanOrEqual(2);
		});

		it('should register routes with correct token prefix', () => {
			expect(mockFastify.routes.has(`GET:/${securityToken}/api/sessions`)).toBe(true);
			expect(mockFastify.routes.has(`GET:/${securityToken}/api/session/:id`)).toBe(true);
			expect(mockFastify.routes.has(`POST:/${securityToken}/api/session/:id/send`)).toBe(true);
			expect(mockFastify.routes.has(`GET:/${securityToken}/api/theme`)).toBe(true);
			expect(mockFastify.routes.has(`POST:/${securityToken}/api/session/:id/interrupt`)).toBe(true);
			expect(mockFastify.routes.has(`GET:/${securityToken}/api/history`)).toBe(true);
		});

		it('should configure rate limiting for GET routes', () => {
			const sessionsRoute = mockFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			expect(sessionsRoute?.config?.rateLimit?.max).toBe(rateLimitConfig.max);
			expect(sessionsRoute?.config?.rateLimit?.timeWindow).toBe(rateLimitConfig.timeWindow);
		});

		it('should configure stricter rate limiting for POST routes', () => {
			const sendRoute = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			expect(sendRoute?.config?.rateLimit?.max).toBe(rateLimitConfig.maxPost);
		});
	});

	describe('GET /api/sessions', () => {
		it('should return all sessions with live info', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			const result = await route!.handler();

			expect(result.sessions).toHaveLength(2);
			expect(result.count).toBe(2);
			expect(result.timestamp).toBeDefined();
			expect(callbacks.getSessions).toHaveBeenCalled();
		});

		it('should enrich sessions with live info', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			const result = await route!.handler();

			expect(result.sessions[0].agentSessionId).toBe('claude-agent-123');
			expect(result.sessions[0].isLive).toBe(true);
			expect(result.sessions[0].liveEnabledAt).toBeDefined();
		});

		it('should preserve existing session agent IDs when live info is incomplete', async () => {
			(callbacks.getSessions as any).mockReturnValue([
				{
					id: 'session-fallback',
					name: 'Session Fallback',
					toolType: 'claude-code',
					state: 'idle',
					inputMode: 'ai',
					cwd: '/test/project',
					groupId: null,
					agentSessionId: 'existing-agent-session',
				},
			]);
			(callbacks.getLiveSessionInfo as any).mockReturnValue({
				sessionId: 'session-fallback',
				enabledAt: 123,
			});
			(callbacks.isSessionLive as any).mockReturnValue(false);

			const route = mockFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			const result = await route!.handler();

			expect(result.sessions[0]).toEqual(
				expect.objectContaining({
					agentSessionId: 'existing-agent-session',
					liveEnabledAt: 123,
					isLive: false,
				})
			);
		});

		it('should return empty array when no callbacks configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			const result = await route!.handler();

			expect(result.sessions).toEqual([]);
			expect(result.count).toBe(0);
		});
	});

	describe('GET /api/session/:id', () => {
		it('should return session detail', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/session/:id`);
			const reply = createMockReply();
			const result = await route!.handler({ params: { id: 'session-1' }, query: {} }, reply);

			expect(result.session.id).toBe('session-1');
			expect(result.session.agentSessionId).toBe('claude-agent-123');
			expect(result.session.isLive).toBe(true);
			expect(callbacks.getSessionDetail).toHaveBeenCalledWith('session-1', undefined);
		});

		it('should preserve existing detail agent ID when live info is incomplete', async () => {
			(callbacks.getSessionDetail as any).mockReturnValue({
				id: 'session-fallback',
				name: 'Session Fallback',
				toolType: 'claude-code',
				state: 'idle',
				inputMode: 'ai',
				cwd: '/test/project',
				agentSessionId: 'existing-detail-agent',
			});
			(callbacks.getLiveSessionInfo as any).mockReturnValue({
				sessionId: 'session-fallback',
				enabledAt: 456,
			});
			(callbacks.isSessionLive as any).mockReturnValue(false);

			const route = mockFastify.getRoute('GET', `/${securityToken}/api/session/:id`);
			const reply = createMockReply();
			const result = await route!.handler({ params: { id: 'session-fallback' }, query: {} }, reply);

			expect(result.session).toEqual(
				expect.objectContaining({
					agentSessionId: 'existing-detail-agent',
					liveEnabledAt: 456,
					isLive: false,
				})
			);
		});

		it('should pass tabId query param to callback', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/session/:id`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, query: { tabId: 'tab-5' } }, reply);

			expect(callbacks.getSessionDetail).toHaveBeenCalledWith('session-1', 'tab-5');
		});

		it('should return 404 for non-existent session', async () => {
			(callbacks.getSessionDetail as any).mockReturnValue(null);

			const route = mockFastify.getRoute('GET', `/${securityToken}/api/session/:id`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'nonexistent' }, query: {} }, reply);

			expect(reply.code).toHaveBeenCalledWith(404);
			expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not Found' }));
		});

		it('should return 503 when getSessionDetail callback not configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('GET', `/${securityToken}/api/session/:id`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, query: {} }, reply);

			expect(reply.code).toHaveBeenCalledWith(503);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ error: 'Service Unavailable' })
			);
		});
	});

	describe('POST /api/session/:id/send', () => {
		it('should send command to session', async () => {
			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			const reply = createMockReply();
			const result = await route!.handler(
				{ params: { id: 'session-1' }, body: { command: 'ls -la' } },
				reply
			);

			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('session-1');
			expect(callbacks.writeToSession).toHaveBeenCalledWith('session-1', 'ls -la\n');
		});

		it('should return 400 for missing command', async () => {
			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, body: {} }, reply);

			expect(reply.code).toHaveBeenCalledWith(400);
			expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Bad Request' }));
		});

		it('should return 400 for non-string command', async () => {
			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, body: { command: 123 } }, reply);

			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it('should return 500 when writeToSession fails', async () => {
			(callbacks.writeToSession as any).mockReturnValue(false);

			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, body: { command: 'test' } }, reply);

			expect(reply.code).toHaveBeenCalledWith(500);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ error: 'Internal Server Error' })
			);
		});

		it('should return 503 when writeToSession callback not configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('POST', `/${securityToken}/api/session/:id/send`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' }, body: { command: 'test' } }, reply);

			expect(reply.code).toHaveBeenCalledWith(503);
		});
	});

	describe('GET /api/theme', () => {
		it('should return current theme', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/theme`);
			const reply = createMockReply();
			const result = await route!.handler({}, reply);

			expect(result.theme.name).toBe('dark');
			expect(result.timestamp).toBeDefined();
			expect(callbacks.getTheme).toHaveBeenCalled();
		});

		it('should return 404 when no theme configured', async () => {
			(callbacks.getTheme as any).mockReturnValue(null);

			const route = mockFastify.getRoute('GET', `/${securityToken}/api/theme`);
			const reply = createMockReply();
			await route!.handler({}, reply);

			expect(reply.code).toHaveBeenCalledWith(404);
			expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not Found' }));
		});

		it('should return 503 when getTheme callback not configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('GET', `/${securityToken}/api/theme`);
			const reply = createMockReply();
			await route!.handler({}, reply);

			expect(reply.code).toHaveBeenCalledWith(503);
		});
	});

	describe('POST /api/session/:id/interrupt', () => {
		it('should interrupt session successfully', async () => {
			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/interrupt`);
			const reply = createMockReply();
			const result = await route!.handler({ params: { id: 'session-1' } }, reply);

			expect(result.success).toBe(true);
			expect(result.sessionId).toBe('session-1');
			expect(callbacks.interruptSession).toHaveBeenCalledWith('session-1');
		});

		it('should return 500 when interrupt fails', async () => {
			(callbacks.interruptSession as any).mockResolvedValue(false);

			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/interrupt`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' } }, reply);

			expect(reply.code).toHaveBeenCalledWith(500);
		});

		it('should return 500 when interrupt throws error', async () => {
			(callbacks.interruptSession as any).mockRejectedValue(new Error('Session not found'));

			const route = mockFastify.getRoute('POST', `/${securityToken}/api/session/:id/interrupt`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' } }, reply);

			expect(reply.code).toHaveBeenCalledWith(500);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Session not found'),
				})
			);
		});

		it('should return 503 when interruptSession callback not configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('POST', `/${securityToken}/api/session/:id/interrupt`);
			const reply = createMockReply();
			await route!.handler({ params: { id: 'session-1' } }, reply);

			expect(reply.code).toHaveBeenCalledWith(503);
		});
	});

	describe('GET /api/history', () => {
		it('should return history entries', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/history`);
			const reply = createMockReply();
			const result = await route!.handler({ query: {} }, reply);

			expect(result.entries).toHaveLength(1);
			expect(result.count).toBe(1);
			expect(callbacks.getHistory).toHaveBeenCalledWith(undefined, undefined);
		});

		it('should pass projectPath and sessionId to callback', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/history`);
			const reply = createMockReply();
			await route!.handler({ query: { projectPath: '/test', sessionId: 'session-1' } }, reply);

			expect(callbacks.getHistory).toHaveBeenCalledWith('/test', 'session-1');
		});

		it('should return 500 when getHistory throws error', async () => {
			(callbacks.getHistory as any).mockImplementation(() => {
				throw new Error('Database error');
			});

			const route = mockFastify.getRoute('GET', `/${securityToken}/api/history`);
			const reply = createMockReply();
			await route!.handler({ query: {} }, reply);

			expect(reply.code).toHaveBeenCalledWith(500);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Database error'),
				})
			);
		});

		it('should return 503 when getHistory callback not configured', async () => {
			const emptyRoutes = new ApiRoutes(securityToken, rateLimitConfig);
			const emptyFastify = createMockFastify();
			emptyRoutes.registerRoutes(emptyFastify as any);

			const route = emptyFastify.getRoute('GET', `/${securityToken}/api/history`);
			const reply = createMockReply();
			await route!.handler({ query: {} }, reply);

			expect(reply.code).toHaveBeenCalledWith(503);
		});
	});

	describe('Rate Limit Configuration', () => {
		it('should update rate limit config', () => {
			const newConfig: RateLimitConfig = {
				max: 200,
				maxPost: 50,
				timeWindow: 120000, // 2 minutes in milliseconds
				enabled: true,
			};
			apiRoutes.updateRateLimitConfig(newConfig);

			// Re-register routes to see new config
			const newFastify = createMockFastify();
			apiRoutes.registerRoutes(newFastify as any);

			const sessionsRoute = newFastify.getRoute('GET', `/${securityToken}/api/sessions`);
			expect(sessionsRoute?.config?.rateLimit?.max).toBe(200);
		});
	});

	// ============ Processes cluster (ISC-44.server.api_processes_cluster) ============
	//
	// Provider-registry routes (mirrors the W3-fs / W3-agents test pattern: no
	// callbacks, just register the provider on the module-level registry before
	// invoking the route handler, then unregister in afterEach so other tests
	// see a clean slate).
	describe('Processes routes', () => {
		afterEach(() => {
			// Always clear so a later test doesn't inherit a stale provider.
			registerProcessesProvider(null);
		});

		const sampleProcess = {
			sessionId: 'session-1',
			toolType: 'claude-code',
			pid: 12345,
			cwd: '/tmp/project',
			isTerminal: false,
			isBatchMode: false,
			startTime: 1700000000000,
			command: 'claude',
			args: ['--resume', 'agent-id'],
		};

		describe('Route registration', () => {
			it('should register GET /api/processes', () => {
				expect(mockFastify.routes.has(`GET:/${securityToken}/api/processes`)).toBe(true);
			});

			it('should register GET /api/processes/:sessionId', () => {
				expect(mockFastify.routes.has(`GET:/${securityToken}/api/processes/:sessionId`)).toBe(true);
			});

			it('should configure read-budget rate limiting on /api/processes', () => {
				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				expect(route?.config?.rateLimit?.max).toBe(rateLimitConfig.max);
				expect(route?.config?.rateLimit?.timeWindow).toBe(rateLimitConfig.timeWindow);
			});
		});

		describe('GET /api/processes', () => {
			it('should return the active process list', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn().mockReturnValue([sampleProcess]),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				const reply = createMockReply();
				const result = await route!.handler({ query: {} }, reply);

				expect(result.processes).toHaveLength(1);
				expect(result.processes[0].sessionId).toBe('session-1');
				expect(result.count).toBe(1);
				expect(result.timestamp).toBeDefined();
				expect(provider.list).toHaveBeenCalled();
			});

			it('should return an empty list when no processes are active', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn().mockReturnValue([]),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				const reply = createMockReply();
				const result = await route!.handler({ query: {} }, reply);

				expect(result.processes).toEqual([]);
				expect(result.count).toBe(0);
			});

			it('should return 503 when no provider is registered', async () => {
				registerProcessesProvider(null);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				const reply = createMockReply();
				await route!.handler({ query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(503);
				expect(reply.send).toHaveBeenCalledWith(
					expect.objectContaining({ error: 'Service Unavailable' })
				);
			});

			it('should return 501 when sshRemoteId query param is supplied', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn().mockReturnValue([sampleProcess]),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				const reply = createMockReply();
				await route!.handler({ query: { sshRemoteId: 'remote-1' } }, reply);

				expect(reply.code).toHaveBeenCalledWith(501);
				expect(provider.list).not.toHaveBeenCalled();
			});

			it('should return 500 when provider.list throws', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn().mockImplementation(() => {
						throw new Error('boom');
					}),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes`);
				const reply = createMockReply();
				await route!.handler({ query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(500);
				expect(reply.send).toHaveBeenCalledWith(
					expect.objectContaining({
						message: expect.stringContaining('boom'),
					})
				);
			});
		});

		describe('GET /api/processes/:sessionId', () => {
			it('should return a single process', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn().mockReturnValue(sampleProcess),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				const result = await route!.handler(
					{ params: { sessionId: 'session-1' }, query: {} },
					reply
				);

				expect(result.process.sessionId).toBe('session-1');
				expect(result.timestamp).toBeDefined();
				expect(provider.get).toHaveBeenCalledWith('session-1');
			});

			it('should return 404 when sessionId is unknown', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn().mockReturnValue(null),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler({ params: { sessionId: 'nonexistent' }, query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(404);
				expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not Found' }));
			});

			it('should return 400 for an invalid sessionId (path traversal)', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler({ params: { sessionId: '../etc/passwd' }, query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(400);
				expect(provider.get).not.toHaveBeenCalled();
			});

			it('should return 400 for an empty sessionId', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn(),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler({ params: { sessionId: '' }, query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(400);
			});

			it('should return 503 when no provider is registered', async () => {
				registerProcessesProvider(null);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler({ params: { sessionId: 'session-1' }, query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(503);
			});

			it('should return 501 when sshRemoteId query param is supplied', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn().mockReturnValue(sampleProcess),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler(
					{ params: { sessionId: 'session-1' }, query: { sshRemoteId: 'remote-1' } },
					reply
				);

				expect(reply.code).toHaveBeenCalledWith(501);
				expect(provider.get).not.toHaveBeenCalled();
			});

			it('should return 500 when provider.get throws', async () => {
				const provider: ProcessesProvider = {
					list: vi.fn(),
					get: vi.fn().mockImplementation(() => {
						throw new Error('lookup failure');
					}),
				};
				registerProcessesProvider(provider);

				const route = mockFastify.getRoute('GET', `/${securityToken}/api/processes/:sessionId`);
				const reply = createMockReply();
				await route!.handler({ params: { sessionId: 'session-1' }, query: {} }, reply);

				expect(reply.code).toHaveBeenCalledWith(500);
				expect(reply.send).toHaveBeenCalledWith(
					expect.objectContaining({
						message: expect.stringContaining('lookup failure'),
					})
				);
			});
		});
	});

	// ============ Autorun routes (delete-folder) ============
	//
	// Server-side companion to the renderer-side `autorun:deleteFolder` IPC
	// (`src/main/ipc/handlers/autorun.ts:754-797`). Backs the Wizard "start
	// fresh" / ExistingDocsModal flow. We test the route handler in isolation
	// by registering a mocked AutorunProvider — the provider's deleteFolder
	// success path returns `{ removed: true }`, and the basename-mismatch
	// failure path is enforced at the route layer (400 before the provider is
	// invoked).
	describe('Autorun routes', () => {
		afterEach(() => {
			// Always clear so a later test doesn't inherit a stale provider.
			registerAutorunProvider(null);
		});

		const makeProvider = (overrides: Partial<AutorunProvider> = {}): AutorunProvider => ({
			listImages: vi.fn().mockResolvedValue({ images: [] }),
			saveImage: vi.fn().mockResolvedValue({ filename: '', relativePath: '' }),
			deleteImage: vi.fn().mockResolvedValue({ removed: true }),
			deleteFolder: vi.fn().mockResolvedValue({ removed: true }),
			...overrides,
		});

		describe('DELETE /api/autorun/delete-folder', () => {
			it('should register the route with the security token prefix', () => {
				expect(mockFastify.routes.has(`DELETE:/${securityToken}/api/autorun/delete-folder`)).toBe(
					true
				);
			});

			it('should delete the folder and return { removed: true } on success', async () => {
				const deleteFolder = vi.fn().mockResolvedValue({ removed: true });
				const provider = makeProvider({ deleteFolder });
				registerAutorunProvider(provider);

				const route = mockFastify.getRoute('DELETE', `/${securityToken}/api/autorun/delete-folder`);
				const reply = createMockReply();
				const result = await route!.handler(
					{
						body: { folder: '/tmp/some-project/Auto Run Docs' },
						query: {},
					},
					reply
				);

				expect(deleteFolder).toHaveBeenCalledWith('/tmp/some-project/Auto Run Docs');
				expect(result.removed).toBe(true);
				expect(result.timestamp).toBeDefined();
				// No error reply was sent — 200 path returns the result directly.
				expect(reply.code).not.toHaveBeenCalled();
			});

			it('should return 400 when the folder basename is not `Auto Run Docs`', async () => {
				const deleteFolder = vi.fn();
				const provider = makeProvider({ deleteFolder });
				registerAutorunProvider(provider);

				const route = mockFastify.getRoute('DELETE', `/${securityToken}/api/autorun/delete-folder`);
				const reply = createMockReply();
				await route!.handler(
					{
						body: { folder: '/tmp/some-project/Other Folder' },
						query: {},
					},
					reply
				);

				expect(reply.code).toHaveBeenCalledWith(400);
				expect(reply.send).toHaveBeenCalledWith(
					expect.objectContaining({
						error: 'Bad Request',
						message: expect.stringContaining("basename must be 'Auto Run Docs'"),
					})
				);
				// Provider must NOT be invoked when the safety check fails.
				expect(deleteFolder).not.toHaveBeenCalled();
			});
		});
	});
});
