import React, { useState } from 'react';
import { useT2VAuth } from '../../react/useT2VAuth';
import { LOGOS } from '../theme';

export interface LoginFormProps {
  signupUrl?: string;
  heading?: string;
  subheading?: string;
  defaultMode?: 'login' | 'signup';
  /** URL of a page where the user can reset their password. When set, a
   *  "Forgot password?" link is shown in login mode. */
  resetPasswordUrl?: string;
  /** Where the reset-password link opens. Defaults to '_blank' (new tab);
   *  pass '_self' when the URL is a page in your own app. */
  resetPasswordTarget?: '_self' | '_blank';
  /** URL of the Terms of Use shown in the consent line under the Google button. */
  termsUrl?: string;
  /** URL of the Privacy Policy shown in the consent line under the Google button. */
  privacyUrl?: string;
}

export function LoginForm({
  signupUrl,
  heading,
  subheading,
  defaultMode,
  resetPasswordUrl,
  resetPasswordTarget = '_blank',
  termsUrl = 'https://talk2view.com/legal/terms-of-use',
  privacyUrl = 'https://talk2view.com/legal/privacy-policy',
}: LoginFormProps) {
  const { login, signup, isLoading, error, clearError, signInWithGoogle, oauthLoading } = useT2VAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode ?? 'login');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || isLoading) return;
    try {
      if (mode === 'signup') {
        await signup(email, password);
      } else {
        await login(email, password);
      }
    } catch {
      // useT2VAuth already surfaces the message via the `error` state; swallow
      // the rejection here so the dev overlay doesn't flag it as uncaught.
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid var(--t2v-border)', borderRadius: 'var(--t2v-radius-sm)',
    fontFamily: 'var(--t2v-font)', fontSize: '14px',
    background: 'var(--t2v-bg)', color: 'var(--t2v-foreground)',
    outline: 'none', transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: '20px' }}>
      <img src={LOGOS.icon} alt="Talk2View" style={{ width: 36, height: 36 }} />
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, fontFamily: 'var(--t2v-font)' }}>{heading ?? 'Sign in to Talk2View'}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--t2v-muted)' }}>{subheading ?? 'Enter your credentials to continue'}</p>
      </div>
      {error && (
        <div style={{ width: '100%', maxWidth: '280px', padding: '8px 12px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: '6px', fontSize: '12px', color: 'var(--t2v-error)' }}>
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={() => { clearError(); void signInWithGoogle().catch(() => {}); }}
        disabled={oauthLoading || isLoading}
        className="t2v-btn"
        style={{
          width: '100%', maxWidth: 280, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8, padding: '10px',
          border: '1.5px solid var(--t2v-border)', borderRadius: 'var(--t2v-radius-sm)',
          background: 'var(--t2v-bg)', color: 'var(--t2v-foreground)',
          fontFamily: 'var(--t2v-font)', fontSize: 14, fontWeight: 500,
          cursor: oauthLoading ? 'wait' : 'pointer', opacity: oauthLoading ? 0.6 : 1,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        {oauthLoading ? 'Opening…' : 'Continue with Google'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 280 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--t2v-border)' }} />
        <span style={{ fontSize: 12, color: 'var(--t2v-muted)' }}>or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--t2v-border)' }} />
      </div>
      <p style={{ fontSize: 11, color: 'var(--t2v-muted)', maxWidth: 280, textAlign: 'center' }}>
        By continuing you agree to the{' '}
        <a href={termsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--t2v-accent)' }}>Terms</a>{' '}
        and{' '}
        <a href={privacyUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--t2v-accent)' }}>Privacy Policy</a>.
      </p>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'var(--t2v-font)', color: 'var(--t2v-foreground)' }}>Email</span>
          <input id="t2v-email" type="email" placeholder="Email" value={email} onChange={(e) => { setEmail(e.target.value); clearError(); }} className="t2v-focusable" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'var(--t2v-font)', color: 'var(--t2v-foreground)' }}>Password</span>
          <input id="t2v-password" type="password" placeholder="Password" value={password} onChange={(e) => { setPassword(e.target.value); clearError(); }} className="t2v-focusable" style={inputStyle} />
        </label>
        <button type="submit" disabled={!email || !password || isLoading} className="t2v-btn" style={{
          width: '100%', padding: '10px', border: 'none', borderRadius: 'var(--t2v-radius-sm)',
          background: 'var(--t2v-accent)', color: 'var(--t2v-accent-foreground)',
          fontFamily: 'var(--t2v-font)', fontSize: '14px', fontWeight: 500,
          cursor: isLoading ? 'wait' : 'pointer', opacity: (!email || !password || isLoading) ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}>
          {mode === 'signup'
            ? (isLoading ? 'Creating account…' : 'Create account')
            : (isLoading ? 'Signing in...' : 'Sign in')}
        </button>
      </form>
      {mode === 'login' && resetPasswordUrl && (
        <a
          href={resetPasswordUrl}
          target={resetPasswordTarget}
          rel={resetPasswordTarget === '_blank' ? 'noopener noreferrer' : undefined}
          style={{ fontSize: '12px', color: 'var(--t2v-accent)', textDecoration: 'underline' }}
        >
          Forgot password?
        </a>
      )}
      <p style={{ fontSize: '12px', color: 'var(--t2v-muted)' }}>
        {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
        <button
          type="button"
          onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); clearError(); }}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--t2v-accent)', textDecoration: 'underline',
            fontFamily: 'var(--t2v-font)', fontSize: '12px',
          }}
        >
          {mode === 'signup' ? 'Sign in' : 'Create an account'}
        </button>
      </p>
      {signupUrl && mode === 'login' && (
        <p style={{ fontSize: '12px', color: 'var(--t2v-muted)' }}>
          Don't have an account?{' '}
          <a href={signupUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--t2v-accent)', textDecoration: 'underline' }}>Sign up</a>
        </p>
      )}
    </div>
  );
}
