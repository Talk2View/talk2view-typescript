/**
 * useT2VChat — React hook for chat interactions with streaming, auto tool handling,
 * and human-in-the-loop approval support.
 *
 * Permission model (aligned with Claude Agent SDK):
 * - Allow Once: execute this tool call
 * - Allow Always: execute and auto-approve future calls to this tool for the session
 * - Deny: reject with optional corrective feedback
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage, HumanDecision, PendingApproval } from '../types';
import { useT2V } from './T2VProvider';

export type { PendingApproval } from '../types';

export interface ToolStep {
  name: string;
  status: 'used' | 'denied';
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  /** Markdown checklist from the agent's planning tool (write_todos). */
  plan?: string;
  /** Completed tool call steps (rendered as Chainlit-style inline steps). */
  steps?: ToolStep[];
}

export interface UseT2VChatResult {
  messages: DisplayMessage[];
  isLoading: boolean;
  error: string | null;
  threadId: string | null;
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

let messageIdCounter = 0;
function nextId(): string {
  return `msg_${++messageIdCounter}_${Date.now()}`;
}


export function useT2VChat(options?: { systemPrompt?: string; model?: string }): UseT2VChatResult {
  const { t2v } = useT2V();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<{ status: string; message: string } | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<ReadonlySet<string>>(new Set());
  const messagesRef = useRef<DisplayMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Ref to track the current assistant message ID for approval continuation
  const activeAssistantIdRef = useRef<string | null>(null);

  // Session-scoped set of tools that are auto-approved
  const alwaysAllowedRef = useRef<Set<string>>(new Set());

  // Queue for auto-approvals (set inside consumeStream, consumed by drainStream)
  const pendingAutoApprovalRef = useRef<PendingApproval | null>(null);

  // Track last user message for retry
  const lastUserMessageRef = useRef<string | null>(null);

  /** Mark the current stream as finished (no pending approval). */
  const finalizeStream = useCallback((assistantId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, isStreaming: false } : m,
      ),
    );
    setAgentStatus(null);
    setIsLoading(false);
  }, []);

  /**
   * Consume a ChatEvent stream and update state.
   * Returns true if the stream paused for approval, false if it completed.
   */
  const consumeStream = useCallback(
    async (stream: AsyncGenerator<ChatEvent>, assistantId: string): Promise<boolean> => {
      let fullContent = '';
      // Read current content from the message (may already have content from prior stream)
      const existing = messagesRef.current.find((m) => m.id === assistantId);
      if (existing) fullContent = existing.content;

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            fullContent += event.content;
            setAgentStatus(null);
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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, plan: event.content } : m,
              ),
            );
            break;

          case 'approval_required': {
            const info: PendingApproval = {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              arguments: event.arguments,
              description: event.description,
            };

            if (alwaysAllowedRef.current.has(event.toolName)) {
              // Auto-approve: queue for drainStream to handle
              pendingAutoApprovalRef.current = info;
            } else {
              // Manual approval: show the card
              setPendingApproval(info);
            }
            return true; // Stream paused — either auto or manual approval needed
          }

          case 'tool_call':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, steps: [...(m.steps ?? []), { name: event.toolName, status: 'used' as const }] }
                  : m,
              ),
            );
            break;

          case 'approval_result': {
            const step: ToolStep = {
              name: event.toolName,
              status: event.decision === 'deny' ? 'denied' : 'used',
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, steps: [...(m.steps ?? []), step] }
                  : m,
              ),
            );
            setPendingApproval(null);
            setAgentStatus({
              status: 'resuming',
              message: `Tool ${event.decision === 'deny' ? 'denied' : 'approved'}, continuing...`,
            });
            break;
          }

          case 'done':
            setThreadId(event.threadId);
            break;

          case 'error':
            setError(event.message);
            break;
        }
      }

      return false; // Stream completed normally
    },
    [],
  );

  /**
   * Process a stream with auto-approval loop.
   * Automatically approves tool calls for always-allowed tools without showing the card.
   */
  const drainStream = useCallback(
    async (stream: AsyncGenerator<ChatEvent>, assistantId: string) => {
      while (true) {
        const paused = await consumeStream(stream, assistantId);
        if (!paused) {
          finalizeStream(assistantId);
          return;
        }

        // Check if this is an auto-approval (always-allowed tool)
        const auto = pendingAutoApprovalRef.current;
        if (!auto) return; // Manual approval needed — wait for user

        pendingAutoApprovalRef.current = null;
        setAgentStatus({ status: 'auto-approved', message: `Auto-approved ${auto.toolName}` });

        // Resume with auto-approve and continue the loop
        stream = t2v.respondToApproval(auto, { action: 'once' });
      }
    },
    [consumeStream, finalizeStream, t2v],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      setError(null);
      setIsLoading(true);
      setPendingApproval(null);
      lastUserMessageRef.current = content;

      const userMsg: DisplayMessage = {
        id: nextId(),
        role: 'user',
        content,
        timestamp: new Date(),
      };

      const assistantId = nextId();
      activeAssistantIdRef.current = assistantId;
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const history: ChatMessage[] = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        await drainStream(
          t2v.chat(content, { systemPrompt: options?.systemPrompt, model: options?.model, history }),
          assistantId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred';
        setError(message);
        finalizeStream(assistantId);
      }
    },
    [t2v, options?.systemPrompt, options?.model, drainStream, finalizeStream],
  );

  const approveToolCall = useCallback(
    async (decision: HumanDecision) => {
      const approval = pendingApproval;
      if (!approval) return;

      const assistantId = activeAssistantIdRef.current;
      if (!assistantId) return;

      // Handle "always" — remember for future calls in this session
      if (decision.action === 'always') {
        alwaysAllowedRef.current.add(approval.toolName);
        setAlwaysAllowedTools(new Set(alwaysAllowedRef.current));
      }

      setPendingApproval(null);
      setIsLoading(true);

      try {
        await drainStream(
          t2v.respondToApproval(approval, decision),
          assistantId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred';
        setError(message);
        finalizeStream(assistantId);
      }
    },
    [t2v, drainStream, finalizeStream, pendingApproval],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setThreadId(null);
    setError(null);
    setAgentStatus(null);
    setPendingApproval(null);
    alwaysAllowedRef.current.clear();
    setAlwaysAllowedTools(new Set());
    activeAssistantIdRef.current = null;
    t2v.clearSession();
  }, [t2v]);

  const retryLastMessage = useCallback(async () => {
    const lastMsg = lastUserMessageRef.current;
    if (!lastMsg) return;
    // Remove the failed assistant message + user message
    setMessages((prev) => {
      const copy = [...prev];
      // Remove trailing assistant (empty/error) and user message
      while (copy.length > 0) {
        const last = copy[copy.length - 1]!;
        if (last.role === 'assistant' && !last.content) {
          copy.pop();
        } else if (last.role === 'user' && last.content === lastMsg) {
          copy.pop();
          break;
        } else {
          break;
        }
      }
      return copy;
    });
    setError(null);
    await sendMessage(lastMsg);
  }, [sendMessage]);

  const clearError = useCallback(() => setError(null), []);

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
