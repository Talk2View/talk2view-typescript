/**
 * The README's React quick start, rendered.
 *
 * This is the first code a partner copies, and it used to be wrong in a way
 * nothing caught: <ChatPanel> was shown inside <T2VProvider>, which throws
 * "useTalk2View must be used within <Talk2View>" the moment it renders. Keep
 * this test in step with the README block it mirrors — if the composition or
 * the props move, the docs move with them.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Talk2View, ChatPanel } from '../../src/ui';
import { T2VProvider } from '../../src/react';

const originalFetch = global.fetch;

beforeAll(() => {
  // The packaged chat's primitives observe layout; jsdom has no ResizeObserver.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo ??= () => {};
});

beforeEach(() => {
  // Every network call the providers make on mount answers with an empty
  // object; nothing here asserts on the engine, only on the composition.
  global.fetch = vi.fn(async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('the README quick start', () => {
  it('mounts <ChatPanel> inside <Talk2View> with tools and a system prompt', async () => {
    const tools = [
      {
        name: 'highlight_text',
        description: 'Highlight a passage in the document',
        parameters: {
          type: 'object' as const,
          properties: { text: { type: 'string' as const, description: 'The passage' } },
          required: ['text'],
        },
        execute: async () => 'highlighted',
      },
    ];

    const { container } = render(
      <Talk2View partnerKey="pk_test_readme" tools={tools} systemPrompt="You edit documents.">
        <ChatPanel welcome={{ heading: 'Ask me anything' }} />
      </Talk2View>,
    );

    await waitFor(() => expect(container.querySelector('[data-talk2view]')).not.toBeNull());
    // ChatPanel really rendered inside the provider rather than throwing.
    expect(container.textContent).toContain('Ask me anything');
  });

  it('mounts the Chat UI snippet: <Talk2ViewChat> with tools and suggestions', async () => {
    // The README's "Chat UI" section. This is the first code a partner copies
    // for the packaged chat, so the props, the import path and the composition
    // have to be the real ones. Imported here rather than at the top of the
    // file so the older quick start keeps working in a checkout where the
    // chat's stylesheet has not been built.
    const { Talk2ViewChat } = await import('../../src/chat/index.js');
    const tools = [
      {
        name: 'highlight_text',
        description: 'Highlight a passage in the document',
        parameters: {
          type: 'object' as const,
          properties: { text: { type: 'string' as const, description: 'The passage' } },
          required: ['text'],
        },
        execute: async () => 'highlighted',
      },
    ];

    render(
      <Talk2ViewChat
        partnerKey="pk_test_readme"
        tools={tools}
        welcome={{ suggestions: ['What can you do?'] }}
      />,
    );

    // The chat rendered its own root and seeded the suggestion, rather than
    // throwing on a prop the README invented.
    await waitFor(() => expect(document.querySelector('.t2v-chat')).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'What can you do?' })).not.toBeNull(),
    );
  });

  it('mounts the Chat UI launcher snippet', async () => {
    const { Talk2ViewChatLauncher } = await import('../../src/chat/index.js');
    render(<Talk2ViewChatLauncher partnerKey="pk_test_readme" label="Ask Talk2View" />);
    await waitFor(() => expect(screen.getByText('Ask Talk2View')).not.toBeNull());
  });

  it('keeps <T2VProvider> working for the headless hooks path', async () => {
    const { container } = render(
      <T2VProvider partnerKey="pk_test_readme">
        <div data-testid="child">headless</div>
      </T2VProvider>,
    );

    await waitFor(() => expect(container.textContent).toContain('headless'));
  });
});
