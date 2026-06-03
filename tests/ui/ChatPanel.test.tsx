import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { DisplayMessage, PendingApproval } from '../../src/types';

const runningMessage: DisplayMessage = {
  id: 'a1',
  role: 'assistant',
  content: '',
  timestamp: new Date(0),
  steps: [{ name: 'insert_content', status: 'running', args: { text: 'hello' } }],
};

const pendingApproval: PendingApproval = {
  toolCallId: 'tc1',
  toolName: 'delete_content',
  arguments: { range: 'all' },
  description: 'Delete everything',
};

let chatState: Record<string, unknown>;

vi.mock('../../src/ui/context', () => ({
  useTalk2View: () => ({
    isAuthenticated: true,
    isAnonymous: false,
    demoLimitReached: false,
    t2v: { config: { model: 'gpt-4' }, auth: { logout: vi.fn() } },
  }),
  useChat: () => chatState,
}));

vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: { fontSize: 'medium' } }),
}));
vi.mock('../../src/react/usePartnerConfig', () => ({
  usePartnerConfig: () => ({ config: { default_llm_model: '' } }),
}));

// Stub heavy children so we isolate ChatPanel's own status row + banner.
vi.mock('../../src/ui/components/ChatHeader', () => ({ ChatHeader: () => null }));
vi.mock('../../src/ui/components/LoginForm', () => ({ LoginForm: () => null }));
vi.mock('../../src/ui/components/Composer', () => ({ Composer: () => null }));
vi.mock('../../src/ui/components/WelcomeScreen', () => ({ WelcomeScreen: () => null }));
vi.mock('../../src/ui/components/SettingsPanel', () => ({ SettingsPanel: () => null }));
vi.mock('../../src/ui/components/MessageList', () => ({
  MessageList: () => React.createElement('div', { 'data-testid': 'messagelist' }),
}));

import { ChatPanel } from '../../src/ui/components/ChatPanel';

beforeEach(() => {
  chatState = {
    messages: [runningMessage],
    isLoading: true,
    error: null,
    clearError: vi.fn(),
    clearMessages: vi.fn(),
    agentStatus: null,
    pendingApproval: null,
    approveToolCall: vi.fn(),
  };
});

describe('ChatPanel customization hooks', () => {
  it('shows the tool-activity status row using describeToolActivity', () => {
    const { getByText } = render(
      React.createElement(ChatPanel, {
        describeToolActivity: (name: string) =>
          name === 'insert_content' ? 'Inserting hello' : null,
      }),
    );
    expect(getByText('Inserting hello')).toBeTruthy();
  });

  it('does NOT show a status row when describeToolActivity is not provided', () => {
    const { queryByText } = render(React.createElement(ChatPanel, {}));
    expect(queryByText('Inserting hello')).toBeNull();
    expect(queryByText('Thinking')).toBeNull();
  });

  it('shows the destructive banner with custom warning for a destructive pending approval', () => {
    chatState.pendingApproval = pendingApproval;
    const { getByText } = render(
      React.createElement(ChatPanel, {
        isToolDestructive: (name: string) => name === 'delete_content',
        destructiveWarning: (name: string) => `Danger: ${name}`,
      }),
    );
    expect(getByText('Danger: delete_content')).toBeTruthy();
  });

  it('does NOT show the destructive banner when the tool is not flagged destructive', () => {
    chatState.pendingApproval = pendingApproval;
    const { queryByText } = render(
      React.createElement(ChatPanel, {
        isToolDestructive: () => false,
        destructiveWarning: (name: string) => `Danger: ${name}`,
      }),
    );
    expect(queryByText('Danger: delete_content')).toBeNull();
  });
});
