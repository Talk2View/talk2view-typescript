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
}

export function ChatPanel({ welcome, signupUrl }: ChatPanelProps) {
  const { isAuthenticated, t2v } = useTalk2View();
  const { messages, clearMessages, error, clearError } = useChat();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const fontSize = FONT_SCALE[preferences.fontSize ?? 'medium'] ?? 0.875;
  const modelId = preferences.model || t2v.config.model || partnerConfig?.default_llm_model || '';
  const modelDisplay = modelId.replace(/^openrouter\//, '');

  useEffect(() => { if (!isAuthenticated) setView('chat'); }, [isAuthenticated]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--t2v-bg)', fontSize: `${fontSize}rem`, fontFamily: 'var(--t2v-font)',
    }}>
      {isAuthenticated && (
        <ChatHeader view={view}
          onSettingsClick={() => setView('settings')}
          onBackClick={() => setView('chat')}
          onNewChat={() => clearMessages()}
          onSignOut={() => t2v.auth.logout()}
        />
      )}
      {!isAuthenticated ? (
        <LoginForm signupUrl={signupUrl} />
      ) : view === 'settings' ? (
        <div style={{ flex: 1, overflow: 'auto' }}><SettingsPanel hideHeader /></div>
      ) : messages.length === 0 ? (
        <WelcomeScreen heading={welcome?.heading} suggestions={welcome?.suggestions} />
      ) : (
        <MessageList />
      )}
      {isAuthenticated && view === 'chat' && error && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            margin: '0 12px 8px', padding: '8px 12px',
            background: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.15)',
            borderRadius: '6px',
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
      {isAuthenticated && view === 'chat' && modelDisplay && (
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
      {isAuthenticated && view === 'chat' && <Composer />}
    </div>
  );
}
