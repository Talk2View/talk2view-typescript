/**
 * The client sends `reasoning_effort` next to `model` only when a caller or the
 * config names one, keeps it for Retry, and forgets it with the conversation.
 * A refused effort is reported, never silently rerun at another effort.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REASONING_EFFORT_RESET_MESSAGE, T2VError } from '../../src/errors';
import type { ChatCompletionChunk } from '../../src/types';

const request = vi.fn();
const streamRequest = vi.fn();
const reRegister = vi.fn();
const hasHandler = vi.fn();
const executeToolCall = vi.fn();

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(function () { return { request, streamRequest }; }),
}));

vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(function () { return {
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
  }; }),
}));

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(function () { return {
    reRegister,
    checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
    hasHandler,
    executeToolCall,
    getDescription: vi.fn().mockReturnValue(undefined),
  }; }),
  // src/index.ts imports this as a named function (not a T2VTools method);
  // consumeStream calls it for tool_call/approval_required events.
  stripNullArgs: vi.fn((args: unknown) => args),
}));

import { Talk2View } from '../../src/index';

function stopChunk(): ChatCompletionChunk {
  return {
    id: 't', object: 'chat.completion.chunk', created: 0, model: 'm',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], thread_id: 'th',
  };
}

/** A stream that throws before yielding anything — a refused request. */
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

const sessionBody = () => JSON.parse(request.mock.calls.find((c) => c[0] === '/v1/sessions')![1].body);
const turnBody = (i: number) => streamRequest.mock.calls[i]![1];

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but not a queued mockImplementationOnce.
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

it('creates the session with the configured effort', async () => {
  streamRequest.mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  await t2v.sendMessage('hi');
  expect(sessionBody()).toEqual({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
  expect(turnBody(0)).toMatchObject({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
});

it('sends no reasoning_effort anywhere when none is configured or given', async () => {
  streamRequest.mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen-thinking' });
  expect('reasoning_effort' in sessionBody()).toBe(false);
  expect(turnBody(0).model).toBe('gemini-4-hydrogen-thinking');
  expect('reasoning_effort' in turnBody(0)).toBe(false);
});

it('retry resends the last turn with its model and effort', async () => {
  streamRequest.mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  await t2v.retryLastMessage();
  expect(turnBody(1)).toMatchObject({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
});

it('a new chat forgets the last turn\'s model and effort', async () => {
  streamRequest.mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  t2v.clearMessages();
  await t2v.sendMessage('again');
  expect(turnBody(1).model).toBeUndefined();
  expect('reasoning_effort' in turnBody(1)).toBe(false);
});

it('passes reasoning_effort through completions()', async () => {
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  await t2v.completions({ model: 'gemini-4-hydrogen', reasoning_effort: 'medium', messages: [{ role: 'user', content: 'x' }] });
  const call = request.mock.calls.find((c) => c[0] === '/v1/completions')!;
  expect(JSON.parse(call[1].body).reasoning_effort).toBe('medium');
});

const unsupported = () => new T2VError("Model gemini-4-hydrogen does not support reasoning effort 'high'", 'reasoning_effort_not_supported', 400, undefined, undefined,
  { model: 'gemini-4-hydrogen', reasoningEffort: 'high', supportedReasoningEfforts: ['low'] });
const gated = (reasoningEffort?: string) => new T2VError('Model gemini-4-hydrogen requires a paid subscription', 'model_gated', 403, undefined, undefined,
  { model: 'gemini-4-hydrogen', reasoningEffort });

it('an unsupported effort shows the reset message, fires the event, and Retry runs without the effort', async () => {
  streamRequest.mockImplementationOnce(throwingStream(unsupported())).mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  const seen: unknown[] = [];
  t2v.on('reasoningEffortUnsupported', (e) => { seen.push(e); });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  expect(t2v.error).toBe(REASONING_EFFORT_RESET_MESSAGE);
  expect(seen).toEqual([{ model: 'gemini-4-hydrogen', reasoningEffort: 'high', supported: ['low'] }]);
  await t2v.retryLastMessage();
  expect(turnBody(1).model).toBe('gemini-4-hydrogen');
  expect('reasoning_effort' in turnBody(1)).toBe(false);
  expect(t2v.error).toBeNull();
});

it('a gated effort keeps the engine message, fires modelGated, and Retry runs without the effort', async () => {
  streamRequest.mockImplementationOnce(throwingStream(gated('high'))).mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  const seen: unknown[] = [];
  t2v.on('modelGated', (e) => { seen.push(e); });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  expect(t2v.error).toBe('Model gemini-4-hydrogen requires a paid subscription');
  expect(seen).toEqual([{ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }]);
  await t2v.retryLastMessage();
  expect('reasoning_effort' in turnBody(1)).toBe(false);
});

it('a gated model with no effort fires modelGated with a null effort', async () => {
  streamRequest.mockImplementationOnce(throwingStream(gated()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  const seen: unknown[] = [];
  t2v.on('modelGated', (e) => { seen.push(e); });
  await t2v.sendMessage('hi', { model: 'gemini-4-hydrogen' });
  expect(seen).toEqual([{ model: 'gemini-4-hydrogen', reasoningEffort: null }]);
});

it('any other failure fires neither event', async () => {
  streamRequest.mockImplementationOnce(throwingStream(new T2VError('Boom', 'server_error', 500)));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false });
  const seen: string[] = [];
  t2v.on('modelGated', () => { seen.push('gated'); });
  t2v.on('reasoningEffortUnsupported', () => { seen.push('unsupported'); });
  await t2v.sendMessage('hi');
  expect(seen).toEqual([]);
  expect(t2v.error).toBe('Boom');
});

it('after a refused configured effort, Retry sends the model alone and leaves the config untouched', async () => {
  streamRequest.mockImplementationOnce(throwingStream(unsupported())).mockImplementation(yieldingStream(stopChunk()));
  const config = { partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, model: 'gemini-4-hydrogen', reasoningEffort: 'high' };
  const t2v = new Talk2View(config);
  await t2v.sendMessage('hi');
  expect(turnBody(0)).toMatchObject({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
  await t2v.retryLastMessage();
  expect(turnBody(1).model).toBe('gemini-4-hydrogen');
  expect('reasoning_effort' in turnBody(1)).toBe(false);
  expect(config.reasoningEffort).toBe('high');
  // Only the retry skips it: a new turn uses the config as before, like a
  // remembered effort, which only Retry ever reads.
  await t2v.sendMessage('next');
  expect(turnBody(2)).toMatchObject({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
});

it('after a refused configured effort with no configured model, Retry names the refused model', async () => {
  streamRequest.mockImplementationOnce(throwingStream(unsupported())).mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, reasoningEffort: 'high' });
  await t2v.sendMessage('hi');
  await t2v.retryLastMessage();
  expect(turnBody(1).model).toBe('gemini-4-hydrogen');
  expect('reasoning_effort' in turnBody(1)).toBe(false);
});

it('after a gated configured effort, Retry sends the model alone', async () => {
  streamRequest.mockImplementationOnce(throwingStream(gated('high'))).mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  await t2v.sendMessage('hi');
  await t2v.retryLastMessage();
  expect(turnBody(1).model).toBe('gemini-4-hydrogen');
  expect('reasoning_effort' in turnBody(1)).toBe(false);
});

it('a retry after a successful turn still sends the configured effort', async () => {
  streamRequest.mockImplementation(yieldingStream(stopChunk()));
  const t2v = new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  await t2v.sendMessage('hi');
  await t2v.retryLastMessage();
  expect(turnBody(1)).toMatchObject({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
});

describe('a refusal from session creation', () => {
  const sessionBodies = () => request.mock.calls.filter((c) => c[0] === '/v1/sessions').map((c) => JSON.parse(c[1].body));
  const refuseFirstSession = (error: T2VError) => {
    let refused = false;
    request.mockImplementation(async (endpoint: string) => {
      if (endpoint !== '/v1/sessions') return {};
      if (!refused) { refused = true; throw error; }
      return { session_id: 's1', thread_id: 'th1', model: 'gemini-4-hydrogen' };
    });
  };
  const configured = () => new Talk2View({ partnerKey: 'pk', baseUrl: 'http://localhost', anonymousAutoStart: false, model: 'gemini-4-hydrogen', reasoningEffort: 'high' });

  it('an unsupported configured effort: Retry creates the session and sends the turn without it', async () => {
    refuseFirstSession(unsupported());
    streamRequest.mockImplementation(yieldingStream(stopChunk()));
    const t2v = configured();
    const seen: unknown[] = [];
    t2v.on('reasoningEffortUnsupported', (e) => { seen.push(e); });
    await t2v.sendMessage('hi');
    expect(t2v.error).toBe(REASONING_EFFORT_RESET_MESSAGE);
    expect(seen).toEqual([{ model: 'gemini-4-hydrogen', reasoningEffort: 'high', supported: ['low'] }]);
    expect(streamRequest).not.toHaveBeenCalled();
    await t2v.retryLastMessage();
    expect(sessionBodies()).toEqual([{ model: 'gemini-4-hydrogen', reasoning_effort: 'high' }, { model: 'gemini-4-hydrogen' }]);
    expect(turnBody(0).model).toBe('gemini-4-hydrogen');
    expect('reasoning_effort' in turnBody(0)).toBe(false);
    expect(t2v.error).toBeNull();
  });

  it('a gated configured effort: Retry creates the session and sends the turn without it', async () => {
    refuseFirstSession(gated('high'));
    streamRequest.mockImplementation(yieldingStream(stopChunk()));
    const t2v = configured();
    const seen: unknown[] = [];
    t2v.on('modelGated', (e) => { seen.push(e); });
    await t2v.sendMessage('hi');
    expect(seen).toEqual([{ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }]);
    await t2v.retryLastMessage();
    expect(sessionBodies()[1]).toEqual({ model: 'gemini-4-hydrogen' });
    expect('reasoning_effort' in turnBody(0)).toBe(false);
  });

  it('a session created later, outside the retry, carries the configured effort again', async () => {
    refuseFirstSession(unsupported());
    streamRequest.mockImplementation(yieldingStream(stopChunk()));
    const t2v = configured();
    await t2v.sendMessage('hi');
    await t2v.retryLastMessage();
    t2v.clearMessages();
    await t2v.sendMessage('again');
    expect(sessionBodies()[2]).toEqual({ model: 'gemini-4-hydrogen', reasoning_effort: 'high' });
  });

  it('a session replaced during the retry is created without the refused effort', async () => {
    streamRequest
      .mockImplementationOnce(throwingStream(unsupported()))
      .mockImplementationOnce(throwingStream(new T2VError('Session not found', 'not_found', 404)))
      .mockImplementation(yieldingStream(stopChunk()));
    const t2v = configured();
    await t2v.sendMessage('hi');
    await t2v.retryLastMessage();
    expect(sessionBodies()).toEqual([{ model: 'gemini-4-hydrogen', reasoning_effort: 'high' }, { model: 'gemini-4-hydrogen' }]);
    expect('reasoning_effort' in turnBody(2)).toBe(false);
    expect(t2v.error).toBeNull();
  });
});
