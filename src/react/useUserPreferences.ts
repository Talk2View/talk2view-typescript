/**
 * useUserPreferences — hook for reading/writing user preferences with localStorage persistence.
 *
 * Uses a custom DOM event to keep multiple hook instances in sync:
 * when any instance writes, all instances re-read from storage.
 */

import { useCallback, useEffect, useState } from 'react';
import { getUserPreferences, setUserPreferences } from '../storage';
import type { UserPreferences } from '../types';

const SYNC_EVENT = 'talk2view_preferences_changed';

function loadPreferences(): UserPreferences {
  try {
    const raw = getUserPreferences();
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data — start fresh
  }
  return {};
}

export interface UseUserPreferencesResult {
  preferences: UserPreferences;
  updatePreferences: (partial: Partial<UserPreferences>) => void;
}

export function useUserPreferences(): UseUserPreferencesResult {
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences);

  // Listen for writes from other hook instances and re-read from storage
  useEffect(() => {
    const handler = () => setPreferences(loadPreferences());
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...partial };
      setUserPreferences(JSON.stringify(next));
      // Notify other hook instances (deferred to avoid setState-during-render)
      queueMicrotask(() => window.dispatchEvent(new Event(SYNC_EVENT)));
      return next;
    });
  }, []);

  return { preferences, updatePreferences };
}
