/**
 * T2VProvider — React context provider for Talk2View SDK.
 *
 * Wraps your app and provides the Talk2View client instance to all child components
 * via React context. Manages auth state and provides hooks.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Talk2View } from '../index';
import type { T2VConfig, User } from '../types';

interface T2VContextValue {
  t2v: Talk2View;
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
}

const T2VContext = createContext<T2VContextValue | null>(null);

export interface T2VProviderProps extends T2VConfig {
  children: React.ReactNode;
}

export function T2VProvider({ children, ...config }: T2VProviderProps) {
  const t2v = useMemo(() => new Talk2View(config), [config.partnerKey, config.baseUrl, config.model]);
  const [user, setUser] = useState<User | null>(() => t2v.auth.getUser());

  useEffect(() => {
    const unsubscribe = t2v.auth.onAuthStateChange((newUser) => {
      setUser(newUser);
    });
    return unsubscribe;
  }, [t2v]);

  const value = useMemo(
    () => ({
      t2v,
      user,
      isAuthenticated: user !== null,
      setUser,
    }),
    [t2v, user],
  );

  return <T2VContext.Provider value={value}>{children}</T2VContext.Provider>;
}

/**
 * Hook to access the Talk2View client instance.
 */
export function useT2V(): T2VContextValue {
  const ctx = useContext(T2VContext);
  if (!ctx) {
    throw new Error('useT2V must be used within a <T2VProvider>');
  }
  return ctx;
}
