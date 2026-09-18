/**
 * A pretend engine, so the example runs with no account and no network.
 * Turned on with `?mock=1`; without it the app talks to whatever
 * `vite.config.ts` proxies `/api` to.
 *
 * It is a `fetch` wrapper rather than a service worker so there is nothing to
 * install, nothing to unregister, and nothing left behind in the browser.
 */

const REPLIES = [
  'The chat you are looking at is one component and one stylesheet. Nothing in this app knows about Tailwind.',
  'Everything renders inside `.t2v-chat`, so the page around it keeps its own fonts, colours and spacing.',
  'Try the launcher route, the dark toggle, and the tool the agent can ask to run.',
];
let nextReply = 0;

function sse(parts: Array<Record<string, unknown>>): Response {
  const body = parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function chunk(extra: Record<string, unknown>) {
  return {
    id: 'chunk_mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    thread_id: 'thread_mock',
    ...extra,
  };
}

function text(content: string) {
  return [
    chunk({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
  ];
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Wrap `fetch` so every `/api/v1/**` call is answered locally. */
export function installMockEngine(): void {
  const real = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (!path.startsWith('/api/v1/')) return real(input as RequestInfo, init);

    if (path.endsWith('/auth/anonymous') || path.endsWith('/auth/login')) {
      return json({
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'mock_user', email: '' },
      });
    }
    if (path.endsWith('/auth/logout')) return json({});
    if (path.endsWith('/config')) {
      return json({ default_llm_model: 'mock-model', default_stt_model: null, system_prompt: null });
    }
    if (path.endsWith('/audio/models')) return json({ object: 'list', data: [] });
    if (path.endsWith('/models')) {
      return json({
        object: 'list',
        data: [{ id: 'mock-model', object: 'model', created: 0, owned_by: 'talk2view' }],
      });
    }
    if (path.endsWith('/tools/register')) return json({ registered: ['highlight_finding'], count: 1 });
    if (path.endsWith('/resume')) return sse(text('Done — have a look at the report behind the panel.'));
    if (path.endsWith('/messages')) {
      const body = String(init?.body ?? '');
      // One tool round trip, so the approval card is reachable without an
      // engine: ask for a highlight and the agent asks to run the tool.
      if (/highlight/i.test(body)) {
        return sse([
          chunk({
            choices: [{ index: 0, delta: {}, finish_reason: null }],
            interrupt: {
              type: 'tool_call',
              tool_name: 'highlight_finding',
              tool_call_id: `call_${Date.now()}`,
              arguments: { text: 'stable 4 mm right lower lobe nodule' },
            },
          }),
        ]);
      }
      const reply = REPLIES[nextReply % REPLIES.length]!;
      nextReply += 1;
      return sse(text(reply));
    }
    if (path.endsWith('/sessions')) {
      return json({ session_id: 'sess_mock', thread_id: 'thread_mock', model: 'mock-model' });
    }
    return json({});
  };
}
