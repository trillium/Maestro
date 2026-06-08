/**
 * WizardMessageBubble.tsx — webFull-side lift of
 * `src/renderer/components/InlineWizard/WizardMessageBubble.tsx`
 * (193 LOC) with the standard Wizard Phase-1 import-path adjustments.
 *
 * Lift rationale: this is one of the two Wizard Phase-1 leaves blocked
 * by `createWizardBubbleMarkdownComponents` in
 * `src/renderer/utils/markdownConfig.ts` (the renderer factory body at
 * L696 hardcodes the Electron `shell.openExternal(href)` IPC call,
 * unlike the sibling `createMarkdownComponents` which takes an injected
 * `onExternalLinkClick` callback). The blocker is resolved by the
 * surgical extract that ships alongside this lift at
 * `src/webFull/utils/markdownConfig.ts` — a focused webFull module
 * that re-implements only `createWizardBubbleMarkdownComponents` with
 * the callback-injection pattern (default: `window.open(href, '_blank',
 * 'noopener,noreferrer')`).
 *
 * Import-path adapts (matching the Wizard Phase-1 precedent — pure
 * wizard support modules under `Wizard/services/` and `Wizard/shared/`
 * stay imported directly from the renderer to avoid silent-drift
 * duplication; only the divergence-required swaps are performed):
 *   - `Theme` from `'../../types'` → `'../../../shared/theme-types'`
 *     (standard webFull-tree swap — webFull has no `types/` aggregator).
 *   - `createWizardBubbleMarkdownComponents`, `REMARK_GFM_PLUGINS` from
 *     `'../../utils/markdownConfig'` → `'../../utils/markdownConfig'`
 *     (webFull-side surgical extract — DIFFERENT file from the renderer
 *     module of the same name; this one takes an injected
 *     `onExternalLinkClick` callback and defaults to `window.open`).
 *   - `getConfidenceColor` from `'../Wizard/services/wizardPrompts'`
 *     → `'../../../renderer/components/Wizard/services/wizardPrompts'`
 *     (pure module, 0 IPC — verified via the standard banned-surface
 *     grep → empty).
 *   - `formatAgentName` from `'../Wizard/shared/wizardHelpers'`
 *     → `'../../../renderer/components/Wizard/shared/wizardHelpers'`
 *     (pure module, 0 IPC — verified via the same grep).
 *
 * Pre-flight grep on this file (renderer source) for
 * `window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer`
 * → empty. The only Electron-only surface this component touched was
 * transitive through `createWizardBubbleMarkdownComponents`, neutralized
 * by the surgical extract.
 *
 * External link behaviour: the lifted bubble passes a
 * `(href) => window.open(href, '_blank', 'noopener,noreferrer')`
 * callback to the surgically-extracted factory. This opens external
 * links in a new browser tab when rendered inside the webFull host.
 *
 * Renderer-side `src/renderer/components/InlineWizard/WizardMessageBubble.tsx`
 * is UNTOUCHED — fork hygiene.
 *
 * Original component documentation follows verbatim:
 *
 * Message bubble component for the inline wizard conversation.
 * Reuses styling patterns from ConversationScreen.tsx MessageBubble.
 *
 * Features:
 * - User messages: right-aligned with accent color background
 * - Assistant messages: left-aligned with bgActivity background
 * - System messages: left-aligned with warning-tinted background
 * - Timestamp display in bottom-right
 * - Markdown rendering with ReactMarkdown + remarkGfm
 * - Confidence badge for assistant messages (when confidence is available)
 */

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Theme } from '../../../shared/theme-types';
import { getConfidenceColor } from '../../../renderer/components/Wizard/services/wizardPrompts';
import { formatAgentName } from '../../../renderer/components/Wizard/shared/wizardHelpers';
import {
	REMARK_GFM_PLUGINS,
	createWizardBubbleMarkdownComponents,
} from '../../utils/markdownConfig';

/**
 * Message structure for wizard conversations
 */
export interface WizardMessageBubbleMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	/** Parsed confidence from assistant responses */
	confidence?: number;
	/** Parsed ready flag from assistant responses */
	ready?: boolean;
	/** Base64-encoded image data URLs attached to this message */
	images?: string[];
}

export interface WizardMessageBubbleProps {
	/** The message to display */
	message: WizardMessageBubbleMessage;
	/** Theme for styling */
	theme: Theme;
	/** Agent name for assistant messages */
	agentName?: string;
	/** Provider name (e.g., "Claude", "OpenCode") for assistant messages */
	providerName?: string;
	/** Callback to open the lightbox for an image */
	setLightboxImage?: (
		image: string | null,
		contextImages?: string[],
		source?: 'staged' | 'history'
	) => void;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Open an external link in a new browser tab with `noopener,noreferrer`.
 * Passed to `createWizardBubbleMarkdownComponents` so the surgically-
 * extracted factory does not need to reach for the Electron IPC bridge.
 */
function openExternalLinkInBrowser(href: string): void {
	window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * WizardMessageBubble - Individual conversation message display for inline wizard
 *
 * Memoized to prevent unnecessary re-renders when parent state changes
 * (e.g., new messages added, isLoading updates, confidence changes).
 * Only re-renders when the message itself or styling props change.
 */
export const WizardMessageBubble = React.memo(function WizardMessageBubble({
	message,
	theme,
	agentName = 'Agent',
	providerName,
	setLightboxImage,
}: WizardMessageBubbleProps): JSX.Element {
	const isUser = message.role === 'user';
	const isSystem = message.role === 'system';
	const wizardMarkdownComponents = useMemo(
		() => createWizardBubbleMarkdownComponents(theme, openExternalLinkInBrowser),
		[theme]
	);

	return (
		<div
			className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
			data-testid={`wizard-message-bubble-${message.role}`}
		>
			<div
				className={`max-w-[80%] rounded-lg px-4 py-3 ${
					isUser ? 'rounded-br-none' : 'rounded-bl-none'
				}`}
				style={{
					backgroundColor: isUser
						? theme.colors.accent
						: isSystem
							? `${theme.colors.warning}20`
							: theme.colors.bgActivity,
					color: isUser ? theme.colors.accentForeground : theme.colors.textMain,
				}}
			>
				{/* Role indicator for non-user messages */}
				{!isUser && (
					<div
						className="text-xs font-medium mb-2 flex items-center justify-between"
						style={{ color: isSystem ? theme.colors.warning : theme.colors.accent }}
					>
						<div className="flex items-center gap-2">
							<span data-testid="message-sender">
								{isSystem ? '🎼 System' : formatAgentName(agentName)}
							</span>
							{message.confidence !== undefined && (
								<span
									className="text-xs px-1.5 py-0.5 rounded"
									style={{
										backgroundColor: `${getConfidenceColor(message.confidence)}20`,
										color: getConfidenceColor(message.confidence),
									}}
									data-testid="confidence-badge"
								>
									{message.confidence}% confident
								</span>
							)}
						</div>
						{providerName && !isSystem && (
							<span
								className="text-xs px-2 py-0.5 rounded-full"
								style={{
									backgroundColor: `${theme.colors.accent}15`,
									color: theme.colors.accent,
									border: `1px solid ${theme.colors.accent}30`,
								}}
								data-testid="provider-badge"
							>
								{providerName}
							</span>
						)}
					</div>
				)}

				{/* Message content */}
				<div className="text-sm break-words wizard-markdown" data-testid="message-content">
					{isUser ? (
						<span className="whitespace-pre-wrap">{message.content}</span>
					) : (
						<ReactMarkdown remarkPlugins={REMARK_GFM_PLUGINS} components={wizardMarkdownComponents}>
							{message.content}
						</ReactMarkdown>
					)}
				</div>

				{/* Attached images */}
				{message.images && message.images.length > 0 && (
					<div
						className="flex gap-2 mt-2 overflow-x-auto scrollbar-thin"
						style={{ overscrollBehavior: 'contain' }}
						data-testid="message-images"
					>
						{message.images.map((img, imgIdx) => (
							<img
								key={imgIdx}
								src={img}
								alt={`Attached image ${imgIdx + 1}`}
								className="h-20 rounded border cursor-zoom-in shrink-0"
								style={{
									objectFit: 'contain',
									maxWidth: '200px',
									borderColor: isUser ? `${theme.colors.accentForeground}30` : theme.colors.border,
								}}
								onClick={() => setLightboxImage?.(img, message.images, 'history')}
							/>
						))}
					</div>
				)}

				{/* Timestamp */}
				<div
					className="text-xs mt-1 text-right opacity-60"
					style={{
						color: isUser ? theme.colors.accentForeground : theme.colors.textDim,
					}}
					data-testid="message-timestamp"
				>
					{formatTimestamp(message.timestamp)}
				</div>
			</div>
		</div>
	);
});
