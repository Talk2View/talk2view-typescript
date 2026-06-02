import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTalk2View, useChat } from '../context';
import { ChatHeader } from './ChatHeader';
import { LoginForm } from './LoginForm';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { WelcomeScreen } from './WelcomeScreen';
import { SettingsPanel } from './SettingsPanel';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';

const FONT_SCALE: Record<string, number> = { small: 0.75, medium: 0.875, large: 1 };

export interface ChatPanelProps {
  welcome?: { heading?: string; suggestions?: string[] };
  signupUrl?: string;
  /** Allow logged-out visitors to use the chat via an anonymous demo session. */
  allowAnonymous?: boolean;
}

export function ChatPanel({ welcome, signupUrl, allowAnonymous = true }: ChatPanelProps) {
  const { isAuthenticated, isAnonymous, demoLimitReached, t2v } = useTalk2View();
  const { messages, clearMessages, error, clearError } = useChat();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const [view, setView] = useState<'chat' | 'settings' | 'login'>('chat');
  const fontSize = FONT_SCALE[preferences.fontSize ?? 'medium'] ?? 0.875;
  // Show the model id verbatim (no `openrouter/` stripping) so direct-API models
  // like `anthropic/...` stay unambiguous next to `openrouter/anthropic/...`.
  const modelDisplay = preferences.model || t2v.config.model || partnerConfig?.default_llm_model || '';

  // Show the login gate only when anonymous demos are disallowed for a
  // logged-out visitor, or once an anonymous visitor exhausts the demo budget.
  const showLoginGate = (!isAuthenticated && !allowAnonymous) || demoLimitReached;
  const inChat = !showLoginGate;

  useEffect(() => { if (!isAuthenticated) setView('chat'); }, [isAuthenticated]);
  // Return to chat once the visitor is actually signed in to a real account.
  // Guard on isAuthenticated too: a logged-out visitor (post sign-out) is also
  // !isAnonymous, and without it the login view would close the instant it opens.
  useEffect(() => {
    if (isAuthenticated && !isAnonymous && view === 'login') setView('chat');
  }, [isAuthenticated, isAnonymous, view]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--t2v-bg)', fontSize: `${fontSize}rem`, fontFamily: 'var(--t2v-font)',
    }}>
      {inChat && (
        <ChatHeader view={view}
          isAuthenticated={isAuthenticated}
          isAnonymous={isAnonymous}
          onSettingsClick={() => setView('settings')}
          onSignIn={() => setView('login')}
          onBackClick={() => setView('chat')}
          onNewChat={() => clearMessages()}
          onSignOut={() => t2v.auth.logout()}
        />
      )}
      {showLoginGate ? (
        <LoginForm
          signupUrl={signupUrl}
          heading={demoLimitReached ? 'You’ve reached the demo limit' : undefined}
          subheading={demoLimitReached ? 'Create an account to keep chatting — your conversation is saved.' : undefined}
          defaultMode={demoLimitReached ? 'signup' : 'login'}
        />
      ) : view === 'settings' ? (
        <div style={{ flex: 1, overflow: 'auto' }}><SettingsPanel hideHeader /></div>
      ) : view === 'login' ? (
        <div style={{ flex: 1, overflow: 'auto' }}><LoginForm signupUrl={signupUrl} defaultMode="login" /></div>
      ) : messages.length === 0 ? (
        <WelcomeScreen heading={welcome?.heading} suggestions={welcome?.suggestions} />
      ) : (
        <MessageList />
      )}
      {inChat && view === 'chat' && error && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            margin: '0 12px 8px', padding: '8px 12px',
            background: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.15)',
            borderRadius: 'var(--t2v-radius-sm)',
            fontSize: '12px',
            color: 'var(--t2v-error)',
            fontFamily: 'var(--t2v-font)',
          }}
        >
          <span style={{ flex: 1, lineHeight: 1.4 }}>{error}</span>
          <button
            onClick={clearError}
            aria-label="Dismiss error"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, color: 'var(--t2v-error)', display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {inChat && view === 'chat' && modelDisplay && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '4px 12px',
          fontSize: '10px',
          fontFamily: 'var(--t2v-font-mono)',
          color: 'var(--t2v-muted)',
          letterSpacing: '0.3px',
          borderTop: '1px solid var(--t2v-border)',
        }}>
          {modelDisplay}
        </div>
      )}
      {inChat && view === 'chat' && <Composer />}
    </div>
  );
}
