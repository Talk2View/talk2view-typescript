/**
 * T2VThread — Pre-styled assistant-ui Thread with Talk2View branding.
 *
 * Renders an inline chat thread with a header bar (logo, settings, sign out).
 * Must be used inside T2VAssistantProvider. Requires Tailwind CSS.
 *
 * @example
 * ```tsx
 * <T2VAssistantProvider partnerKey="pk_live_abc">
 *   <T2VThread welcomeMessage="Ask me anything!" />
 * </T2VAssistantProvider>
 * ```
 */

import React, { useState } from 'react';
import { Thread } from '@assistant-ui/react-ui';
import { T2VToolFallback } from './T2VToolFallback';
import { T2VComposer } from './T2VComposer';
import { T2VChatHeader } from './T2VChatHeader';
import { T2V_LOGOS } from '../../react/theme';
import { SettingsView } from './SettingsView';
import { LoginModal } from './LoginModal';
import { useT2VAuth } from '../../react/useT2VAuth';
import { useT2V } from '../../react/T2VProvider';
import { useUserPreferences } from '../../react/useUserPreferences';

const FONT_SCALE: Record<string, number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

export interface T2VThreadProps {
  /** Welcome message shown before the first user message. */
  welcomeMessage?: string;
}

export function T2VThread({ welcomeMessage }: T2VThreadProps) {
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const { isAuthenticated } = useT2V();
  const { logout } = useT2VAuth();
  const { preferences } = useUserPreferences();
  const fontSize = FONT_SCALE[preferences.fontSize || 'medium'] ?? 1;

  // Reset to chat view on logout
  React.useEffect(() => {
    if (!isAuthenticated) setView('chat');
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
        <LoginModal />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: `${fontSize}rem` }}>
      <T2VChatHeader
        view={view}
        onSettingsClick={() => setView('settings')}
        onBackClick={() => setView('chat')}
        onSignOut={() => { logout().catch(console.error); }}
      />
      {view === 'settings' ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SettingsView onBack={() => setView('chat')} hideHeader />
        </div>
      ) : (
        <Thread
          welcome={{
            message: welcomeMessage ?? 'How can I help you today?',
          }}
          assistantMessage={{
            components: {
              ToolFallback: T2VToolFallback,
            },
          }}
          assistantAvatar={{
            src: T2V_LOGOS.icon,
            fallback: 'T2V',
          }}
          components={{
            Composer: T2VComposer,
          }}
        />
      )}
    </div>
  );
}
