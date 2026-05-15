import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

// CodeMirror 6 constructs IntersectionObserver inside its DOMObserver. The
// global setup mocks IntersectionObserver as a non-constructable `vi.fn()`
// which crashes CM6 on mount. Swap in a real class for the duration of this
// file and restore the original global in teardown so the swap does not leak
// into other test files that share the worker. Mirrors the setup in
// MaestroEditor.test.tsx.
class StubIntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}
const ioGlobal = globalThis as typeof globalThis & {
	IntersectionObserver: typeof IntersectionObserver;
};
const originalIntersectionObserver = ioGlobal.IntersectionObserver;
ioGlobal.IntersectionObserver = StubIntersectionObserver as unknown as typeof IntersectionObserver;

afterAll(() => {
	ioGlobal.IntersectionObserver = originalIntersectionObserver;
});

// Skip the dynamic language loader so MaestroEditor stays deterministic and
// does not try to resolve real language packs at test time.
vi.mock('../../../renderer/components/FilePreview/giantPreview/languageLoader', () => ({
	loadLanguageExtension: vi.fn(async () => null),
	hasLanguageSupport: () => false,
}));

// Provide the minimum useSettings surface that MaestroEditor +
// useColumnModeKeymap consume. Both files reach useSettings through the hooks
// barrel, which re-exports from this leaf module — so mocking the leaf
// catches both.
vi.mock('../../../renderer/hooks/settings/useSettings', () => ({
	useSettings: () => ({
		activeThemeId: 'dracula',
		customThemeColors: {
			bgMain: '#282a36',
			bgSidebar: '#21222c',
			bgActivity: '#343746',
			border: '#44475a',
			textMain: '#f8f8f2',
			textDim: '#6272a4',
			accent: '#bd93f9',
			accentDim: 'rgba(189, 147, 249, 0.2)',
			accentText: '#ff79c6',
			accentForeground: '#282a36',
			success: '#50fa7b',
			warning: '#ffb86c',
			error: '#ff5555',
		},
		shortcuts: {
			columnModeAddCursorAbove: {
				id: 'columnModeAddCursorAbove',
				label: 'Column Mode: Add Cursor Above',
				keys: ['Alt', 'Meta', 'ArrowUp'],
			},
			columnModeAddCursorBelow: {
				id: 'columnModeAddCursorBelow',
				label: 'Column Mode: Add Cursor Below',
				keys: ['Alt', 'Meta', 'ArrowDown'],
			},
		},
	}),
}));

// Mock useAtMentionCompletion hook
const mockGetSuggestions = vi.fn().mockReturnValue([]);
vi.mock('../../../renderer/hooks/input/useAtMentionCompletion', () => ({
	useAtMentionCompletion: () => ({ getSuggestions: mockGetSuggestions }),
}));

import { PromptComposerModal } from '../../../renderer/components/PromptComposerModal';
import { formatEnterToSend } from '../../../renderer/utils/shortcutFormatter';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import type { Theme, Session, Group } from '../../../renderer/types';
import { createMockSession as baseCreateMockSession } from '../../helpers/mockSession';

import { mockTheme } from '../../helpers/mockTheme';

// Mock theme

const lightTheme: Theme = {
	id: 'test-light',
	name: 'Test Light',
	mode: 'light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f5f5f5',
		border: '#e0e0e0',
		textMain: '#000000',
		textDim: '#666666',
		textFaint: '#aaaaaa',
		accent: '#0066cc',
		accentForeground: '#ffffff',
		buttonBg: '#e0e0e0',
		buttonHover: '#d0d0d0',
		headerBg: '#fafafa',
		scrollbarTrack: '#f0f0f0',
		scrollbarThumb: '#cccccc',
	},
};

// Helper to render with LayerStackProvider
const renderWithProvider = (ui: React.ReactElement) => {
	return render(<LayerStackProvider>{ui}</LayerStackProvider>);
};

// --- CodeMirror test helpers -------------------------------------------------
// PromptComposerModal renders the live editing surface as a CM6 EditorView
// (via MaestroEditor), not a `<textarea>`. These helpers replace the
// textarea-era assertions: read the value through the EditorView document,
// replace the value through a CM transaction, and find the focus/keydown
// target through `.cm-content` (which carries `role="textbox"`).

function getEditorView(container: HTMLElement): EditorView {
	const editor = container.querySelector('.cm-editor');
	if (!editor) {
		throw new Error('CodeMirror editor (.cm-editor) is not mounted');
	}
	const view = EditorView.findFromDOM(editor as HTMLElement);
	if (!view) {
		throw new Error('EditorView.findFromDOM returned null');
	}
	return view;
}

function getEditorContent(container: HTMLElement): HTMLElement {
	const content = container.querySelector('.cm-content');
	if (!content) {
		throw new Error('CodeMirror content (.cm-content) is not mounted');
	}
	return content as HTMLElement;
}

function getEditorValue(container: HTMLElement): string {
	return getEditorView(container).state.doc.toString();
}

function getEditorPlaceholderText(container: HTMLElement): string | null {
	const placeholder = container.querySelector('.cm-placeholder');
	return placeholder?.textContent ?? null;
}

/**
 * Replace the entire editor document with `value` and park the caret at the
 * end. Equivalent to the textarea-era `fireEvent.change(textarea, { target:
 * { value } })`: each call fires the editor's `updateListener` once, which
 * propagates through `onChange` → `handleValueChange` → `onSubmit`.
 */
function typeInEditor(container: HTMLElement, value: string) {
	act(() => {
		const view = getEditorView(container);
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			selection: { anchor: value.length },
		});
	});
}

describe('PromptComposerModal', () => {
	let onClose: ReturnType<typeof vi.fn>;
	let onSubmit: ReturnType<typeof vi.fn>;
	let onSend: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onClose = vi.fn();
		onSubmit = vi.fn();
		onSend = vi.fn();
		mockGetSuggestions.mockReturnValue([]);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Rendering', () => {
		it('should not render when isOpen is false', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={false}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.queryByText('Prompt Composer')).not.toBeInTheDocument();
		});

		it('should render when isOpen is true', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('Prompt Composer')).toBeInTheDocument();
		});

		it('keeps the live editor out of bionify reading mode', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Reading-mode exclusions stay in the editor."
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(getEditorValue(container)).toBe('Reading-mode exclusions stay in the editor.');
			expect(document.querySelector('.bionify-word')).not.toBeInTheDocument();
		});

		it('should render header with PenLine icon', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByTestId('penline-icon')).toBeInTheDocument();
		});

		it('should render with default session name "Claude"', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('— Claude')).toBeInTheDocument();
		});

		it('should render with custom session name', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessionName="My Custom Session"
				/>
			);

			expect(screen.getByText('— My Custom Session')).toBeInTheDocument();
		});

		it('should render keyboard shortcut hint when onToggleEnterToSend is provided', () => {
			const onToggle = vi.fn();
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					enterToSend={false}
					onToggleEnterToSend={onToggle}
				/>
			);

			expect(screen.getByText(formatEnterToSend(false))).toBeInTheDocument();
		});

		it('should render close button with X icon', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByTitle('Close (Escape)')).toBeInTheDocument();
			expect(screen.getByTestId('x-icon')).toBeInTheDocument();
		});

		it('should render editor placeholder', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(getEditorPlaceholderText(container)).toBe(
				'Write your prompt here... (@ to reference files)'
			);
		});

		it('should render editor with initial value', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Initial prompt text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(getEditorValue(container)).toBe('Initial prompt text');
		});

		it('should render Send button with icon', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
			expect(screen.getByTestId('send-icon')).toBeInTheDocument();
		});
	});

	describe('Theme colors', () => {
		it('should apply dark theme colors', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const title = screen.getByText('Prompt Composer');
			expect(title).toHaveStyle({ color: mockTheme.colors.textMain });
		});

		it('should apply light theme colors', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={lightTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const title = screen.getByText('Prompt Composer');
			expect(title).toHaveStyle({ color: lightTheme.colors.textMain });
		});

		it('should apply accent color to PenLine icon', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const icon = screen.getByTestId('penline-icon');
			expect(icon).toHaveStyle({ color: mockTheme.colors.accent });
		});

		it('should apply accent color to Send button', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			expect(sendButton).toHaveStyle({ backgroundColor: mockTheme.colors.accent });
		});
	});

	describe('Character and token count', () => {
		it('should display 0 characters for empty text', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('0 characters')).toBeInTheDocument();
		});

		it('should display correct character count', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Hello World"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('11 characters')).toBeInTheDocument();
		});

		it('should display ~0 tokens for empty text', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('~0 tokens')).toBeInTheDocument();
		});

		it('should estimate tokens at 4 chars per token', () => {
			// 20 characters should be ~5 tokens (ceil(20/4) = 5)
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="12345678901234567890"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('~5 tokens')).toBeInTheDocument();
		});

		it('should round up token estimate', () => {
			// 9 characters should be ~3 tokens (ceil(9/4) = 3)
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="123456789"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('~3 tokens')).toBeInTheDocument();
		});

		it('should format large token counts with locale separators', () => {
			// 10000 characters = 2500 tokens, displayed as "2,500"
			const longText = 'a'.repeat(10000);
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue={longText}
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('~2,500 tokens')).toBeInTheDocument();
		});

		it('should update counts when typing', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'Hello');

			expect(screen.getByText('5 characters')).toBeInTheDocument();
			expect(screen.getByText('~2 tokens')).toBeInTheDocument();
		});
	});

	describe('Focus management', () => {
		it('should focus editor when modal opens', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// MaestroEditor's `autoFocus` prop calls `view.focus()` during the
			// mount effect, which routes focus to the contenteditable
			// `.cm-content` surface — the CM6 equivalent of the old textarea.
			expect(document.activeElement).toBe(getEditorContent(container));
		});

		it('should position cursor at end of text', async () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Hello World"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// The composer parks the caret at end-of-doc inside a
			// `requestAnimationFrame` callback so the editor has time to mount
			// and apply the initial value. `waitFor` lets that rAF resolve in
			// jsdom (where rAF is polyfilled with setTimeout).
			await waitFor(() => {
				const view = getEditorView(container);
				expect(view.state.selection.main.head).toBe(11);
				expect(view.state.selection.main.anchor).toBe(11);
			});
		});
	});

	describe('Value syncing', () => {
		it('should sync value when modal opens with new initialValue', () => {
			const { container, rerender } = renderWithProvider(
				<PromptComposerModal
					isOpen={false}
					onClose={onClose}
					theme={mockTheme}
					initialValue="First value"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// Modal closed, now open with new value
			rerender(
				<LayerStackProvider>
					<PromptComposerModal
						isOpen={true}
						onClose={onClose}
						theme={mockTheme}
						initialValue="New value"
						onSubmit={onSubmit}
						onSend={onSend}
					/>
				</LayerStackProvider>
			);

			expect(getEditorValue(container)).toBe('New value');
		});

		it('should not overwrite user edits when initialValue changes while open', () => {
			const { container, rerender } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="First"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'User typing');

			rerender(
				<LayerStackProvider>
					<PromptComposerModal
						isOpen={true}
						onClose={onClose}
						theme={mockTheme}
						initialValue="Stale deferred value"
						onSubmit={onSubmit}
						onSend={onSend}
					/>
				</LayerStackProvider>
			);

			expect(getEditorValue(container)).toBe('User typing');
		});
	});

	describe('Send button', () => {
		it('should be disabled when text is empty', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			expect(sendButton).toBeDisabled();
		});

		it('should be disabled when text is only whitespace', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="   "
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			expect(sendButton).toBeDisabled();
		});

		it('should be enabled when text has content', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Hello"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			expect(sendButton).not.toBeDisabled();
		});

		it('should call onSend and onClose when clicked', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="My prompt"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			fireEvent.click(sendButton);

			expect(onSend).toHaveBeenCalledWith('My prompt');
			expect(onClose).toHaveBeenCalled();
		});

		it('should not call onSend when empty and clicked', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			fireEvent.click(sendButton);

			expect(onSend).not.toHaveBeenCalled();
		});
	});

	describe('Keyboard shortcuts', () => {
		it('should send on Cmd + Enter (Mac)', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Test message"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.keyDown(getEditorContent(container), { key: 'Enter', metaKey: true });

			expect(onSend).toHaveBeenCalledWith('Test message');
			expect(onClose).toHaveBeenCalled();
		});

		it('should send on Ctrl + Enter (Windows/Linux)', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Test message"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.keyDown(getEditorContent(container), { key: 'Enter', ctrlKey: true });

			expect(onSend).toHaveBeenCalledWith('Test message');
			expect(onClose).toHaveBeenCalled();
		});

		it('should not send on Enter without modifier', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Test message"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.keyDown(getEditorContent(container), { key: 'Enter' });

			expect(onSend).not.toHaveBeenCalled();
		});

		it('should not send on Cmd + Enter with empty content', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.keyDown(getEditorContent(container), { key: 'Enter', metaKey: true });

			expect(onSend).not.toHaveBeenCalled();
		});

		it('should not send on Cmd + Enter with only whitespace', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="   "
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.keyDown(getEditorContent(container), { key: 'Enter', metaKey: true });

			expect(onSend).not.toHaveBeenCalled();
		});

		// When enterToSend=true (Expanded AI Interaction Mode "Enter sends"): plain Enter
		// sends, Shift+Enter inserts a newline, Cmd/Ctrl+Enter falls through (no-op).
		describe('when enterToSend is true', () => {
			it('sends on plain Enter', () => {
				const { container } = renderWithProvider(
					<PromptComposerModal
						isOpen={true}
						onClose={onClose}
						theme={mockTheme}
						initialValue="Test message"
						onSubmit={onSubmit}
						onSend={onSend}
						enterToSend={true}
					/>
				);

				fireEvent.keyDown(getEditorContent(container), { key: 'Enter' });

				expect(onSend).toHaveBeenCalledWith('Test message');
				expect(onClose).toHaveBeenCalled();
			});

			it('does not send on Shift + Enter (allows newline)', () => {
				const { container } = renderWithProvider(
					<PromptComposerModal
						isOpen={true}
						onClose={onClose}
						theme={mockTheme}
						initialValue="Test message"
						onSubmit={onSubmit}
						onSend={onSend}
						enterToSend={true}
					/>
				);

				fireEvent.keyDown(getEditorContent(container), { key: 'Enter', shiftKey: true });

				expect(onSend).not.toHaveBeenCalled();
			});
		});
	});

	describe('Close button', () => {
		it('should call onSubmit with current value when clicked', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Current text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const closeButton = screen.getByTitle('Close (Escape)');
			fireEvent.click(closeButton);

			expect(onSubmit).toHaveBeenCalledWith('Current text');
			expect(onClose).toHaveBeenCalled();
		});

		it('should preserve edited value on close', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Initial"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'Edited text');

			const closeButton = screen.getByTitle('Close (Escape)');
			fireEvent.click(closeButton);

			expect(onSubmit).toHaveBeenCalledWith('Edited text');
		});
	});

	describe('Backdrop click', () => {
		it('should call onSubmit and onClose when clicking backdrop', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Saved text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// Click the backdrop (outer div) - use the first child of container which is the backdrop
			const backdrop = container.querySelector('.fixed.inset-0');
			if (backdrop) {
				// Need to click exactly on the backdrop, not bubbling from child
				fireEvent.click(backdrop);
			}

			expect(onSubmit).toHaveBeenCalledWith('Saved text');
			expect(onClose).toHaveBeenCalled();
		});

		it('should not close when clicking inside modal content', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			fireEvent.click(getEditorContent(container));

			expect(onClose).not.toHaveBeenCalled();
		});
	});

	describe('Layer stack integration', () => {
		it('should call onSubmit with current value when Escape is pressed', async () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="My draft"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// LayerStackProvider listens on window in the capture phase, so a
			// document-level keydown still reaches it.
			fireEvent.keyDown(document, { key: 'Escape' });

			await waitFor(() => {
				expect(onSubmit).toHaveBeenCalledWith('My draft');
				expect(onClose).toHaveBeenCalled();
			});
		});

		it('should save edited value on Escape', async () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Original"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'Modified');

			fireEvent.keyDown(document, { key: 'Escape' });

			await waitFor(() => {
				expect(onSubmit).toHaveBeenCalledWith('Modified');
			});
		});
	});

	describe('Keystroke sync', () => {
		it('should call onSubmit on every keystroke to sync with parent', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'H');
			expect(onSubmit).toHaveBeenCalledWith('H');

			typeInEditor(container, 'He');
			expect(onSubmit).toHaveBeenCalledWith('He');

			typeInEditor(container, 'Hel');
			expect(onSubmit).toHaveBeenCalledWith('Hel');

			expect(onSubmit).toHaveBeenCalledTimes(3);
		});
	});

	describe('Editor behavior', () => {
		it('should update value on change', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, 'New content');

			expect(getEditorValue(container)).toBe('New content');
		});

		it('mounts the CodeMirror surface with the contenteditable textbox', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// MaestroEditor renders CM6's `.cm-content` as the live editing
			// surface. The textarea-era assertion checked
			// `color: theme.colors.textMain` on a `<textarea>`; that styling
			// now lives inside CM6's themed contenteditable (covered by
			// MaestroEditor.test.tsx), so here we just verify the editor is
			// mounted and exposed as a textbox.
			const content = getEditorContent(container);
			expect(content.getAttribute('role')).toBe('textbox');
			expect(content.getAttribute('contenteditable')).toBe('true');
		});
	});

	describe('Edge cases', () => {
		it('should handle empty session name gracefully', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessionName=""
				/>
			);

			expect(screen.getByText('—')).toBeInTheDocument();
		});

		it('should handle very long text', () => {
			const longText = 'a'.repeat(50000);
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue={longText}
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(screen.getByText('50000 characters')).toBeInTheDocument();
			expect(screen.getByText('~12,500 tokens')).toBeInTheDocument();
		});

		it('should handle unicode characters in text', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Hello 世界 🌍"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			expect(getEditorValue(container)).toBe('Hello 世界 🌍');
		});

		it('should handle special characters in session name', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessionName="Test <script>alert('xss')</script>"
				/>
			);

			// React escapes these by default
			expect(screen.getByText("— Test <script>alert('xss')</script>")).toBeInTheDocument();
		});

		it('should handle newlines in text', () => {
			const multilineText = 'Line 1\nLine 2\nLine 3';
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue={multilineText}
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			// 20 characters including newlines (6+1+6+1+6)
			expect(screen.getByText('20 characters')).toBeInTheDocument();
		});
	});

	describe('Modal structure', () => {
		it('should have fixed positioning with z-50', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const overlay = container.querySelector('.fixed.inset-0.z-50');
			expect(overlay).toBeInTheDocument();
		});

		it('should have semi-transparent backdrop', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const overlay = container.querySelector('.fixed.inset-0');
			expect(overlay).toHaveStyle({ backgroundColor: 'rgba(0,0,0,0.7)' });
		});

		it('should have modal content with rounded corners and border', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const modalContent = container.querySelector('.rounded-xl.border.shadow-2xl');
			expect(modalContent).toBeInTheDocument();
			expect(modalContent).toHaveStyle({
				backgroundColor: mockTheme.colors.bgMain,
				borderColor: mockTheme.colors.border,
			});
		});

		it('should have 90vw width and 80vh height', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const modalContent = container.querySelector('.w-\\[90vw\\].h-\\[80vh\\]');
			expect(modalContent).toBeInTheDocument();
		});
	});

	describe('Accessibility', () => {
		it('should expose the editor as a contenteditable textbox', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const content = getEditorContent(container);
			expect(content.getAttribute('role')).toBe('textbox');
			expect(content.getAttribute('contenteditable')).toBe('true');
		});

		it('should have accessible close button with title', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const closeButton = screen.getByTitle('Close (Escape)');
			expect(closeButton).toBeInTheDocument();
			expect(closeButton.tagName).toBe('BUTTON');
		});

		it('should have accessible send button', () => {
			renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue="Text"
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			const sendButton = screen.getByRole('button', { name: /send/i });
			expect(sendButton).toBeInTheDocument();
		});
	});

	describe('@mention autocomplete (group chat mode)', () => {
		// Thin wrapper: positional signature preserved. Delegates to shared factory.
		function createMockSession(
			id: string,
			name: string,
			toolType: string = 'claude-code'
		): Session {
			return baseCreateMockSession({ id, name, toolType: toolType as any });
		}

		function createMockGroup(id: string, name: string, emoji: string = '📁'): Group {
			return { id, name, emoji, collapsed: false };
		}

		it('should show mention placeholder when sessions are provided', () => {
			const sessions = [createMockSession('s1', 'Agent1')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			expect(getEditorPlaceholderText(container)).toBe(
				'Write your prompt here... (@ to mention agents)'
			);
		});

		it('should show mention dropdown when typing @', () => {
			const sessions = [createMockSession('s1', 'Agent1'), createMockSession('s2', 'Agent2')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');

			expect(screen.getByText('@Agent1')).toBeInTheDocument();
			expect(screen.getByText('@Agent2')).toBeInTheDocument();
		});

		it('should filter mentions as user types', () => {
			const sessions = [createMockSession('s1', 'Agent1'), createMockSession('s2', 'Other')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@Age');

			expect(screen.getByText('@Agent1')).toBeInTheDocument();
			expect(screen.queryByText('@Other')).not.toBeInTheDocument();
		});

		it('should insert mention on click', () => {
			const sessions = [createMockSession('s1', 'Agent1')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');
			fireEvent.click(screen.getByText('@Agent1'));

			expect(getEditorValue(container)).toBe('@Agent1 ');
		});

		it('should insert mention on Tab key', () => {
			const sessions = [createMockSession('s1', 'Agent1')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');
			fireEvent.keyDown(getEditorContent(container), { key: 'Tab' });

			expect(getEditorValue(container)).toBe('@Agent1 ');
		});

		it('should navigate mentions with arrow keys', () => {
			const sessions = [createMockSession('s1', 'Agent1'), createMockSession('s2', 'Agent2')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');
			fireEvent.keyDown(getEditorContent(container), { key: 'ArrowDown' });
			fireEvent.keyDown(getEditorContent(container), { key: 'Tab' });

			expect(getEditorValue(container)).toBe('@Agent2 ');
		});

		it('should close dropdown on Escape', () => {
			const sessions = [createMockSession('s1', 'Agent1')];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');
			expect(screen.getByText('@Agent1')).toBeInTheDocument();

			// Escape is owned by the LayerStack — the modal's escape handler
			// closes the dropdown first (instead of the modal) when mentions
			// are open.
			fireEvent.keyDown(document, { key: 'Escape' });
			expect(screen.queryByText('@Agent1')).not.toBeInTheDocument();
		});

		it('should exclude terminal sessions', () => {
			const sessions = [
				createMockSession('s1', 'Agent1', 'claude-code'),
				createMockSession('s2', 'Terminal', 'terminal'),
			];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
				/>
			);

			typeInEditor(container, '@');

			expect(screen.getByText('@Agent1')).toBeInTheDocument();
			expect(screen.queryByText('@Terminal')).not.toBeInTheDocument();
		});

		it('should expand group into member mentions', () => {
			const groups = [createMockGroup('g1', 'TEAM', '🏢')];
			const sessions = [
				{ ...createMockSession('s1', 'Agent1'), groupId: 'g1' },
				{ ...createMockSession('s2', 'Agent2'), groupId: 'g1' },
			];
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
					sessions={sessions}
					groups={groups}
				/>
			);

			typeInEditor(container, '@');
			fireEvent.click(screen.getByText('@TEAM'));

			expect(getEditorValue(container)).toBe('@Agent1 @Agent2 ');
		});

		it('should show file suggestions from useAtMentionCompletion', () => {
			mockGetSuggestions.mockReturnValue([
				{
					value: 'src/index.ts',
					type: 'file',
					displayText: 'index.ts',
					fullPath: 'src/index.ts',
					score: 100,
					source: 'project',
				},
			]);
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, '@ind');

			expect(mockGetSuggestions).toHaveBeenCalledWith('ind');
			expect(screen.getByText('src/index.ts')).toBeInTheDocument();
		});

		it('should insert file path on file suggestion click', () => {
			mockGetSuggestions.mockReturnValue([
				{
					value: 'src/utils.ts',
					type: 'file',
					displayText: 'utils.ts',
					fullPath: 'src/utils.ts',
					score: 100,
					source: 'project',
				},
			]);
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, '@util');
			fireEvent.click(screen.getByText('src/utils.ts'));

			expect(getEditorValue(container)).toBe('@src/utils.ts ');
		});

		it('should not show agent mention dropdown without sessions prop', () => {
			const { container } = renderWithProvider(
				<PromptComposerModal
					isOpen={true}
					onClose={onClose}
					theme={mockTheme}
					initialValue=""
					onSubmit={onSubmit}
					onSend={onSend}
				/>
			);

			typeInEditor(container, '@');

			// No agent mention buttons should appear (file mentions may appear if mocked)
			const buttons = screen.queryAllByRole('button');
			const agentMentionButtons = buttons.filter(
				(btn) =>
					btn.textContent?.startsWith('@') &&
					!btn.querySelector('[data-testid="file-icon"]') &&
					!btn.querySelector('[data-testid="folder-icon"]')
			);
			expect(agentMentionButtons).toHaveLength(0);
		});
	});
});
