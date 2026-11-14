/**
 * The client sends `reasoning_effort` next to `model` only when a caller or the
 * config names one, keeps it for Retry, and forgets it with the conversation.
 */
import { beforeEach, expect, it, vi } from 'vitest';
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
