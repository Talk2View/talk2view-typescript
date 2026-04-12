import React, { useState, useEffect } from 'react';
import { useTalk2View, useChat } from '../context';
import { ChatHeader } from './ChatHeader';
import { LoginForm } from './LoginForm';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { WelcomeScreen } from './WelcomeScreen';
import { SettingsPanel } from './SettingsPanel';
import { useUserPreferences } from '../../react/useUserPreferences';

const FONT_SCALE: Record<string, number> = { small: 0.75, medium: 0.875, large: 1 };

export interface ChatPanelProps {
  welcome?: { heading?: string; suggestions?: string[] };
  signupUrl?: string;
}

export function ChatPanel({ welcome, signupUrl }: ChatPanelProps) {
  const { isAuthenticated, t2v } = useTalk2View();
  const { messages, clearMessages } = useChat();
  const { preferences } = useUserPreferences();
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const fontSize = FONT_SCALE[preferences.fontSize ?? 'medium'] ?? 0.875;

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
      {isAuthenticated && view === 'chat' && <Composer />}
    </div>
  );
}
