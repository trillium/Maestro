/**
 * Tests for the /api/git/* REST route cluster.
 *
 * Closes the server half of `ISC-44.server.api_git_cluster` (sibling
 * `ISC-44.server.api_git_ssh_support` remains open). Mirrors the existing
 * `apiRoutes.test.ts` mocking pattern: a `createMockFastify()` records
 * registered routes, handlers are invoked directly with mock request/reply
 * objects.
 *
 * Coverage shape:
 *   - Route registration smoke test (all 18 routes land at the expected paths).
 *   - 503 when no GitProvider is registered.
 *   - 400 for invalid `cwd` / `worktreePath` / `parentPath` (path validation).
 *   - 501 when `?sshRemoteId=…` is present (SSH-remote git deferred to sibling).
 *   - Happy-path reply shape for the read routes that gate
 *     WizardResumeModal + DirectorySelectionScreen (`isRepo`, `status`).
 *   - Error path: provider throws → 500.
 *   - getRepoRoot / getDefaultBranch 404 on `notARepo` / `notFound` tagged errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	ApiRoutes,
	registerGitProvider,
	type GitProvider,
	type RateLimitConfig,
} from '../../../../main/web-server/routes/apiRoutes';

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

/**
 * Mock Fastify instance with route registration tracking.
 * Same shape as `apiRoutes.test.ts:createMockFastify()`.
 */
function createMockFastify() {
	const routes: Map<string, { handler: Function; config?: any }> = new Map();
	return {
		get: vi.fn((p: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`GET:${p}`, { handler: h, config });
		}),
		post: vi.fn((p: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`POST:${p}`, { handler: h, config });
		}),
		patch: vi.fn((p: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`PATCH:${p}`, { handler: h, config });
		}),
		put: vi.fn((p: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`PUT:${p}`, { handler: h, config });
		}),
		delete: vi.fn((p: string, options: any, handler?: Function) => {
			const h = handler || options;
			const config = handler ? options?.config : undefined;
			routes.set(`DELETE:${p}`, { handler: h, config });
		}),
		getRoute: (method: string, p: string) => routes.get(`${method}:${p}`),
		routes,
	};
}

function createMockReply() {
	const reply: any = {
		code: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
		type: vi.fn().mockReturnThis(),
		header: vi.fn().mockReturnThis(),
	};
	return reply;
}

/** Build a `GitProvider` with all methods stubbed. Individual tests override. */
function createMockGitProvider(): GitProvider {
	return {
		status: vi.fn(async (_cwd) => ({ stdout: '', stderr: '' })),
		diff: vi.fn(async (_cwd, _file) => ({ stdout: '', stderr: '' })),
		isRepo: vi.fn(async (_cwd) => true),
		numstat: vi.fn(async (_cwd) => ({ stdout: '', stderr: '' })),
		branch: vi.fn(async (_cwd) => ({ stdout: 'main', stderr: '' })),
		branches: vi.fn(async (_cwd) => ({ branches: ['main'] })),
		tags: vi.fn(async (_cwd) => ({ tags: [] })),
		remote: vi.fn(async (_cwd) => ({
			stdout: 'git@github.com:owner/repo.git',
			stderr: '',
		})),
		info: vi.fn(async (_cwd) => ({
			branch: 'main',
			remote: 'git@github.com:owner/repo.git',
			behind: 0,
			ahead: 0,
			uncommittedChanges: 0,
		})),
		log: vi.fn(async (_cwd, _opts) => ({ entries: [], error: null })),
		commitCount: vi.fn(async (_cwd) => ({ count: 0, error: null })),
		show: vi.fn(async (_cwd, _hash) => ({ stdout: '', stderr: '' })),
		showFile: vi.fn(async (_cwd, _ref, _filePath) => ({ content: '' })),
		worktreeInfo: vi.fn(async (_worktreePath) => ({
			exists: true,
			isWorktree: false,
		})),
		getRepoRoot: vi.fn(async (_cwd) => ({ root: '/repo' })),
		getDefaultBranch: vi.fn(async (_cwd) => ({ branch: 'main' })),
		listWorktrees: vi.fn(async (_cwd) => ({ worktrees: [] })),
		scanWorktreeDirectory: vi.fn(async (_parentPath) => ({ gitSubdirs: [] })),
	};
}

describe('ApiRoutes — /api/git/* cluster (W3-git)', () => {
	const securityToken = 'test-token-git';
	const rateLimitConfig: RateLimitConfig = {
		max: 100,
		maxPost: 30,
		timeWindow: 60000,
		enabled: true,
	};

	let apiRoutes: ApiRoutes;
	let mockFastify: ReturnType<typeof createMockFastify>;
	let provider: GitProvider;

	beforeEach(() => {
		apiRoutes = new ApiRoutes(securityToken, rateLimitConfig);
		mockFastify = createMockFastify();
		apiRoutes.registerRoutes(mockFastify as any);
		provider = createMockGitProvider();
		registerGitProvider(provider);
	});

	afterEach(() => {
		registerGitProvider(null);
	});

	describe('Route Registration', () => {
		it('registers all 18 /api/git/* read routes at the expected paths', () => {
			const expectedRoutes = [
				`GET:/${securityToken}/api/git/status`,
				`GET:/${securityToken}/api/git/diff`,
				`GET:/${securityToken}/api/git/is-repo`,
				`GET:/${securityToken}/api/git/numstat`,
				`GET:/${securityToken}/api/git/branch`,
				`GET:/${securityToken}/api/git/branches`,
				`GET:/${securityToken}/api/git/tags`,
				`GET:/${securityToken}/api/git/remote`,
				`GET:/${securityToken}/api/git/info`,
				`GET:/${securityToken}/api/git/log`,
				`GET:/${securityToken}/api/git/commit-count`,
				`GET:/${securityToken}/api/git/show`,
				`GET:/${securityToken}/api/git/show-file`,
				`GET:/${securityToken}/api/git/worktree-info`,
				`GET:/${securityToken}/api/git/repo-root`,
				`GET:/${securityToken}/api/git/default-branch`,
				`GET:/${securityToken}/api/git/worktrees`,
				`GET:/${securityToken}/api/git/scan-worktree-directory`,
			];
			for (const r of expectedRoutes) {
				expect(mockFastify.routes.has(r)).toBe(true);
			}
		});

		it('configures the standard read-rate limit on git routes', () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			expect(route?.config?.rateLimit?.max).toBe(rateLimitConfig.max);
			expect(route?.config?.rateLimit?.timeWindow).toBe(rateLimitConfig.timeWindow);
		});
	});

	describe('GET /api/git/is-repo — happy path', () => {
		it('returns {isRepo: true, timestamp} on success', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			const reply = createMockReply();
			const result = await route!.handler({ query: { cwd: '/abs/path' } }, reply);
			expect(result.isRepo).toBe(true);
			expect(result.timestamp).toBeDefined();
			expect(provider.isRepo).toHaveBeenCalledWith('/abs/path');
		});

		it('returns {isRepo: false, timestamp} when the directory is not a repo', async () => {
			(provider.isRepo as any).mockResolvedValue(false);
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			const reply = createMockReply();
			const result = await route!.handler({ query: { cwd: '/abs/not-repo' } }, reply);
			expect(result.isRepo).toBe(false);
		});
	});

	describe('GET /api/git/status — happy path', () => {
		it('forwards cwd and returns the provider stdout/stderr verbatim', async () => {
			(provider.status as any).mockResolvedValue({
				stdout: ' M src/foo.ts\n?? src/bar.ts\n',
				stderr: '',
			});
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/status`);
			const reply = createMockReply();
			const result = await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(result.stdout).toBe(' M src/foo.ts\n?? src/bar.ts\n');
			expect(result.stderr).toBe('');
			expect(result.timestamp).toBeDefined();
			expect(provider.status).toHaveBeenCalledWith('/abs/repo');
		});
	});

	describe('GET /api/git/diff — optional file query param', () => {
		it('omits the file argument when not provided', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/diff`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(provider.diff).toHaveBeenCalledWith('/abs/repo', undefined);
		});

		it('forwards the file argument when provided', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/diff`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', file: 'src/foo.ts' } }, reply);
			expect(provider.diff).toHaveBeenCalledWith('/abs/repo', 'src/foo.ts');
		});
	});

	describe('GET /api/git/log — query param parsing', () => {
		it('passes parsed integer limit + search to the provider', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/log`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', limit: '50', search: 'fix' } }, reply);
			expect(provider.log).toHaveBeenCalledWith('/abs/repo', {
				limit: 50,
				search: 'fix',
			});
		});

		it('rejects non-integer limit with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/log`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', limit: 'banana' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
			expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Bad Request' }));
		});

		it('rejects out-of-range limit with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/log`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', limit: '100000' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});
	});

	describe('Path validation — 400 on invalid cwd', () => {
		it.each([
			['empty string', ''],
			['relative path', 'src/foo'],
			['contains NUL byte', '/abs/\0/path'],
			['contains `..` segment', '/abs/../etc/passwd'],
			['contains encoded `..`', '/abs/%2e%2e/etc'],
		])('rejects cwd=%s with 400', async (_label, badCwd) => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: badCwd } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
			expect(provider.isRepo).not.toHaveBeenCalled();
		});

		it('rejects missing cwd with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			const reply = createMockReply();
			await route!.handler({ query: {} }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it('rejects missing worktreePath with 400 on /worktree-info', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/worktree-info`);
			const reply = createMockReply();
			await route!.handler({ query: {} }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it('rejects missing parentPath with 400 on /scan-worktree-directory', async () => {
			const route = mockFastify.getRoute(
				'GET',
				`/${securityToken}/api/git/scan-worktree-directory`
			);
			const reply = createMockReply();
			await route!.handler({ query: {} }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});
	});

	describe('Ref/hash/filePath validation', () => {
		it('rejects /show without hash with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/show`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it('rejects /show-file missing ref or filePath with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/show-file`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', ref: 'HEAD' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});

		it('rejects hash with NUL byte with 400', async () => {
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/show`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', hash: 'a\0b' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(400);
		});
	});

	describe('SSH-remote dispatch — 501 (deferred to sibling ISC)', () => {
		it.each([
			'/api/git/status',
			'/api/git/is-repo',
			'/api/git/branch',
			'/api/git/info',
			'/api/git/log',
		])('returns 501 on %s with ?sshRemoteId=…', async (routePath) => {
			const route = mockFastify.getRoute('GET', `/${securityToken}${routePath}`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo', sshRemoteId: 'remote-1' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(501);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ error: 'Not Implemented' })
			);
		});
	});

	describe('Service-unavailable — 503 when no provider registered', () => {
		it('returns 503 when GitProvider is null', async () => {
			registerGitProvider(null);
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/is-repo`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(503);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ error: 'Service Unavailable' })
			);
		});
	});

	describe('Provider error propagation — 500', () => {
		it('returns 500 when provider.status throws', async () => {
			(provider.status as any).mockRejectedValue(new Error('boom'));
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/status`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(500);
			expect(reply.send).toHaveBeenCalledWith(
				expect.objectContaining({ error: 'Internal Server Error' })
			);
		});

		it('returns 404 when getRepoRoot throws notARepo-tagged error', async () => {
			const err = new Error('Not a git repository');
			(err as any).notARepo = true;
			(provider.getRepoRoot as any).mockRejectedValue(err);
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/repo-root`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/not-repo' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(404);
		});

		it('returns 404 when getDefaultBranch throws notFound-tagged error', async () => {
			const err = new Error('Could not determine default branch');
			(err as any).notFound = true;
			(provider.getDefaultBranch as any).mockRejectedValue(err);
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/default-branch`);
			const reply = createMockReply();
			await route!.handler({ query: { cwd: '/abs/repo' } }, reply);
			expect(reply.code).toHaveBeenCalledWith(404);
		});
	});

	describe('Worktree-info reply shape', () => {
		it('returns {exists: false} for missing paths', async () => {
			(provider.worktreeInfo as any).mockResolvedValue({
				exists: false,
				isWorktree: false,
			});
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/worktree-info`);
			const reply = createMockReply();
			const result = await route!.handler({ query: { worktreePath: '/abs/missing' } }, reply);
			expect(result.exists).toBe(false);
			expect(result.isWorktree).toBe(false);
			expect(result.timestamp).toBeDefined();
		});

		it('returns the full worktree shape on success', async () => {
			(provider.worktreeInfo as any).mockResolvedValue({
				exists: true,
				isWorktree: true,
				currentBranch: 'feature-x',
				repoRoot: '/abs/main-repo',
			});
			const route = mockFastify.getRoute('GET', `/${securityToken}/api/git/worktree-info`);
			const reply = createMockReply();
			const result = await route!.handler({ query: { worktreePath: '/abs/worktree' } }, reply);
			expect(result).toMatchObject({
				exists: true,
				isWorktree: true,
				currentBranch: 'feature-x',
				repoRoot: '/abs/main-repo',
			});
		});
	});
});
