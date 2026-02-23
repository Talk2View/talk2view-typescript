/**
 * useT2VChat — React hook for chat interactions with streaming and auto tool handling.
 */

import { useCallback, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage } from '../types';
import { useT2V } from './T2VProvider';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface UseT2VChatResult {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: string | null;
  threadId: string | null;
  agentStatus: { status: string; message: string } | null;
  todos: string;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
}

let messageIdCounter = 0;
function nextId(): string {
  return `msg_${++messageIdCounter}_${Date.now()}`;
}

export function useT2VChat(options?: { systemPrompt?: string }): UseT2VChatResult {
  const { t2v } = useT2V();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<{ status: string; message: string } | null>(null);
  const [todos, setTodos] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);
      setIsLoading(true);

      // Add user message
      const userMsg: DisplayMessage = {
        id: nextId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const assistantId = nextId();
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Build conversation history for context
      const history: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let fullContent = '';

      try {
        for await (const event of t2v.chat(content, {
          systemPrompt: options?.systemPrompt,
          history,
        })) {
          switch (event.type) {
            case 'text':
              fullContent += event.content;
              setAgentStatus(null); // Agent is now responding
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullContent } : m,
                ),
              );
              break;

            case 'status':
              setAgentStatus({ status: event.status, message: event.message });
              break;

            case 'todos':
              setTodos(event.todos);
              break;

            case 'done':
              setThreadId(event.threadId);
              break;

            case 'error':
              setError(event.message);
              break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred';
        setError(message);
      } finally {
        // Mark streaming as done
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
        setAgentStatus(null);
        setIsLoading(false);
      }
    },
    [t2v, messages, options?.systemPrompt],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setError(null);
    setTodos('');
    setAgentStatus(null);
    // Tell the SDK to drop the current session so the next message creates a fresh one
    t2v.clearSession();
  }, [t2v]);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    isLoading,
    error,
    threadId,
    agentStatus,
    todos,
    sendMessage,
    clearMessages,
    clearError,
  };
}
