import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let t2vState: Record<string, unknown>;

vi.mock('../../src/ui/context', () => ({
  useTalk2View: () => t2vState,
  useChat: () => ({
    messages: [],
    isLoading: false,
    error: null,
    clearError: vi.fn(),
    clearMessages: vi.fn(),
    agentStatus: null,
    pendingApproval: null,
  }),
}));
vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: { fontSize: 'medium' } }),
}));
vi.mock('../../src/react/usePartnerConfig', () => ({
  usePartnerConfig: () => ({ config: { default_llm_model: '' } }),
}));
vi.mock('../../src/ui/components/ChatHeader', () => ({ ChatHeader: () => null }));
vi.mock('../../src/ui/components/LoginForm', () => ({
  LoginForm: ({ subheading }: { subheading?: string }) =>
    React.createElement('div', { 'data-testid': 'login-form' }, subheading),
}));
vi.mock('../../src/ui/components/Composer', () => ({ Composer: () => null }));
vi.mock('../../src/ui/components/WelcomeScreen', () => ({ WelcomeScreen: () => null }));
vi.mock('../../src/ui/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('../../src/ui/components/MessageList', () => ({ MessageList: () => null }));

import { ChatPanel } from '../../src/ui/components/ChatPanel';

beforeEach(() => {
  t2vState = {
    isAuthenticated: false,
    isAnonymous: false,
    demoLimitReached: false,
    anonymousUnavailable: false,
    t2v: { config: { model: 'gpt-4' }, auth: { logout: vi.fn() } },
  };
});

describe('ChatPanel when anonymous sign-in is refused', () => {
  it('shows the chat to a signed-out visitor while anonymous access works', () => {
    const { queryByTestId } = render(React.createElement(ChatPanel, {}));
    expect(queryByTestId('login-form')).toBeNull();
  });

  it('shows the sign-in form once the partner refuses anonymous sign-in', () => {
    t2vState = { ...t2vState, anonymousUnavailable: true };
    const { getByTestId } = render(React.createElement(ChatPanel, {}));
    expect(getByTestId('login-form')).toBeTruthy();
  });
});

describe('ChatPanel when a guest reaches the demo limit', () => {
  it('asks for an account without claiming the conversation is saved anywhere', () => {
    t2vState = { ...t2vState, isAuthenticated: true, isAnonymous: true, demoLimitReached: true };
    const { getByTestId } = render(React.createElement(ChatPanel, {}));
    // Nothing is saved: the conversation is in memory, and carries on once they sign in.
    expect(getByTestId('login-form').textContent).toBe(
      'Create an account to keep chatting — this conversation carries on.',
    );
  });
});
