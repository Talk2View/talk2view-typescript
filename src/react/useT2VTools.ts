/**
 * useT2VTools — React hook for tool registration.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientTool, ClientToolSchema, RegisterToolsResponse } from '../types';
import { useT2V } from './T2VProvider';

export interface UseT2VToolsResult {
  registerTools: (tools: (ClientToolSchema | ClientTool)[]) => Promise<RegisterToolsResponse>;
  registeredTools: string[];
  isRegistered: boolean;
}

export function useT2VTools(): UseT2VToolsResult {
  const { t2v, isAuthenticated } = useT2V();
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);
  const registeredRef = useRef(false);

  const registerTools = useCallback(
    async (tools: (ClientToolSchema | ClientTool)[]) => {
      const response = await t2v.tools.register(tools);
      setRegisteredTools(response.registered);
      registeredRef.current = true;
      return response;
    },
    [t2v],
  );

  // Reset when auth changes
  useEffect(() => {
    if (!isAuthenticated) {
      setRegisteredTools([]);
      registeredRef.current = false;
    }
  }, [isAuthenticated]);

  return {
    registerTools,
    registeredTools,
    isRegistered: registeredRef.current,
  };
}
