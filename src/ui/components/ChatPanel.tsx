import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { DisplayMessage } from '../../types';
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
  /** URL of a password-reset page. When set, the login form shows a
   *  "Forgot password?" link to it. */
  resetPasswordUrl?: string;
  /** Where the reset-password link opens. Defaults to '_blank' (new tab);
   *  pass '_self' for a page in your own app. */
  resetPasswordTarget?: '_self' | '_blank';
  /**
   * Map an in-progress tool call to friendly status text (e.g. "Inserting 240
   * chars at end"). When provided, a live status row is shown above the composer
   * while the agent works; return null to fall back to the agent's own status.
   */
  describeToolActivity?: (toolName: string, args?: Record<string, unknown>) => string | null;
  /**
   * Mark a pending tool approval as destructive. When it returns true, a warning
   * banner is shown above the composer until the user approves or denies.
   */
  isToolDestructive?: (toolName: string, args?: Record<string, unknown>) => boolean;
  /** Custom warning node for the destructive-approval banner (defaults to a generic message). */
  destructiveWarning?: (toolName: string, activity: string | null) => React.ReactNode;
  /** Visually merge consecutive assistant messages into one turn (hide repeated avatars). */
  groupAssistantMessages?: boolean;
}

export function ChatPanel({
  welcome,
  signupUrl,
  allowAnonymous = true,
  resetPasswordUrl,
  resetPasswordTarget,
  describeToolActivity,
  isToolDestructive,
  destructiveWarning,
  groupAssistantMessages,
}: ChatPanelProps) {
  const { isAuthenticated, isAnonymous, demoLimitReached, anonymousUnavailable, t2v } = useTalk2View();
  const { messages, clearMessages, error, clearError, pendingApproval } = useChat();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const [view, setView] = useState<'chat' | 'settings' | 'login'>('chat');
  const fontSize = FONT_SCALE[preferences.fontSize ?? 'medium'] ?? 0.875;
  // Show the model id verbatim (no `openrouter/` stripping) so direct-API models
  // like `anthropic/...` stay unambiguous next to `openrouter/anthropic/...`.
  const modelDisplay = preferences.model || t2v.config.model || partnerConfig?.default_llm_model || '';

  // Show the login gate when a logged-out visitor can't use anonymous access
  // (the app disallows it, or the partner refused anonymous sign-in), or once an
  // anonymous visitor exhausts the demo budget.
  const showLoginGate =
    (!isAuthenticated && (!allowAnonymous || anonymousUnavailable)) || demoLimitReached;
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
          resetPasswordUrl={resetPasswordUrl}
          resetPasswordTarget={resetPasswordTarget}
          heading={demoLimitReached ? 'You’ve reached the demo limit' : undefined}
          subheading={demoLimitReached ? 'Create an account to keep chatting — your conversation is saved.' : undefined}
          defaultMode={demoLimitReached ? 'signup' : 'login'}
        />
      ) : view === 'settings' ? (
        <div style={{ flex: 1, overflow: 'auto' }}><SettingsPanel hideHeader /></div>
      ) : view === 'login' ? (
        <LoginForm signupUrl={signupUrl} defaultMode="login" resetPasswordUrl={resetPasswordUrl} resetPasswordTarget={resetPasswordTarget} />
      ) : messages.length === 0 ? (
        <WelcomeScreen heading={welcome?.heading} suggestions={welcome?.suggestions} />
      ) : (
        <MessageList groupAssistantMessages={groupAssistantMessages} />
      )}
      {inChat && view === 'chat' && isToolDestructive && pendingApproval &&
        isToolDestructive(pendingApproval.toolName, pendingApproval.arguments) && (
          <DestructiveBanner
            toolName={pendingApproval.toolName}
            activity={describeToolActivity?.(pendingApproval.toolName, pendingApproval.arguments) ?? null}
            render={destructiveWarning}
          />
        )}
      {inChat && view === 'chat' && describeToolActivity && (
        <AgentStatusRow describeToolActivity={describeToolActivity} />
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

/** Find the most recent still-running tool step across all messages. */
export function findRunningStep(
  messages: DisplayMessage[],
): { name: string; args?: Record<string, unknown> } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const steps = messages[i]?.steps;
    if (!steps) continue;
    for (let j = steps.length - 1; j >= 0; j--) {
      const step = steps[j]!;
      if (step.status === 'running') return { name: step.name, args: step.args };
    }
  }
  return null;
}

/**
 * Live status row shown above the composer while the agent works. Prefers the
 * consumer's tool-activity description for the running tool, then the agent's
 * own status message, then a generic "Thinking".
 */
function AgentStatusRow({
  describeToolActivity,
}: {
  describeToolActivity: (toolName: string, args?: Record<string, unknown>) => string | null;
}) {
  const { messages, isLoading, agentStatus } = useChat();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isLoading]);

  const runningStep = findRunningStep(messages);
  const toolActivity = runningStep ? describeToolActivity(runningStep.name, runningStep.args) : null;
  const statusText = toolActivity || agentStatus?.message || (isLoading ? 'Thinking' : null);
  if (!statusText) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 6,
        padding: '2px 12px',
        fontSize: '10px',
        fontFamily: 'var(--t2v-font-mono)',
        letterSpacing: '0.3px',
        background: 'transparent',
      }}
    >
      <span style={{ display: 'inline-flex', gap: 2 }}>
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      <span
        style={{
          color: 'var(--t2v-accent)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {statusText}
        {seconds > 0 ? ` ${seconds}s` : ''}
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 4,
        height: 4,
        borderRadius: 4,
        background: 'var(--t2v-accent)',
        animation: 't2v-dot-bounce 1s infinite ease-in-out',
        animationDelay: `${delay}ms`,
        display: 'inline-block',
      }}
    />
  );
}

/** Warning banner shown above the composer when a destructive tool awaits approval. */
function DestructiveBanner({
  toolName,
  activity,
  render,
}: {
  toolName: string;
  activity: string | null;
  render?: (toolName: string, activity: string | null) => React.ReactNode;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: '6px 12px',
        fontSize: '11px',
        fontFamily: 'var(--t2v-font)',
        color: '#92400e',
        background: 'rgba(234, 179, 8, 0.12)',
        borderTop: '1px solid rgba(234, 179, 8, 0.35)',
        borderBottom: '1px solid rgba(234, 179, 8, 0.35)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {render ? (
        render(toolName, activity)
      ) : (
        <>
          <span aria-hidden>!</span>
          <span>
            This action is destructive: <strong>{activity ?? toolName}</strong>. Review before
            approving.
          </span>
        </>
      )}
    </div>
  );
}
