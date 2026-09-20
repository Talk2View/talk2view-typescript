import { beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VError } from '../../src/errors';
import type { ChatCompletionChunk, ChatEvent } from '../../src/types';

const request = vi.fn();
const streamRequest = vi.fn();
const reRegister = vi.fn();
const hasHandler = vi.fn();
const executeToolCall = vi.fn();

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request, streamRequest })),
}));

vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister,
    checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
    hasHandler,
    executeToolCall,
    getDescription: vi.fn().mockReturnValue(undefined),
  })),
  // src/index.ts imports this as a named function (not a T2VTools method);
  // consumeStream calls it for tool_call/approval_required events.
  stripNullArgs: vi.fn((args: unknown) => args),
}));

import { Talk2View } from '../../src/index';

function sessionGone(): T2VError {
  return new T2VError('Session not found', 'not_found', 404);
}

function textChunk(content: string): ChatCompletionChunk {
  return {
    id: 't', object: 'chat.completion.chunk', created: 0, model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }], thread_id: 'th',
  };
}

function stopChunk(): ChatCompletionChunk {
  return {
    id: 't', object: 'chat.completion.chunk', created: 0, model: 'm',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], thread_id: 'th',
  };
}

/** A chunk carrying a client-tool interrupt — the engine pausing for a tool call. */
function interruptChunk(toolName: string, toolCallId: string): ChatCompletionChunk {
  return {
    id: 't', object: 'chat.completion.chunk', created: 0, model: 'm',
    choices: [{ index: 0, delta: {}, finish_reason: null }], thread_id: 'th',
    interrupt: { type: 'tool_call', tool_name: toolName, tool_call_id: toolCallId, arguments: {} },
  };
}

/** A stream that throws before yielding anything — the 404 a dead session gives. */
function throwingStream(error: unknown) {
  return async function* () {
    throw error;
    yield undefined as never;
  };
}

function yieldingStream(...chunks: ChatCompletionChunk[]) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

function createT2V(): Talk2View {
  return new Talk2View({
    partnerKey: 'pk_test_123',
    baseUrl: 'http://localhost',
    anonymousAutoStart: false,
  });
}

async function collect(stream: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but not a queued mockImplementationOnce.
  // A test whose code path fails fast can leave one unconsumed, which would
  // otherwise leak into the next test's first streamRequest call.
  streamRequest.mockReset();
  reRegister.mockResolvedValue(null);
  hasHandler.mockReturnValue(false);
  executeToolCall.mockResolvedValue({ result: 'ok', isError: false });
  request.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/v1/sessions') {
      const n = request.mock.calls.filter((c) => c[0] === '/v1/sessions').length;
      return { session_id: `s${n}`, thread_id: `th${n}`, model: 'm' };
    }
    return {};
  });
});

describe('Talk2View.chat — a chat session lost to a deploy or an eviction', () => {
  it('creates a new session and resends the turn, keeping the conversation', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(sessionGone()))
      .mockImplementationOnce(yieldingStream(textChunk('hello'), stopChunk()));
    const t2v = createT2V();
    const recovered: string[] = [];
    t2v.on('sessionRecovered', (id) => { recovered.push(id); });

    const events = await collect(t2v.chat('hi', { history: [{ role: 'user', content: 'earlier' }] }));

    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(2);
    expect(recovered).toEqual(['s2']);
    const [endpoint, body] = streamRequest.mock.calls[1]!;
    expect(endpoint).toBe('/v1/sessions/s2/messages');
    expect((body as { messages: { content: unknown }[] }).messages).toHaveLength(2);
  });

  it('re-registers the partner tools on the new session', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(sessionGone()))
      .mockImplementationOnce(yieldingStream(stopChunk()));
    const t2v = createT2V();

    await collect(t2v.chat('hi'));

    expect(reRegister).toHaveBeenCalledTimes(2);
  });

  it('does not resend once the reply has started — reports the loss instead of leaking the raw error', async () => {
    streamRequest.mockImplementationOnce(async function* () {
      yield textChunk('partial');
      throw sessionGone();
    });
    const t2v = createT2V();

    const events = await collect(t2v.chat('hi'));

    expect(events.map((e) => e.type)).toEqual(['text', 'error']);
    const error = events[1] as { errorType?: string; message: string };
    expect(error.errorType).toBe('session_lost');
    expect(error.message).not.toMatch(/session not found/i);
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(1);
    expect(t2v.getSession()).toBeNull();
  });

  it('reports the loss instead of leaking the raw error when a tool resume 404s', async () => {
    hasHandler.mockReturnValue(true);
    streamRequest
      .mockImplementationOnce(yieldingStream(interruptChunk('insert_text', 'tc1')))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();

    const events = await collect(t2v.chat('hi'));

    expect(events.map((e) => e.type)).toEqual(['tool_call', 'error']);
    const error = events[1] as { errorType?: string; message: string };
    expect(error.errorType).toBe('session_lost');
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(1);
    expect(t2v.getSession()).toBeNull();
  });

  it('gives up after one retry rather than looping', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(sessionGone()))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();

    await expect(collect(t2v.chat('hi'))).rejects.toThrow('Session not found');
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(2);
  });

  it('recovers when the engine raises its dedicated session_not_found type too', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(new T2VError('Session not found', 'session_not_found', 404)))
      .mockImplementationOnce(yieldingStream(stopChunk()));
    const t2v = createT2V();

    const events = await collect(t2v.chat('hi'));

    expect(events.map((e) => e.type)).toEqual(['done']);
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(2);
  });

  it('does not recover once the caller has aborted', async () => {
    streamRequest.mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();
    const controller = new AbortController();
    controller.abort();
    const recovered: string[] = [];
    t2v.on('sessionRecovered', (id) => { recovered.push(id); });

    await expect(collect(t2v.chat('hi', { signal: controller.signal }))).rejects.toThrow('Session not found');

    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(1);
    expect(recovered).toEqual([]);
  });

  it('does not resend the turn if clearSession() fires while recovery re-registers tools', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(sessionGone()))
      .mockImplementationOnce(yieldingStream(stopChunk()));
    let resolveReRegister: ((v: null) => void) | null = null;
    reRegister
      .mockResolvedValueOnce(null) // the initial createSession() from chat()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReRegister = resolve; })); // recovery's createSession()
    const t2v = createT2V();

    const chatPromise = collect(t2v.chat('hi'));
    await new Promise((r) => setTimeout(r, 0));
    expect(reRegister).toHaveBeenCalledTimes(2);

    // A concurrent clearSession() nulls out the session createSession() just
    // assigned, while recovery is still awaiting tool re-registration.
    t2v.clearSession();
    resolveReRegister!(null);

    const events = await chatPromise;
    expect(events).toEqual([]);
    expect(streamRequest).toHaveBeenCalledTimes(1);
  });

  it('passes other failures through untouched', async () => {
    streamRequest.mockImplementationOnce(throwingStream(new T2VError('Boom', 'internal_error', 500)));
    const t2v = createT2V();

    await expect(collect(t2v.chat('hi'))).rejects.toThrow('Boom');
    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(1);
  });
});

describe('Talk2View.respondToApproval — the chat session died before the resume', () => {
  const approval = { toolCallId: 'tc1', toolName: 'insert_text', arguments: { text: 'x' } };

  it('reports the loss instead of throwing, and clears the pending approval', async () => {
    streamRequest
      .mockImplementationOnce(yieldingStream(stopChunk()))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();
    await collect(t2v.chat('hi'));

    const events = await collect(t2v.respondToApproval(approval, { action: 'deny' }));

    expect(events.map((e) => e.type)).toEqual(['approval_result', 'error']);
    const error = events[1] as { errorType?: string; message: string };
    expect(error.errorType).toBe('session_lost');
    expect(error.message).toMatch(/send your message again/i);
    expect(t2v.pendingApproval).toBeNull();
  });

  it('does not resend the tool result on a new session', async () => {
    streamRequest
      .mockImplementationOnce(yieldingStream(stopChunk()))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();
    await collect(t2v.chat('hi'));
    const sessionsBefore = request.mock.calls.filter((c) => c[0] === '/v1/sessions').length;

    await collect(t2v.respondToApproval(approval, { action: 'deny' }));

    expect(request.mock.calls.filter((c) => c[0] === '/v1/sessions')).toHaveLength(sessionsBefore);
    expect(streamRequest).toHaveBeenCalledTimes(2);
  });

  it('warns the handler may already have run when the tool was actually executed', async () => {
    streamRequest
      .mockImplementationOnce(yieldingStream(stopChunk()))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();
    await collect(t2v.chat('hi'));

    const events = await collect(t2v.respondToApproval(approval, { action: 'once' }));

    expect(events.map((e) => e.type)).toEqual(['approval_result', 'error']);
    const error = events[1] as { errorType?: string; message: string };
    expect(error.errorType).toBe('session_lost');
    expect(error.message).toMatch(/may already have been applied/i);
    expect(error.message).not.toMatch(/reconnect/i);
  });

  it('runs the tool handler exactly once even though the resume never reaches the engine', async () => {
    streamRequest
      .mockImplementationOnce(yieldingStream(stopChunk()))
      .mockImplementationOnce(throwingStream(sessionGone()));
    const t2v = createT2V();
    await collect(t2v.chat('hi'));

    const events = await collect(t2v.respondToApproval(approval, { action: 'once' }));

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    const error = events[1] as { errorType?: string; message: string };
    expect(error.errorType).toBe('session_lost');
  });
});

describe('Talk2View.sendMessage — recovers transparently through the public state-management API', () => {
  it('lands the recovered reply in messages, leaves error null, and resends the same history', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(sessionGone()))
      .mockImplementationOnce(yieldingStream(textChunk('hello'), stopChunk()));
    const t2v = createT2V();

    await t2v.sendMessage('hi');

    expect(t2v.messages.some((m) => m.role === 'assistant' && m.content === 'hello')).toBe(true);
    expect(t2v.error).toBeNull();
    expect(t2v.isLoading).toBe(false);
    expect(streamRequest).toHaveBeenCalledTimes(2);
    const [, firstBody] = streamRequest.mock.calls[0]!;
    const [, secondBody] = streamRequest.mock.calls[1]!;
    expect((secondBody as { messages: unknown }).messages).toEqual((firstBody as { messages: unknown }).messages);
  });
});
