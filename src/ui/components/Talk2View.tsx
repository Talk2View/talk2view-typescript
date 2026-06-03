import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { T2VProvider, useT2V } from '../../react/T2VProvider';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';
import { Talk2ViewContext, ChatContext } from '../context';
import { injectTheme, injectFonts } from '../theme';
import { injectComponentStyles } from '../styles';
import type { Talk2ViewTheme, DisplayMessage, PendingApproval, HumanDecision, ClientTool, ClientToolSchema } from '../../types';

export interface Talk2ViewProps {
  partnerKey: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  tools?: (ClientToolSchema | ClientTool)[];
  theme?: Talk2ViewTheme;
  /** Enable debug logging to the browser console. */
  debug?: boolean;
  children: React.ReactNode;
}

/**
 * Root provider for Talk2View UI components.
 *
 * Wraps the internal T2VProvider (so hooks like usePartnerConfig, useUserPreferences work)
 * and adds the new Talk2ViewContext + ChatContext for the rebuilt UI layer.
 */
export function Talk2View({ partnerKey, baseUrl, model, systemPrompt, tools, theme, debug, children }: Talk2ViewProps) {
  return (
    <T2VProvider partnerKey={partnerKey} baseUrl={baseUrl} model={model} debug={debug}>
      <InnerProvider systemPrompt={systemPrompt} tools={tools} theme={theme}>
        {children}
      </InnerProvider>
    </T2VProvider>
  );
}

function InnerProvider({
  systemPrompt,
  tools,
  theme,
  children,
}: {
  systemPrompt?: string;
  tools?: (ClientToolSchema | ClientTool)[];
  theme?: Talk2ViewTheme;
  children: React.ReactNode;
}) {
  // Get the t2v instance from T2VProvider (single source of truth)
  const { t2v, user, isAuthenticated } = useT2V();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();

  // Resolve model: user preference > Talk2View prop > partner config default
  const resolvedModel = preferences.model || t2v.config.model || partnerConfig?.default_llm_model || undefined;

  // Inject theme + fonts + component styles
  useEffect(() => {
    injectTheme(theme ?? {});
    injectFonts();
    injectComponentStyles();
  }, [theme]);

  // Register tools
  useEffect(() => {
    if (!tools || tools.length === 0) return;
    const schemas = tools.map((tool) => {
      const { execute: _execute, ...schema } = tool as ClientTool;
      return schema as ClientToolSchema;
    });
    t2v.tools.register(schemas).catch(() => {});
    for (const tool of tools) {
      if ('execute' in tool && tool.execute) {
        t2v.tools.handle(tool.name, tool.execute);
      }
    }
  }, [t2v, tools]);

  // Chat state synced from Talk2View events
  const [messages, setMessages] = useState<DisplayMessage[]>(t2v.messages);
  const [isLoading, setIsLoading] = useState(t2v.isLoading);
  const [error, setError] = useState<string | null>(t2v.error);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(t2v.pendingApproval);
  const [agentStatus, setAgentStatus] = useState<{ status: string; message: string } | null>(null);
  const [threadId, setThreadId] = useState<string | null>(t2v.threadId);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<ReadonlySet<string>>(t2v.alwaysAllowedTools);
  const [isAnonymous, setIsAnonymous] = useState(() => t2v.auth.isAnonymous());
  const [demoLimitReached, setDemoLimitReached] = useState(false);

  useEffect(() => {
    const unsubs = [
      t2v.on('messagesChange', setMessages),
      t2v.on('loadingChange', setIsLoading),
      t2v.on('errorChange', setError),
      t2v.on('approvalChange', setPendingApproval),
      t2v.on('statusChange', (s) => setAgentStatus(s ? { status: s.type, message: s.message } : null)),
      t2v.on('threadIdChange', setThreadId),
      t2v.on('alwaysAllowedChange', setAlwaysAllowedTools),
      t2v.on('demoLimitReached', () => setDemoLimitReached(true)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [t2v]);

  // Recompute anonymity whenever auth changes. Once the user becomes a
  // non-anonymous authenticated account (e.g. after converting), clear the
  // demo-limit gate so the chat resumes.
  useEffect(() => {
    const anon = t2v.auth.isAnonymous();
    setIsAnonymous(anon);
    if (user !== null && !anon) setDemoLimitReached(false);
  }, [t2v, user]);

  const sendMessage = useCallback(
    (content: string) => t2v.sendMessage(content, { systemPrompt, model: resolvedModel }),
    [t2v, systemPrompt, resolvedModel],
  );
  const approveToolCall = useCallback((d: HumanDecision) => t2v.approveToolCall(d), [t2v]);
  const retryLastMessage = useCallback(() => t2v.retryLastMessage(), [t2v]);
  const stop = useCallback(() => t2v.stop(), [t2v]);
  const clearMessages = useCallback(() => t2v.clearMessages(), [t2v]);
  const clearError = useCallback(() => t2v.clearError(), [t2v]);

  const t2vValue = useMemo(
    () => ({ t2v, user, isAuthenticated, isAnonymous, demoLimitReached }),
    [t2v, user, isAuthenticated, isAnonymous, demoLimitReached],
  );
  const chatValue = useMemo(() => ({
    messages, isLoading, error, pendingApproval, agentStatus, threadId, alwaysAllowedTools,
    sendMessage, approveToolCall, retryLastMessage, stop, clearMessages, clearError,
  }), [messages, isLoading, error, pendingApproval, agentStatus, threadId, alwaysAllowedTools,
    sendMessage, approveToolCall, retryLastMessage, stop, clearMessages, clearError]);

  return (
    <Talk2ViewContext.Provider value={t2vValue}>
      <ChatContext.Provider value={chatValue}>
        <div data-talk2view="" style={{ fontFamily: 'var(--t2v-font)', color: 'var(--t2v-foreground)' }}>
          {children}
        </div>
      </ChatContext.Provider>
    </Talk2ViewContext.Provider>
  );
}
