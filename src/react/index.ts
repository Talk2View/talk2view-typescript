/**
 * React components and hooks for Talk2View SDK.
 *
 * @example
 * ```tsx
 * import { T2VProvider, ChatPanel, LoginModal } from '@talk2view/sdk/react';
 *
 * function App() {
 *   return (
 *     <T2VProvider partnerKey="pk_live_abc123">
 *       <LoginModal />
 *       <ChatPanel tools={myTools} />
 *     </T2VProvider>
 *   );
 * }
 * ```
 */

export { T2VProvider, useT2V } from './T2VProvider';
export { useT2VAuth } from './useT2VAuth';
export { useT2VChat } from './useT2VChat';
export { useT2VTools } from './useT2VTools';
export { LoginModal } from './LoginModal';
export { ChatPanel } from './ChatPanel';
export { ApprovalCard } from './ApprovalCard';
export { ChatMessage } from './ChatMessage';
export { ChatInput } from './ChatInput';
export { SettingsView } from './SettingsView';
export { useUserPreferences } from './useUserPreferences';
export { usePartnerConfig } from './usePartnerConfig';
export { T2V_VARS } from './theme';

export type { T2VProviderProps } from './T2VProvider';
export type { UseT2VAuthResult } from './useT2VAuth';
export type { UseT2VChatResult, DisplayMessage, ToolStep, PendingApproval } from './useT2VChat';
export type { ApprovalCardProps } from './ApprovalCard';
export type { UseT2VToolsResult } from './useT2VTools';
export type { LoginModalProps } from './LoginModal';
export type { ChatPanelProps } from './ChatPanel';
export type { ChatMessageProps } from './ChatMessage';
export type { ChatInputProps } from './ChatInput';
export type { SettingsViewProps } from './SettingsView';
export type { UseUserPreferencesResult } from './useUserPreferences';
export type { UsePartnerConfigResult } from './usePartnerConfig';
