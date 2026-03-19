/**
 * T2VLoginGate — Shows LoginModal when unauthenticated, renders children when authenticated.
 *
 * Composable auth gate — use it to wrap T2VThread, T2VAssistantModal,
 * or any section of your app that requires Talk2View authentication.
 *
 * @example
 * ```tsx
 * <T2VAssistantProvider partnerKey="pk_live_abc">
 *   <T2VLoginGate signupUrl="https://myapp.com/signup">
 *     <T2VThread />
 *   </T2VLoginGate>
 * </T2VAssistantProvider>
 * ```
 */

import React from 'react';
import { useT2V } from '../../react/T2VProvider';
import { LoginModal } from './LoginModal';

export interface T2VLoginGateProps {
  children: React.ReactNode;
  /** URL for the "Sign up" link in the login form. */
  signupUrl?: string;
}

export function T2VLoginGate({ children, signupUrl }: T2VLoginGateProps) {
  const { isAuthenticated } = useT2V();

  if (!isAuthenticated) {
    return <LoginModal signupUrl={signupUrl} />;
  }

  return <>{children}</>;
}
