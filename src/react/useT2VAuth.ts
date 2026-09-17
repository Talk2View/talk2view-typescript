/**
 * useT2VAuth — React hook for Talk2View authentication.
 */

import { useCallback, useState } from 'react';
import type { SignupOutcome, User } from '../types.js';
import { useT2V } from './T2VProvider.js';

export interface UseT2VAuthResult {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<SignupOutcome>;
  logout: () => Promise<void>;
  clearError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  /** True while any popup sign-in is open. */
  oauthLoading: boolean;
  /** Which popup sign-in is open, so a form can mark the right button. */
  oauthProvider: 'google' | 'apple' | null;
}

export function useT2VAuth(): UseT2VAuthResult {
  const { t2v, user, isAuthenticated } = useT2V();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);

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
        return await t2v.auth.signup(email, password);
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

  const [oauthProvider, setOauthProvider] = useState<'google' | 'apple' | null>(null);

  const signInWithPopup = useCallback(async (provider: 'google' | 'apple') => {
    setOauthLoading(true);
    setOauthProvider(provider);
    setError(null);
    try {
      await (provider === 'apple' ? t2v.auth.signInWithApple() : t2v.auth.signInWithGoogle());
    } catch (err) {
      const fallback = provider === 'apple' ? 'Apple sign-in failed' : 'Google sign-in failed';
      setError(err instanceof Error ? err.message : fallback);
      throw err;
    } finally {
      setOauthLoading(false);
      setOauthProvider(null);
    }
  }, [t2v]);

  const signInWithGoogle = useCallback(() => signInWithPopup('google'), [signInWithPopup]);
  const signInWithApple = useCallback(() => signInWithPopup('apple'), [signInWithPopup]);

  const clearError = useCallback(() => setError(null), []);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    signup,
    logout,
    clearError,
    signInWithGoogle,
    signInWithApple,
    oauthLoading,
    oauthProvider,
  };
}
