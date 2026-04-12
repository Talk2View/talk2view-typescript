/**
 * useT2VChat — thin React wrapper that syncs Talk2View state into React state.
 *
 * All state management and streaming logic lives in the Talk2View class.
 * This hook subscribes to its events and re-exports the result as React state.
 */

import { useState, useEffect, useCallback } from 'react';
import { useT2V } from './T2VProvider';
import type { DisplayMessage, ToolStep, PendingApproval, HumanDecision, AgentStatus } from '../types';

export type { PendingApproval } from '../types';
export type { DisplayMessage, ToolStep } from '../types';

export interface UseT2VChatResult {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: string | null;
  threadId: string | null;
  /** Agent status uses `status` field for backwards compatibility (maps from AgentStatus.type). */
  agentStatus: { status: string; message: string } | null;
  pendingApproval: PendingApproval | null;
  /** Tools that are auto-approved for the remainder of the session. */
  alwaysAllowedTools: ReadonlySet<string>;
  sendMessage: (content: string) => Promise<void>;
  approveToolCall: (decision: HumanDecision) => Promise<void>;
  /** Retry the last failed message. Only available when error is set. */
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
}

/** Map AgentStatus (with `type` field) to the hook's public shape (with `status` field). */
function toHookStatus(s: AgentStatus | null): { status: string; message: string } | null {
  if (!s) return null;
  return { status: s.type, message: s.message };
}

export function useT2VChat(options?: { systemPrompt?: string; model?: string }): UseT2VChatResult {
  const { t2v } = useT2V();

  const [messages, setMessages] = useState<DisplayMessage[]>(t2v.messages);
  const [isLoading, setIsLoading] = useState(t2v.isLoading);
  const [error, setError] = useState<string | null>(t2v.error);
  const [threadId, setThreadId] = useState<string | null>(t2v.threadId);
  const [agentStatus, setAgentStatus] = useState<{ status: string; message: string } | null>(
    toHookStatus(t2v.agentStatus),
  );
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(t2v.pendingApproval);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<ReadonlySet<string>>(t2v.alwaysAllowedTools);

  useEffect(() => {
    const unsubs = [
      t2v.on('messagesChange', setMessages),
      t2v.on('loadingChange', setIsLoading),
      t2v.on('errorChange', setError),
      t2v.on('threadIdChange', setThreadId),
      t2v.on('statusChange', (s) => setAgentStatus(toHookStatus(s))),
      t2v.on('approvalChange', setPendingApproval),
      t2v.on('alwaysAllowedChange', setAlwaysAllowedTools),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [t2v]);

  const sendMessage = useCallback(
    (content: string) => t2v.sendMessage(content, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t2v, options?.systemPrompt, options?.model],
  );

  const approveToolCall = useCallback(
    (decision: HumanDecision) => t2v.approveToolCall(decision),
    [t2v],
  );

  const retryLastMessage = useCallback(() => t2v.retryLastMessage(), [t2v]);
  const clearMessages = useCallback(() => t2v.clearMessages(), [t2v]);
  const clearError = useCallback(() => t2v.clearError(), [t2v]);

  return {
    messages,
    isLoading,
    error,
    threadId,
    agentStatus,
    pendingApproval,
    alwaysAllowedTools,
    sendMessage,
    approveToolCall,
    retryLastMessage,
    clearMessages,
    clearError,
  };
}
