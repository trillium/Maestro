/**
 * GroupChatMessages.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/GroupChatMessages.tsx`
 * (430 LOC) into `src/webFull/`. Displays the message history for a Group Chat
 * with AI-Terminal-styled chat layout: timestamps outside bubbles, consistent
 * per-participant colors, markdown rendering, and a collapsed/expanded view for
 * long agent responses.
 *
 * Lift posture (per the L2.5 sibling lifts — AutoRunnerHelpModal, PlaybookDeleteConfirmModal):
 * - Component body is verbatim from the renderer source. Only import paths
 *   adapt.
 * - The renderer `Theme` import (`'../types'`) → `'../../shared/theme-types'`
 *   (renderer routes through `src/renderer/types/index.ts`; webFull imports the
 *   type directly).
 * - The renderer group-chat type imports (`GroupChatMessage`,
 *   `GroupChatParticipant`, `GroupChatState`) move from the renderer types
 *   barrel to their canonical source at `src/shared/group-chat-types.ts` (which
 *   is what the renderer barrel re-exports anyway).
 * - `formatShortcutKeys` resolves against the webFull-side shim at
 *   `src/webFull/utils/shortcutFormatter.ts` (precursor infrastructure landed
 *   in the `leaf-autorunner-help` lift). The shim swaps the renderer
 *   formatter's transitive `window.maestro.platform` dependency for
 *   `navigator.userAgent`-based detection, so the call signature is unchanged.
 * - The remaining utility imports (`MarkdownRenderer`, `stripMarkdown`,
 *   `generateParticipantColor` / `buildParticipantColorMap`,
 *   `generateTerminalProseStyles`, `safeClipboardWrite`) re-export from the
 *   renderer modules at `'../../renderer/components/MarkdownRenderer'` /
 *   `'../../renderer/utils/<name>'`. Per the L2.5 `ShortcutsHelpModal` precedent
 *   (which imports types, utils, and constants directly from `'../../renderer/'`),
 *   non-divergent renderer files stay re-imported to prevent silent drift —
 *   only files that would crash at module-load time in a browser runtime (the
 *   shortcutFormatter / platformUtils chain) get webFull shims. Each of these
 *   renderer files defers any `window.maestro` access into lambda bodies
 *   (image-fetch IPC inside a `useEffect`, link `onClick` handlers, optional
 *   chained image-clipboard fallback, optional preference-load reads). Module
 *   load is safe in the browser; the unsafe code paths are only reached on
 *   user interactions that don't apply to the messages view's use of those
 *   exports (`MarkdownRenderer` is invoked for text content,
 *   `safeClipboardWrite` is text-only, the `participantColors` exports we use
 *   are pure, and `generateTerminalProseStyles` is a pure CSS generator).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and the L2.4 / L2.5
 * sibling lifts. Callers in webFull will call `const { theme } = useTheme()`
 * at the feature-component level and thread it down.
 *
 * 0 IPC namespaces touched directly. 0 Electron-only APIs touched directly.
 * Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer"` against the renderer source returned empty.
 */

import {
	useRef,
	useEffect,
	useCallback,
	useMemo,
	useState,
	forwardRef,
	useImperativeHandle,
} from 'react';
import { Eye, FileText, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type {
	GroupChatMessage,
	GroupChatParticipant,
	GroupChatState,
} from '../../shared/group-chat-types';
import { MarkdownRenderer } from '../../renderer/components/MarkdownRenderer';
import { stripMarkdown } from '../../renderer/utils/textProcessing';
import {
	generateParticipantColor,
	buildParticipantColorMap,
} from '../../renderer/utils/participantColors';
import { generateTerminalProseStyles } from '../../renderer/utils/markdownConfig';
import { formatShortcutKeys } from '../utils/shortcutFormatter';
import { safeClipboardWrite } from '../../renderer/utils/clipboard';

interface GroupChatMessagesProps {
	theme: Theme;
	messages: GroupChatMessage[];
	participants: GroupChatParticipant[];
	state: GroupChatState;
	markdownEditMode?: boolean;
	onToggleMarkdownEditMode?: () => void;
	maxOutputLines?: number;
	/** Pre-computed participant colors (if provided, overrides internal color generation) */
	participantColors?: Record<string, string>;
}

/** Handle exposed via ref for scrolling to messages */
export interface GroupChatMessagesHandle {
	scrollToMessage: (timestamp: number) => void;
}

export const GroupChatMessages = forwardRef<GroupChatMessagesHandle, GroupChatMessagesProps>(
	function GroupChatMessages(
		{
			theme,
			messages,
			participants,
			state,
			markdownEditMode,
			onToggleMarkdownEditMode,
			maxOutputLines = 30,
			participantColors: externalColors,
		},
		ref
	) {
		const containerRef = useRef<HTMLDivElement>(null);
		const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

		// Expose scrollToMessage method via ref
		useImperativeHandle(
			ref,
			() => ({
				scrollToMessage: (timestamp: number) => {
					if (!containerRef.current) return;

					// Find the message element by timestamp
					// Try exact match first, then find closest message
					let targetElement = containerRef.current.querySelector(
						`[data-message-timestamp="${timestamp}"]`
					);

					// If no exact match, find the closest message by timestamp
					if (!targetElement) {
						const allMessages = containerRef.current.querySelectorAll('[data-message-timestamp]');
						let closestElement: Element | null = null;
						let closestDiff = Infinity;

						allMessages.forEach((el) => {
							const msgTimestamp = el.getAttribute('data-message-timestamp');
							if (msgTimestamp) {
								// Handle both ISO string and numeric timestamp formats
								const msgTime = isNaN(Number(msgTimestamp))
									? new Date(msgTimestamp).getTime()
									: Number(msgTimestamp);
								const diff = Math.abs(msgTime - timestamp);
								if (diff < closestDiff) {
									closestDiff = diff;
									closestElement = el;
								}
							}
						});

						// Only use closest if within 5 seconds
						if (closestElement && closestDiff < 5000) {
							targetElement = closestElement;
						}
					}

					if (targetElement) {
						targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

						// Flash highlight effect
						const element = targetElement as HTMLElement;
						element.style.transition = 'background-color 0.3s ease';
						const originalBg = element.style.backgroundColor;
						element.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
						setTimeout(() => {
							element.style.backgroundColor = originalBg;
						}, 1000);
					}
				},
			}),
			[]
		);

		const copyToClipboard = useCallback(async (text: string) => {
			await safeClipboardWrite(text);
		}, []);

		const toggleExpanded = useCallback((msgKey: string) => {
			setExpandedMessages((prev) => {
				const next = new Set(prev);
				if (next.has(msgKey)) {
					next.delete(msgKey);
				} else {
					next.add(msgKey);
				}
				return next;
			});
		}, []);

		// Memoized prose styles for markdown rendering - uses shared generator for consistency with TerminalOutput
		const proseStyles = useMemo(
			() => generateTerminalProseStyles(theme, '.group-chat-messages'),
			[theme]
		);

		// Auto-scroll on new messages
		useEffect(() => {
			const container = containerRef.current as HTMLDivElement;
			container.scrollTop = container.scrollHeight;
		}, [messages]);

		// Use external colors if provided, otherwise generate locally
		// Include 'Moderator' at index 0 to match the participant panel's color assignment
		const participantColors = useMemo(() => {
			if (externalColors) return externalColors;
			return buildParticipantColorMap(['Moderator', ...participants.map((p) => p.name)], theme);
		}, [participants, theme, externalColors]);

		const getParticipantColor = (name: string): string => {
			return participantColors[name] || generateParticipantColor(0, theme);
		};

		// Format timestamp like AI Terminal (outside bubble)
		// Accepts both ISO string and Unix timestamp
		const formatTimestamp = (timestamp: string | number) => {
			const date = new Date(timestamp);
			const today = new Date();
			const isToday = date.toDateString() === today.toDateString();
			const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			if (isToday) {
				return time;
			}
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return (
				<>
					<div>
						{year}-{month}-{day}
					</div>
					<div>{time}</div>
				</>
			);
		};

		return (
			<div
				ref={containerRef}
				className="group-chat-messages flex-1 overflow-y-auto scrollbar-thin py-2"
			>
				{/* Prose styles for markdown rendering */}
				<style>{proseStyles}</style>
				{messages.length === 0 ? (
					<div className="flex items-center justify-center h-full px-6">
						<div className="text-center max-w-md space-y-3">
							<div className="flex justify-center mb-4">
								<span
									className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded"
									style={{
										backgroundColor: `${theme.colors.accent}20`,
										color: theme.colors.accent,
										border: `1px solid ${theme.colors.accent}40`,
									}}
								>
									Beta
								</span>
							</div>
							<p className="text-sm" style={{ color: theme.colors.textDim }}>
								Messages you send go directly to the{' '}
								<span style={{ color: theme.colors.warning }}>moderator</span>, who orchestrates the
								conversation and decides when to involve other agents.
							</p>
							<p className="text-sm" style={{ color: theme.colors.textDim }}>
								Use <span style={{ color: theme.colors.accent }}>@agent</span> to message a specific
								agent directly at any time.
							</p>
						</div>
					</div>
				) : (
					messages.map((msg, index) => {
						const isUser = msg.from === 'user';
						const isSystem = msg.from === 'system';
						const msgKey = `${msg.timestamp}-${index}`;
						const isExpanded = expandedMessages.has(msgKey);

						// Calculate if content should be collapsed
						const lineCount = msg.content.split('\n').length;
						const shouldCollapse =
							!isUser && !isSystem && lineCount > maxOutputLines && maxOutputLines !== Infinity;
						const displayContent =
							shouldCollapse && !isExpanded
								? msg.content.split('\n').slice(0, maxOutputLines).join('\n')
								: msg.content;

						// Get sender color for non-user messages
						// Use 'Moderator' (capitalized) to match the color map key
						// System messages use error color
						const senderColor = isSystem
							? theme.colors.error
							: msg.from === 'moderator'
								? getParticipantColor('Moderator')
								: getParticipantColor(msg.from);

						return (
							<div
								key={msgKey}
								data-message-timestamp={msg.timestamp}
								className={`flex gap-4 group ${isUser ? 'flex-row-reverse' : ''} px-6 py-2`}
							>
								{/* Timestamp - outside bubble, like AI Terminal */}
								<div
									className={`w-20 shrink-0 text-[10px] pt-2 ${isUser ? 'text-right' : 'text-left'}`}
									style={{ color: theme.colors.textDim, opacity: 0.6 }}
								>
									{formatTimestamp(msg.timestamp)}
								</div>

								{/* Message bubble */}
								<div
									className={`flex-1 min-w-0 p-4 pb-10 rounded-xl border ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'} relative overflow-hidden`}
									style={{
										backgroundColor: isUser
											? `color-mix(in srgb, ${theme.colors.accent} 20%, ${theme.colors.bgSidebar})`
											: theme.colors.bgActivity,
										borderColor: isUser ? theme.colors.accent + '40' : theme.colors.border,
										borderLeftWidth: !isUser ? '3px' : undefined,
										borderLeftColor: !isUser ? senderColor : undefined,
										color: theme.colors.textMain,
									}}
								>
									{/* Sender label for non-user messages */}
									{!isUser && (
										<div className="text-xs font-medium mb-2" style={{ color: senderColor }}>
											{msg.from === 'moderator'
												? 'Moderator'
												: msg.from === 'system'
													? 'System'
													: msg.from}
										</div>
									)}

									{/* Message content */}
									{shouldCollapse && !isExpanded ? (
										// Collapsed view
										<div>
											<div
												className="text-sm overflow-hidden"
												style={{ maxHeight: `${maxOutputLines * 1.5}em` }}
											>
												{!isUser && !markdownEditMode ? (
													<MarkdownRenderer
														content={displayContent}
														theme={theme}
														onCopy={copyToClipboard}
													/>
												) : (
													<div className="whitespace-pre-wrap">{stripMarkdown(displayContent)}</div>
												)}
											</div>
											<button
												onClick={() => toggleExpanded(msgKey)}
												className="flex items-center gap-2 mt-2 text-xs px-3 py-1.5 rounded border hover:opacity-70 transition-opacity"
												style={{
													borderColor: theme.colors.border,
													backgroundColor: theme.colors.bgActivity,
													color: theme.colors.accent,
												}}
											>
												<ChevronDown className="w-3 h-3" />
												Show all {lineCount} lines
											</button>
										</div>
									) : shouldCollapse && isExpanded ? (
										// Expanded view (was collapsed)
										<div>
											<div
												className="text-sm overflow-auto scrollbar-thin"
												style={{ maxHeight: '600px', overscrollBehavior: 'contain' }}
												onWheel={(e) => {
													const el = e.currentTarget;
													const { scrollTop, scrollHeight, clientHeight } = el;
													const atTop = scrollTop <= 0;
													const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
													if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) {
														e.stopPropagation();
													}
												}}
											>
												{!isUser && !markdownEditMode ? (
													<MarkdownRenderer
														content={msg.content}
														theme={theme}
														onCopy={copyToClipboard}
													/>
												) : (
													<div className="whitespace-pre-wrap">{stripMarkdown(msg.content)}</div>
												)}
											</div>
											<button
												onClick={() => toggleExpanded(msgKey)}
												className="flex items-center gap-2 mt-2 text-xs px-3 py-1.5 rounded border hover:opacity-70 transition-opacity"
												style={{
													borderColor: theme.colors.border,
													backgroundColor: theme.colors.bgActivity,
													color: theme.colors.accent,
												}}
											>
												<ChevronUp className="w-3 h-3" />
												Show less
											</button>
										</div>
									) : !isUser && !markdownEditMode ? (
										// Normal non-collapsed markdown view
										<div className="text-sm">
											<MarkdownRenderer
												content={msg.content}
												theme={theme}
												onCopy={copyToClipboard}
											/>
										</div>
									) : (
										// User message or raw mode
										<div className="text-sm whitespace-pre-wrap">
											{isUser ? msg.content : stripMarkdown(msg.content)}
										</div>
									)}

									{/* Action buttons - bottom right corner (non-user messages only) */}
									{!isUser && (
										<div
											className="absolute bottom-2 right-2 flex items-center gap-1"
											style={{ transition: 'opacity 0.15s ease-in-out' }}
										>
											{/* Markdown toggle button */}
											{onToggleMarkdownEditMode && (
												<button
													onClick={onToggleMarkdownEditMode}
													className="p-1.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100"
													style={{
														color: markdownEditMode ? theme.colors.accent : theme.colors.textDim,
													}}
													title={
														markdownEditMode
															? `Show formatted (${formatShortcutKeys(['Meta', 'e'])})`
															: `Show plain text (${formatShortcutKeys(['Meta', 'e'])})`
													}
												>
													{markdownEditMode ? (
														<Eye className="w-4 h-4" />
													) : (
														<FileText className="w-4 h-4" />
													)}
												</button>
											)}
											{/* Copy to Clipboard Button */}
											<button
												onClick={() => copyToClipboard(msg.content)}
												className="p-1.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100"
												style={{ color: theme.colors.textDim }}
												title="Copy to clipboard"
											>
												<Copy className="w-3.5 h-3.5" />
											</button>
										</div>
									)}
								</div>
							</div>
						);
					})
				)}

				{/* Typing indicator */}
				{state !== 'idle' && (
					<div className="flex gap-4 px-6 py-2">
						<div className="w-20 shrink-0" />
						<div
							className="flex-1 min-w-0 p-4 rounded-xl border rounded-tl-none"
							style={{ backgroundColor: theme.colors.bgActivity, borderColor: theme.colors.border }}
						>
							<div className="flex items-center gap-2">
								<div
									className="w-2 h-2 rounded-full animate-pulse"
									style={{ backgroundColor: theme.colors.warning }}
								/>
								<span className="text-sm" style={{ color: theme.colors.textDim }}>
									{state === 'moderator-thinking'
										? 'Moderator is thinking...'
										: 'Agent is working...'}
								</span>
							</div>
						</div>
					</div>
				)}
			</div>
		);
	}
);
