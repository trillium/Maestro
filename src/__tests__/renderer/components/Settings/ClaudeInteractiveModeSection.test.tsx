/**
 * Tests for ClaudeInteractiveModeSection (MAESTRO-P-03 task 5).
 *
 * Covers:
 *   - Three-mode toggle group renders + clicks fire `onHeadlessModeChange`
 *   - Help text reflects the active mode
 *   - Auto-fallback toggle reflects + mutates the prop
 *   - `data-setting-id` attributes match the canonical SETTINGS_METADATA keys
 *   - Usage snapshot list: empty state, per-account row rendering, refresh wiring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { ClaudeInteractiveModeSection } from '../../../../renderer/components/Settings/ClaudeInteractiveModeSection';
import { useClaudeUsageStore } from '../../../../renderer/stores/claudeUsageStore';
import type { Theme } from '../../../../renderer/types';

const mockTheme = {
	name: 'test',
	colors: {
		bgMain: '#1a1a2e',
		bgSidebar: '#16213e',
		bgActivity: '#16213e',
		bgInput: '#0f3460',
		textMain: '#e0e0e0',
		textDim: '#888888',
		accent: '#4a90e2',
		accentDim: '#4a90e220',
		border: '#333333',
		error: '#ff4444',
		success: '#00cc66',
		warning: '#ffaa00',
	},
} as unknown as Theme;

const refreshClaudeUsageSnapshots = vi.fn();
const getClaudeUsageSnapshots = vi.fn();

function makeProps(
	overrides: Partial<React.ComponentProps<typeof ClaudeInteractiveModeSection>> = {}
) {
	return {
		theme: mockTheme,
		headlessMode: 'auto' as const,
		onHeadlessModeChange: vi.fn(),
		autoFallbackToApiOnLimit: true,
		onAutoFallbackToApiOnLimitChange: vi.fn(),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	refreshClaudeUsageSnapshots.mockResolvedValue({ refreshed: 0 });
	getClaudeUsageSnapshots.mockResolvedValue({});
	const maestro = (window as any).maestro;
	maestro.agents.refreshClaudeUsageSnapshots = refreshClaudeUsageSnapshots;
	maestro.agents.getClaudeUsageSnapshots = getClaudeUsageSnapshots;
	useClaudeUsageStore.setState({
		snapshots: {},
		loaded: true,
		loading: false,
		error: null,
	} as any);
});

afterEach(() => {
	cleanup();
});

describe('ClaudeInteractiveModeSection', () => {
	it('renders the three-mode toggle group and exposes the canonical setting id', () => {
		const props = makeProps();
		const { container } = render(<ClaudeInteractiveModeSection {...props} />);

		const headlessWrap = container.querySelector('[data-setting-id="claudeCode.headlessMode"]');
		expect(headlessWrap).not.toBeNull();
		expect(screen.getByText('Interactive')).toBeInTheDocument();
		expect(screen.getByText('API')).toBeInTheDocument();
		expect(screen.getByText('Auto')).toBeInTheDocument();
	});

	it('fires onHeadlessModeChange when a toggle button is clicked', () => {
		const onHeadlessModeChange = vi.fn();
		render(
			<ClaudeInteractiveModeSection
				{...makeProps({ headlessMode: 'auto', onHeadlessModeChange })}
			/>
		);

		fireEvent.click(screen.getByText('Interactive'));
		expect(onHeadlessModeChange).toHaveBeenCalledWith('interactive');

		fireEvent.click(screen.getByText('API'));
		expect(onHeadlessModeChange).toHaveBeenCalledWith('api');
	});

	it('shows mode-specific help text', () => {
		const props = makeProps({ headlessMode: 'interactive' });
		const { rerender } = render(<ClaudeInteractiveModeSection {...props} />);

		expect(screen.getByTestId('claude-mode-help').textContent).toContain('maestro-p');

		rerender(<ClaudeInteractiveModeSection {...makeProps({ headlessMode: 'api' })} />);
		expect(screen.getByTestId('claude-mode-help').textContent).toContain('--print');

		rerender(<ClaudeInteractiveModeSection {...makeProps({ headlessMode: 'auto' })} />);
		expect(screen.getByTestId('claude-mode-help').textContent).toContain('fall back');
	});

	it('renders auto-fallback toggle with the canonical setting id and reflects the prop', () => {
		const onAutoFallbackToApiOnLimitChange = vi.fn();
		const { container } = render(
			<ClaudeInteractiveModeSection
				{...makeProps({
					autoFallbackToApiOnLimit: true,
					onAutoFallbackToApiOnLimitChange,
				})}
			/>
		);

		const fallbackWrap = container.querySelector(
			'[data-setting-id="claudeCode.autoFallbackToApiOnLimit"]'
		);
		expect(fallbackWrap).not.toBeNull();

		// SettingCheckbox exposes the toggle as a `role="switch"` button.
		const switchEl = fallbackWrap!.querySelector('[role="switch"]') as HTMLButtonElement;
		expect(switchEl.getAttribute('aria-checked')).toBe('true');

		fireEvent.click(switchEl);
		expect(onAutoFallbackToApiOnLimitChange).toHaveBeenCalledWith(false);
	});

	it('shows the empty state when no usage snapshots are loaded', () => {
		render(<ClaudeInteractiveModeSection {...makeProps()} />);
		expect(screen.getByTestId('claude-mode-usage-empty')).toBeInTheDocument();
	});

	it('renders one row per configDirKey using the short account name', () => {
		const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		useClaudeUsageStore.setState({
			snapshots: {
				'/Users/me/.claude': {
					sampledAt: new Date().toISOString(),
					configDirKey: '/Users/me/.claude',
					session: { percent: 12, resetsAt: future },
					weekAllModels: { percent: 45, resetsAt: future },
					weekSonnetOnly: { percent: 30, resetsAt: future },
				},
				'/Users/me/.claude-gmail': {
					sampledAt: new Date().toISOString(),
					configDirKey: '/Users/me/.claude-gmail',
					session: { percent: 96, resetsAt: future },
					weekAllModels: { percent: 80, resetsAt: future },
					weekSonnetOnly: { percent: 60, resetsAt: future },
				},
			},
			loaded: true,
			loading: false,
			error: null,
		} as any);

		render(<ClaudeInteractiveModeSection {...makeProps()} />);

		expect(screen.getByTestId('claude-mode-usage-row-/Users/me/.claude')).toBeInTheDocument();
		expect(screen.getByTestId('claude-mode-usage-row-/Users/me/.claude-gmail')).toBeInTheDocument();
		// Short names: `.claude` → `default`, `.claude-gmail` → `gmail`.
		expect(screen.getByText('default')).toBeInTheDocument();
		expect(screen.getByText('gmail')).toBeInTheDocument();
	});

	it('clicks Refresh now → calls refresh IPC then refresh() to repopulate', async () => {
		useClaudeUsageStore.setState({
			snapshots: {
				'/Users/me/.claude': {
					sampledAt: new Date().toISOString(),
					configDirKey: '/Users/me/.claude',
					session: { percent: 10, resetsAt: new Date().toISOString() },
					weekAllModels: { percent: 20, resetsAt: new Date().toISOString() },
					weekSonnetOnly: { percent: 5, resetsAt: new Date().toISOString() },
				},
			},
			loaded: true,
			loading: false,
			error: null,
		} as any);

		render(<ClaudeInteractiveModeSection {...makeProps()} />);

		fireEvent.click(screen.getByTestId('claude-mode-usage-refresh'));

		await waitFor(() => {
			expect(refreshClaudeUsageSnapshots).toHaveBeenCalledTimes(1);
			expect(getClaudeUsageSnapshots).toHaveBeenCalled();
		});
	});

	it('disables the refresh button while the request is in flight', async () => {
		let resolveRefresh: (value: { refreshed: number }) => void = () => {};
		refreshClaudeUsageSnapshots.mockReturnValue(
			new Promise<{ refreshed: number }>((resolve) => {
				resolveRefresh = resolve;
			})
		);

		render(<ClaudeInteractiveModeSection {...makeProps()} />);

		const button = screen.getByTestId('claude-mode-usage-refresh') as HTMLButtonElement;
		fireEvent.click(button);

		await waitFor(() => {
			expect(button.disabled).toBe(true);
		});
		expect(button.textContent).toContain('Refreshing');

		resolveRefresh({ refreshed: 1 });
		await waitFor(() => {
			expect(button.disabled).toBe(false);
		});
	});
});
