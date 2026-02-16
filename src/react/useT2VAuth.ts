/**
 * useT2VAuth — React hook for Talk2View authentication.
 */

import { useCallback, useState } from 'react';
import type { User } from '../types';
import { useT2V } from './T2VProvider';

export interface UseT2VAuthResult {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export function useT2VAuth(): UseT2VAuthResult {
  const { t2v, user, isAuthenticated } = useT2V();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await t2v.auth.login(email, password);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [t2v],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await t2v.auth.signup(email, password);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Signup failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [t2v],
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await t2v.auth.logout();
    } finally {
      setIsLoading(false);
    }
  }, [t2v]);

  const clearError = useCallback(() => setError(null), []);

  return { user, isAuthenticated, isLoading, error, login, signup, logout, clearError };
}
