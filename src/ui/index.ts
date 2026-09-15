// Components
export { Talk2View } from './components/Talk2View';
export type { Talk2ViewProps } from './components/Talk2View';
export { ChatPanel } from './components/ChatPanel';
export type { ChatPanelProps } from './components/ChatPanel';
export { ChatWidget } from './components/ChatWidget';
export type { ChatWidgetProps } from './components/ChatWidget';

// Context hooks (for advanced custom UI)
export { useChat, useTalk2View } from './context';
export type { ChatContextValue, Talk2ViewContextValue } from './context';

// Individual components (for composition)
export { MessageList } from './components/MessageList';
export { MessageBubble } from './components/MessageBubble';
export { Composer } from './components/Composer';
export { WelcomeScreen } from './components/WelcomeScreen';
export { LoginForm } from './components/LoginForm';
export { ChatHeader } from './components/ChatHeader';
export { SettingsPanel } from './components/SettingsPanel';
export { ApprovalCard } from './components/ApprovalCard';
export { ToolDisplay, ToolStepGroup } from './components/ToolDisplay';
export type { ToolDisplayProps, ToolStepGroupProps } from './components/ToolDisplay';
export { MarkdownRenderer } from './components/MarkdownRenderer';
export { CodeBlock } from './components/CodeBlock';
export { ThinkingBlock } from './components/ThinkingBlock';
export { MessageActions } from './components/MessageActions';
export { Shimmer } from './components/Shimmer';

// Theme
export { THEME_DEFAULTS, LOGOS } from './theme';

// Utilities
export { groupModelsByProvider, providerTitle, UNKNOWN_PROVIDER_KEY } from './utils';
export { renderSafeMarkdown } from './safeMarkdown';
export type { ModelGroup } from './utils';
