/**
 * T2VProvider — React context provider for Talk2View SDK.
 *
 * Wraps your app and provides the Talk2View client instance to all child components
 * via React context. Manages auth state and provides hooks.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Talk2View } from '../index.js';
import type { T2VConfig, User } from '../types.js';

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
  // React invokes this factory TWICE per mount under StrictMode — the default in
  // Vite, CRA and Next.js — and keeps only one of the two clients. The other is
  // unreachable from the effect below and could never take its window listeners
  // off again, so every client built here starts asleep and the effect wakes the
  // survivor. Auth events only matter to a mounted provider, and the gap between
  // render and effect is one commit long.
  const t2v = useMemo(() => {
    const made = new Talk2View(config);
    made.auth.destroy();
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.partnerKey, config.baseUrl, config.model, config.debug]);
  const [user, setUser] = useState<User | null>(() => t2v.auth.getUser());

  useEffect(() => {
    // Setup wakes it, cleanup puts it back to sleep, both ways round and any
    // number of times: StrictMode runs this as setup → cleanup → setup, and a
    // cleanup that only tore listeners off would leave the surviving client deaf
    // to cross-tab sign-out and to `clearAuth()` for the rest of the session.
    t2v.auth.listen();
    const unsubscribe = t2v.auth.onAuthStateChange((newUser) => {
      setUser(newUser);
    });
    // On unmount — or whenever `t2v` is re-created (config change) — drop the
    // subscription AND dispose the old instance so its window listeners don't leak.
    return () => {
      unsubscribe();
      t2v.destroy();
    };
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
