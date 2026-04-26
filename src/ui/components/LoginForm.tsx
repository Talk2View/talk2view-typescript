import React, { useState } from 'react';
import { useT2VAuth } from '../../react/useT2VAuth';
import { LOGOS } from '../theme';

export interface LoginFormProps {
  signupUrl?: string;
}

export function LoginForm({ signupUrl }: LoginFormProps) {
  const { login, isLoading, error, clearError } = useT2VAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || isLoading) return;
    try {
      await login(email, password);
    } catch {
      // useT2VAuth already surfaces the message via the `error` state; swallow
      // the rejection here so the dev overlay doesn't flag it as uncaught.
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: '1.5px solid var(--t2v-border)', borderRadius: 'calc(var(--t2v-radius) * 0.5px)',
    fontFamily: 'var(--t2v-font)', fontSize: '14px',
    background: 'var(--t2v-bg)', color: 'var(--t2v-foreground)',
    outline: 'none', transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: '20px' }}>
      <img src={LOGOS.icon} alt="Talk2View" style={{ width: 36, height: 36 }} />
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, fontFamily: 'var(--t2v-font)' }}>Sign in to Talk2View</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--t2v-muted)' }}>Enter your credentials to continue</p>
      </div>
      {error && (
        <div style={{ width: '100%', maxWidth: '280px', padding: '8px 12px', background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: '6px', fontSize: '12px', color: 'var(--t2v-error)' }}>
          {error}
        </div>
      )}
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
          width: '100%', padding: '10px', border: 'none', borderRadius: 'calc(var(--t2v-radius) * 0.5px)',
          background: 'var(--t2v-accent)', color: 'var(--t2v-accent-foreground)',
          fontFamily: 'var(--t2v-font)', fontSize: '14px', fontWeight: 500,
          cursor: isLoading ? 'wait' : 'pointer', opacity: (!email || !password || isLoading) ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {signupUrl && (
        <p style={{ fontSize: '12px', color: 'var(--t2v-muted)' }}>
          Don't have an account?{' '}
          <a href={signupUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--t2v-accent)', textDecoration: 'underline' }}>Sign up</a>
        </p>
      )}
    </div>
  );
}
