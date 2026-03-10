/**
 * usePartnerConfig — fetches and caches partner-level configuration defaults.
 *
 * Fetches once when authenticated. Returns null while loading.
 * Partner config provides the baseline defaults; user preferences (from
 * useUserPreferences) take priority when set.
 */

import { useEffect, useState } from 'react';
import type { PartnerConfig } from '../types';
import { useT2V } from './T2VProvider';

export interface UsePartnerConfigResult {
  config: PartnerConfig | null;
  isLoading: boolean;
  error: string | null;
}

export function usePartnerConfig(): UsePartnerConfigResult {
  const { t2v, isAuthenticated } = useT2V();
  const [config, setConfig] = useState<PartnerConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setConfig(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    t2v
      .getConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err) => {
        console.error('Failed to fetch partner config:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t2v, isAuthenticated]);

  return { config, isLoading, error };
}
