/**
 * `@talk2view/sdk/ui` — the previous chat panel.
 *
 * @deprecated Use `@talk2view/sdk/chat` for new integrations. This entry point
 * still works and is still supported for the apps already on it, but the
 * packaged chat is where new work goes.
 */

// Components
/** @deprecated Use `Talk2ViewChat` from `@talk2view/sdk/chat`. */
export { Talk2View } from './components/Talk2View.js';
export type { Talk2ViewProps } from './components/Talk2View.js';
/** @deprecated Use `Talk2ViewChat` from `@talk2view/sdk/chat`. */
export { ChatPanel } from './components/ChatPanel.js';
export type { ChatPanelProps } from './components/ChatPanel.js';
/** @deprecated Use `Talk2ViewChat` from `@talk2view/sdk/chat`. */
export { ChatWidget } from './components/ChatWidget.js';
export type { ChatWidgetProps } from './components/ChatWidget.js';

// Context hooks (for advanced custom UI)
export { useChat, useTalk2View } from './context.js';
export type { ChatContextValue, Talk2ViewContextValue } from './context.js';

// Individual components (for composition)
export { MessageList } from './components/MessageList.js';
export { MessageBubble } from './components/MessageBubble.js';
export { Composer } from './components/Composer.js';
export { WelcomeScreen } from './components/WelcomeScreen.js';
export { LoginForm } from './components/LoginForm.js';
export { ChatHeader } from './components/ChatHeader.js';
export { SettingsPanel } from './components/SettingsPanel.js';
export { ApprovalCard } from './components/ApprovalCard.js';
export { ToolDisplay, ToolStepGroup } from './components/ToolDisplay.js';
export type { ToolDisplayProps, ToolStepGroupProps } from './components/ToolDisplay.js';
export { MarkdownRenderer } from './components/MarkdownRenderer.js';
export { CodeBlock } from './components/CodeBlock.js';
export { ThinkingBlock } from './components/ThinkingBlock.js';
export { MessageActions } from './components/MessageActions.js';
export { Shimmer } from './components/Shimmer.js';

// Theme
export { THEME_DEFAULTS, LOGOS } from './theme.js';

// Utilities
export { groupModelsByProvider, providerTitle, UNKNOWN_PROVIDER_KEY } from './utils.js';
export { renderSafeMarkdown } from './safeMarkdown.js';
export type { ModelGroup } from './utils.js';
