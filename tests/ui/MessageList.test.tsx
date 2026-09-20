import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { DisplayMessage } from '../../src/types';

// jsdom doesn't implement scrollTo; MessageList's auto-scroll effect calls it.
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

function msg(id: string, role: 'user' | 'assistant'): DisplayMessage {
  return { id, role, content: id, timestamp: new Date(0) };
}

// assistant, assistant, user, assistant — the 2nd assistant follows another
// assistant, so only it should hide its avatar when grouping is on.
const MESSAGES: DisplayMessage[] = [
  msg('a1', 'assistant'),
  msg('a2', 'assistant'),
  msg('u1', 'user'),
  msg('a3', 'assistant'),
];

vi.mock('../../src/ui/context', () => ({
  useChat: () => ({ messages: MESSAGES, isLoading: false }),
}));

// Lightweight stub so we can read the hideAvatar decision without rendering the
// full bubble (markdown/shiki).
vi.mock('../../src/ui/components/MessageBubble', () => ({
  MessageBubble: ({ message, hideAvatar }: { message: DisplayMessage; hideAvatar?: boolean }) =>
    React.createElement('div', {
      'data-testid': 'bubble',
      'data-role': message.role,
      'data-hide-avatar': hideAvatar ? 'true' : 'false',
    }),
}));

import { MessageList } from '../../src/ui/components/MessageList';

function hideFlags(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="bubble"]')).map(
    (b) => b.getAttribute('data-hide-avatar')!,
  );
}

describe('MessageList avatar grouping', () => {
  it('hides the avatar on assistant messages that follow another assistant when grouping is on', () => {
    const { container } = render(
      React.createElement(MessageList, { groupAssistantMessages: true }),
    );
    expect(hideFlags(container)).toEqual(['false', 'true', 'false', 'false']);
  });

  it('never hides avatars when grouping is off', () => {
    const { container } = render(React.createElement(MessageList, {}));
    expect(hideFlags(container)).toEqual(['false', 'false', 'false', 'false']);
  });
});
