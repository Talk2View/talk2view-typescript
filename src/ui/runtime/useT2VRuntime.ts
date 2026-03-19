/**
 * useT2VRuntime — ExternalStoreRuntime bridge between useT2VChat and assistant-ui.
 *
 * Feeds Talk2View's chat state (messages, streaming, tool approval) into
 * assistant-ui's rendering layer via ExternalStoreRuntime.
 */

import { useMemo } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { useT2VChat } from '../../react/useT2VChat';
import { useT2V } from '../../react/T2VProvider';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';
import { convertDisplayMessage } from './convertMessage';
import { T2VDictationAdapter } from '../components/T2VDictationAdapter';
import type { HumanDecision } from '../../types';

export interface UseT2VRuntimeOptions {
  /** System prompt passed to the Talk2View agent. */
  systemPrompt?: string;
  /** Override the LLM model for this session. */
  model?: string;
}

/**
 * Creates an assistant-ui runtime backed by Talk2View's chat engine.
 *
 * Use this hook when you want full control over rendering with your own
 * assistant-ui components. For pre-styled components, use T2VThread or
 * T2VAssistantModal instead.
 *
 * @example
 * ```tsx
 * import { useT2VRuntime } from '@talk2view/sdk/assistant-ui';
 * import { AssistantRuntimeProvider } from '@assistant-ui/react';
 * import { Thread } from '@assistant-ui/react-ui';
 *
 * function CustomChat() {
 *   const runtime = useT2VRuntime({ systemPrompt: '...' });
 *   return (
 *     <AssistantRuntimeProvider runtime={runtime}>
 *       <Thread />
 *     </AssistantRuntimeProvider>
 *   );
 * }
 * ```
 */
export function useT2VRuntime(options?: UseT2VRuntimeOptions): AssistantRuntime {
  const { t2v } = useT2V();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const chat = useT2VChat({ systemPrompt: options?.systemPrompt, model: options?.model });

  const dictationAdapter = useMemo(() => {
    const sttModel = preferences.sttModel || partnerConfig?.default_stt_model || undefined;
    const sttLanguage = preferences.sttLanguage || undefined;
    return new T2VDictationAdapter(t2v, sttModel, sttLanguage);
  }, [t2v, preferences.sttModel, preferences.sttLanguage, partnerConfig?.default_stt_model]);

  return useExternalStoreRuntime({
    messages: chat.messages,
    isRunning: chat.isLoading && !chat.pendingApproval,

    adapters: {
      dictation: dictationAdapter,
    },

    convertMessage: (msg, idx) => {
      const isLast = idx === chat.messages.length - 1;
      const isLastAssistant = isLast && msg.role === 'assistant';
      return convertDisplayMessage(
        msg,
        isLastAssistant ? chat.pendingApproval : null,
        isLastAssistant ? chat.error : null,
      );
    },

    onNew: async (message) => {
      // Extract text from the AppendMessage content parts
      const parts = message.content as ReadonlyArray<{ type: string; text?: string }>;
      const text = parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text!)
        .join('\n');
      if (text) {
        await chat.sendMessage(text);
      }
    },

    onReload: async () => {
      await chat.retryLastMessage();
    },

    onAddToolResult: async ({ result }) => {
      // result is a HumanDecision encoded by T2VToolFallback's addResult call
      const decision = result as unknown as HumanDecision;
      await chat.approveToolCall(decision);
    },

    onCancel: async () => {
      // No explicit cancel endpoint yet — connection close handles cancellation.
      // This will be wired to POST /v1/sessions/{id}/cancel in a future phase.
    },
  });
}
