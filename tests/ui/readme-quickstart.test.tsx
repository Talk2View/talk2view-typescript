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
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Talk2View, ChatPanel } from '../../src/ui';
import { T2VProvider } from '../../src/react';

const originalFetch = global.fetch;

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

  it('keeps <T2VProvider> working for the headless hooks path', async () => {
    const { container } = render(
      <T2VProvider partnerKey="pk_test_readme">
        <div data-testid="child">headless</div>
      </T2VProvider>,
    );

    await waitFor(() => expect(container.textContent).toContain('headless'));
  });
});
