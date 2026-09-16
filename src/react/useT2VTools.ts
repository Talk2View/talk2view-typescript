/**
 * useT2VTools — React hook for tool registration.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ClientTool, ClientToolSchema, RegisterToolsResponse } from '../types.js';
import { useT2V } from './T2VProvider.js';

export interface UseT2VToolsResult {
  registerTools: (tools: (ClientToolSchema | ClientTool)[]) => Promise<RegisterToolsResponse>;
  registeredTools: string[];
  isRegistered: boolean;
}

export function useT2VTools(): UseT2VToolsResult {
  const { t2v, isAuthenticated } = useT2V();
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);

  const registerTools = useCallback(
    async (tools: (ClientToolSchema | ClientTool)[]) => {
      const response = await t2v.tools.register(tools);
      setRegisteredTools(response.registered);
      return response;
    },
    [t2v],
  );

  // Reset when auth changes
  useEffect(() => {
    if (!isAuthenticated) {
      setRegisteredTools([]);
    }
  }, [isAuthenticated]);

  // Reset when session is cleared (tools are session-scoped on the server)
  useEffect(() => {
    return t2v.onSessionClear(() => {
      setRegisteredTools([]);
    });
  }, [t2v]);

  // Sync state when tools are re-registered on a new session
  useEffect(() => {
    return t2v.onSessionCreate((toolNames) => {
      setRegisteredTools(toolNames);
    });
  }, [t2v]);

  return {
    registerTools,
    registeredTools,
    isRegistered: registeredTools.length > 0,
  };
}
