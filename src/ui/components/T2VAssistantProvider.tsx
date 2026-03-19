/**
 * T2VAssistantProvider — Combined provider for Talk2View + assistant-ui.
 *
 * Composes:
 *   T2VProvider (auth, client) → tool registration → runtime bridge → AssistantRuntimeProvider
 *
 * Wrap your app (or the chat section) with this provider, then use
 * T2VThread, T2VAssistantModal, or your own assistant-ui components as children.
 *
 * @example
 * ```tsx
 * <T2VAssistantProvider partnerKey="pk_live_abc" tools={myTools}>
 *   <MyExistingApp />
 *   <T2VThread />
 * </T2VAssistantProvider>
 * ```
 */

import React, { createContext, useContext } from 'react';
import '@assistant-ui/react-ui/styles/index.css';
import '@assistant-ui/react-ui/styles/modal.css';
import '@assistant-ui/react-ui/styles/markdown.css';
import '@assistant-ui/react-ui/styles/themes/default.css';
import { AssistantRuntimeProvider } from '@assistant-ui/react';

const T2VChatActionsContext = createContext<{ clearMessages: () => void }>({
  clearMessages: () => {},
});

/** Hook to access chat actions (e.g. clearMessages for "New chat"). */
export function useT2VChatActions() {
  return useContext(T2VChatActionsContext);
}
import { T2VProvider, useT2V } from '../../react/T2VProvider';
import { useT2VTools } from '../../react/useT2VTools';
import { useT2VRuntime } from '../runtime/useT2VRuntime';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';
import { injectT2VFonts, injectT2VStyles } from '../../react/theme';
import type { ClientTool, ClientToolSchema } from '../../types';

export interface T2VAssistantProviderProps {
  /** Talk2View partner API key. */
  partnerKey: string;
  /** Talk2View API base URL. Defaults to production. */
  baseUrl?: string;
  /** Default LLM model ID. */
  model?: string;
  /** System prompt passed to the Talk2View agent. */
  systemPrompt?: string;
  /** Client-side tools to register with the Talk2View agent. */
  tools?: (ClientToolSchema | ClientTool)[];
  children: React.ReactNode;
}

/**
 * Inner provider that lives inside T2VProvider context.
 * Creates the runtime bridge and registers tools.
 */
function InnerProvider({
  systemPrompt,
  tools,
  children,
}: {
  systemPrompt?: string;
  tools?: (ClientToolSchema | ClientTool)[];
  children: React.ReactNode;
}) {
  const { isAuthenticated } = useT2V();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();

  // Resolve the effective model: user preference > partner default > provider prop
  const effectiveModel = preferences.model || partnerConfig?.default_llm_model || undefined;

  const { runtime, clearMessages } = useT2VRuntime({ systemPrompt, model: effectiveModel });
  const { registerTools, isRegistered } = useT2VTools();

  // Inject T2V fonts and CSS animations (idempotent)
  React.useEffect(() => {
    injectT2VFonts();
    injectT2VStyles();
  }, []);

  // Register tools when authenticated and tools are provided
  React.useEffect(() => {
    if (tools && tools.length > 0 && !isRegistered && isAuthenticated) {
      registerTools(tools).catch(console.error);
    }
  }, [tools, isRegistered, isAuthenticated, registerTools]);

  return (
    <T2VChatActionsContext.Provider value={{ clearMessages }}>
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
    </T2VChatActionsContext.Provider>
  );
}

export function T2VAssistantProvider({
  partnerKey,
  baseUrl,
  model,
  systemPrompt,
  tools,
  children,
}: T2VAssistantProviderProps) {
  return (
    <T2VProvider partnerKey={partnerKey} baseUrl={baseUrl} model={model}>
      <InnerProvider systemPrompt={systemPrompt} tools={tools}>
        {children}
      </InnerProvider>
    </T2VProvider>
  );
}
