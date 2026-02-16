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
export { ChatMessage } from './ChatMessage';
export { ChatInput } from './ChatInput';

export type { T2VProviderProps } from './T2VProvider';
export type { UseT2VAuthResult } from './useT2VAuth';
export type { UseT2VChatResult, DisplayMessage } from './useT2VChat';
export type { UseT2VToolsResult } from './useT2VTools';
export type { LoginModalProps } from './LoginModal';
export type { ChatPanelProps } from './ChatPanel';
export type { ChatMessageProps } from './ChatMessage';
export type { ChatInputProps } from './ChatInput';
