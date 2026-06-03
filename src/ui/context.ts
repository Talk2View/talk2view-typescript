import { createContext, useContext } from 'react';
import type { Talk2View as Talk2ViewClass } from '../index';
import type { User, DisplayMessage, PendingApproval, HumanDecision } from '../types';

export interface Talk2ViewContextValue {
  t2v: Talk2ViewClass;
  user: User | null;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  demoLimitReached: boolean;
}

export interface ChatContextValue {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: string | null;
  pendingApproval: PendingApproval | null;
  agentStatus: { status: string; message: string } | null;
  threadId: string | null;
  alwaysAllowedTools: ReadonlySet<string>;
  sendMessage: (content: string) => Promise<void>;
  approveToolCall: (decision: HumanDecision) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  /** Stop the in-flight response; the partial text received so far is kept. */
  stop: () => void;
  clearMessages: () => void;
  clearError: () => void;
}

export const Talk2ViewContext = createContext<Talk2ViewContextValue | null>(null);
export const ChatContext = createContext<ChatContextValue | null>(null);

export function useTalk2View(): Talk2ViewContextValue {
  const ctx = useContext(Talk2ViewContext);
  if (!ctx) throw new Error('useTalk2View must be used within <Talk2View>');
  return ctx;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within <Talk2View>');
  return ctx;
}
