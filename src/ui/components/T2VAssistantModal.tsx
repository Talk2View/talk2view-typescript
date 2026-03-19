/**
 * T2VAssistantModal — Floating chat widget using assistant-ui's AssistantModal.
 *
 * Renders a fixed-position trigger button (bottom-right by default) with the
 * Talk2View logo that opens a chat popover. Includes a header with a
 * settings/sign-out dropdown.
 *
 * All styling is self-contained — no CSS overrides needed in the consumer app.
 *
 * Must be used inside T2VAssistantProvider.
 *
 * @example
 * ```tsx
 * <T2VAssistantProvider partnerKey="pk_live_abc">
 *   <MyExistingApp />
 *   <T2VAssistantModal />
 * </T2VAssistantProvider>
 * ```
 */

import React, { useState } from 'react';
import { AssistantModal, Thread } from '@assistant-ui/react-ui';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { T2VToolFallback } from './T2VToolFallback';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MarkdownText: React.FC<any> = () => <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} />;
import { T2VComposer } from './T2VComposer';
import { T2V_LOGOS } from '../../react/theme';
import { T2VChatHeader } from './T2VChatHeader';
import { SettingsView } from './SettingsView';
import { LoginModal } from './LoginModal';
import { useT2VAuth } from '../../react/useT2VAuth';
import { useT2V } from '../../react/T2VProvider';
import { useUserPreferences } from '../../react/useUserPreferences';
import { useT2VChatActions } from './T2VAssistantProvider';

const FONT_SCALE: Record<string, number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

/* ── Inject modal-specific CSS (idempotent) ─────────────────── */

let modalStylesInjected = false;

function injectModalStyles(): void {
  if (modalStylesInjected) return;
  if (typeof document === 'undefined') return;

  const id = 't2v-modal-styles';
  if (document.getElementById(id)) {
    modalStylesInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
/* T2V modal button — responsive, branded */
.aui-modal-anchor {
  width: clamp(3.5rem, 5vw, 5rem);
  height: clamp(3.5rem, 5vw, 5rem);
}
.aui-modal-button[data-state="closed"] {
  background: transparent !important;
  box-shadow: none !important;
}
.aui-modal-button[data-state="open"] {
  background: hsl(var(--aui-primary, 0 0% 9.4%)) !important;
  color: hsl(var(--aui-primary-foreground, 0 0% 98%));
}
/* Logo/chevron toggle */
.aui-modal-button[data-state="closed"] .t2v-modal-logo {
  transform: scale(1) rotate(0deg);
}
.aui-modal-button[data-state="open"] .t2v-modal-logo {
  transform: scale(0) rotate(90deg);
}
.aui-modal-button[data-state="closed"] .t2v-modal-chevron {
  transform: scale(0) rotate(-90deg);
}
.aui-modal-button[data-state="open"] .t2v-modal-chevron {
  transform: scale(1) rotate(0deg);
}
/* Chat popover height */
.aui-modal-content {
  height: 70vh;
}
/* Welcome suggestions — stacked vertically, don't affect logo centering */
.aui-thread-welcome-suggestions {
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
/* Prevent host app focus styles from leaking into the chat UI */
.aui-root *:focus-visible,
.aui-modal-content *:focus-visible {
  outline: none !important;
}
`;
  document.head.appendChild(style);
  modalStylesInjected = true;
}

/* ── Component ──────────────────────────────────────────────── */

export interface T2VAssistantModalProps {
  /** Welcome message shown before the first user message. */
  welcomeMessage?: string;
  /** Clickable suggestion prompts shown below the welcome message. */
  suggestions?: { prompt: string; text?: React.ReactNode }[];
}

export function T2VAssistantModal({ welcomeMessage, suggestions }: T2VAssistantModalProps) {
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const { isAuthenticated } = useT2V();
  const { logout } = useT2VAuth();
  const { clearMessages } = useT2VChatActions();
  const { preferences } = useUserPreferences();
  const fontSize = FONT_SCALE[preferences.fontSize || 'medium'] ?? 1;

  // Inject modal CSS on mount (idempotent)
  React.useEffect(() => {
    injectModalStyles();
  }, []);

  // Reset to chat view when auth state changes (e.g. after logout)
  React.useEffect(() => {
    if (!isAuthenticated) setView('chat');
  }, [isAuthenticated]);

  return (
    <AssistantModal.Root>
      <AssistantModal.Trigger>
        <img
          src={T2V_LOGOS.icon}
          alt="Talk2View"
          className="t2v-modal-logo"
          style={{
            position: 'absolute',
            width: '85%',
            height: '85%',
            objectFit: 'contain',
            transition: 'all 150ms ease',
          }}
        />
        <svg
          className="t2v-modal-chevron"
          xmlns="http://www.w3.org/2000/svg"
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: 'absolute',
            width: '1.5rem',
            height: '1.5rem',
            transition: 'all 150ms ease',
          }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </AssistantModal.Trigger>
      <AssistantModal.Content>
        {isAuthenticated ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: `${fontSize}rem` }}>
            <T2VChatHeader
              view={view}
              onSettingsClick={() => setView('settings')}
              onBackClick={() => setView('chat')}
              onNewChat={clearMessages}
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
                  suggestions,
                }}
                assistantMessage={{
                  components: {
                    Text: MarkdownText,
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
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center' }}>
            <LoginModal />
          </div>
        )}
      </AssistantModal.Content>
    </AssistantModal.Root>
  );
}
