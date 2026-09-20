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

/**
 * What the client replayed with this turn. The engine keeps nothing between
 * messages — the transcript travels with each one — so this is also how you can
 * see, in the browser, that a conversation reopened from the list really did
 * carry its history: ask it what you asked first.
 */
function history(body: string): { earlier: number; first: string | null } {
  try {
    const messages = (JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> })
      .messages;
    if (!Array.isArray(messages)) return { earlier: 0, first: null };
    const users = messages.filter((m) => m.role === 'user').map((m) => plain(m.content));
    return { earlier: Math.max(0, messages.length - 1), first: users[0] ?? null };
  } catch {
    return { earlier: 0, first: null };
  }
}

/** A message's text, whether it arrived as a string or as content parts. */
function plain(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p): p is { type: 'text'; text: string } => (p as { type?: string })?.type === 'text')
    .map((p) => p.text)
    .join(' ');
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
      // Ask it what you asked before and it answers from the replayed
      // transcript, which is the only place it could know.
      if (/what did i|earlier|before|first question|remember/i.test(body)) {
        const { earlier, first } = history(body);
        return sse(
          text(
            first
              ? `You started this chat with “${first}”. I was given ${earlier} earlier message${earlier === 1 ? '' : 's'} with your question.`
              : 'This chat has nothing before your last message.',
          ),
        );
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
