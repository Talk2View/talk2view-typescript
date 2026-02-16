/**
 * LoginModal — pre-built login/signup form.
 */

import React, { useCallback, useState } from 'react';
import { useT2VAuth } from './useT2VAuth';
import { T2V_COLORS, T2V_FONTS, T2VLogo, injectT2VFonts, injectT2VStyles } from './theme';

export interface LoginModalProps {
  signupUrl?: string;
  className?: string;
  onSuccess?: () => void;
}

export function LoginModal({
  signupUrl = 'https://talk2view.com/auth?signup',
  className = '',
  onSuccess,
}: LoginModalProps) {
  const { login, isLoading, error, clearError, isAuthenticated } = useT2VAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const [linkHover, setLinkHover] = useState(false);

  // Inject fonts and keyframes (idempotent)
  React.useEffect(() => {
    injectT2VFonts();
    injectT2VStyles();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await login(email, password);
        onSuccess?.();
      } catch {
        // Error is set by useT2VAuth
      }
    },
    [email, password, login, onSuccess],
  );

  if (isAuthenticated) return null;

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1.5px solid ${focused ? T2V_COLORS.turquoise : T2V_COLORS.lightGray}`,
    fontSize: '14px',
    fontFamily: T2V_FONTS.body,
    outline: 'none',
    boxSizing: 'border-box',
    color: T2V_COLORS.dark,
    backgroundColor: '#ffffff',
    boxShadow: focused ? '0 0 0 3px rgba(64, 212, 182, 0.15)' : 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  });

  return (
    <div
      className={`t2v-login-modal ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        padding: '40px 32px',
        maxWidth: '360px',
        margin: '0 auto',
        fontFamily: T2V_FONTS.body,
      }}
    >
      <T2VLogo size={64} />

      <h2
        style={{
          fontSize: '22px',
          fontWeight: 600,
          fontFamily: T2V_FONTS.heading,
          marginTop: '16px',
          marginBottom: '4px',
          color: T2V_COLORS.dark,
        }}
      >
        Welcome back
      </h2>
      <p
        style={{
          fontSize: '14px',
          color: T2V_COLORS.midGray,
          fontFamily: T2V_FONTS.heading,
          marginTop: '0',
          marginBottom: '28px',
        }}
      >
        Sign in to Talk2View
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="t2v-email"
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: T2V_FONTS.heading,
              marginBottom: '6px',
              color: T2V_COLORS.dark,
            }}
          >
            Email
          </label>
          <input
            id="t2v-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError(); }}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            placeholder="you@example.com"
            required
            disabled={isLoading}
            style={inputStyle(emailFocused)}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label
            htmlFor="t2v-password"
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: T2V_FONTS.heading,
              marginBottom: '6px',
              color: T2V_COLORS.dark,
            }}
          >
            Password
          </label>
          <input
            id="t2v-password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); clearError(); }}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            placeholder="Password"
            required
            disabled={isLoading}
            style={inputStyle(passwordFocused)}
          />
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              backgroundColor: T2V_COLORS.errorBg,
              color: T2V_COLORS.errorRed,
              fontSize: '13px',
              fontFamily: T2V_FONTS.heading,
              marginBottom: '16px',
              borderLeft: `3px solid ${T2V_COLORS.errorRed}`,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{
            width: '100%',
            padding: '11px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: isLoading
              ? T2V_COLORS.lightGray
              : btnHover
                ? T2V_COLORS.stormyTeal
                : T2V_COLORS.accent,
            color: isLoading ? T2V_COLORS.midGray : T2V_COLORS.dark,
            fontSize: '15px',
            fontWeight: 600,
            fontFamily: T2V_FONTS.heading,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.15s ease, transform 0.15s ease',
            transform: !isLoading && btnHover ? 'translateY(-1px)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {isLoading && (
            <span
              style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                border: `2px solid ${T2V_COLORS.midGray}`,
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 't2v-spin 0.6s linear infinite',
              }}
            />
          )}
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p
        style={{
          marginTop: '20px',
          fontSize: '13px',
          fontFamily: T2V_FONTS.heading,
          color: T2V_COLORS.midGray,
        }}
      >
        Don&apos;t have an account?{' '}
        <a
          href={signupUrl}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setLinkHover(true)}
          onMouseLeave={() => setLinkHover(false)}
          style={{
            color: linkHover ? T2V_COLORS.stormyTeal : T2V_COLORS.turquoise,
            fontWeight: 500,
            textDecoration: linkHover ? 'underline' : 'none',
            transition: 'color 0.15s ease',
          }}
        >
          Sign up
        </a>
      </p>
    </div>
  );
}
