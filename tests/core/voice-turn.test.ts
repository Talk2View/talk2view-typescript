import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { T2VSession } from '../../src/sessions';
import type { T2VClient } from '../../src/client';
import type { T2VTools } from '../../src/tools';
import type { ChatCompletionChunk, HumanDecision, PermissionCheckResult } from '../../src/types';
import {
  ALREADY_WORKING,
  NO_TEXT,
  TURN_FAILED,
  VoiceTurnRunner,
  normaliseRequest,
  type VoiceTurnDeps,
} from '../../src/voice-turn';

/** Helper: build an SSE chunk with an interrupt payload. */
function interruptChunk(toolName: string, toolCallId: string, args: Record<string, unknown>): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    thread_id: 'thread_1',
    interrupt: { type: 'tool_call', tool_name: toolName, tool_call_id: toolCallId, arguments: args },
  };
}

/** Helper: build an SSE chunk with text content. */
function textChunk(content: string): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    thread_id: 'thread_1',
  };
}

/** Helper: build a stop chunk. */
function stopChunk(): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    thread_id: 'thread_1',
  };
}

/** Helper: build the engine's error chunk, its message mirrored into the text as the engine sends it. */
function errorChunk(type: string, message: string): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content: message }, finish_reason: 'stop' }],
    thread_id: 'thread_1',
    error: { type, message },
  };
}

function createMockTools(overrides: Partial<T2VTools> = {}): T2VTools {
  return {
    hasHandler: vi.fn().mockReturnValue(false),
    checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
    getDescription: vi.fn().mockReturnValue(''),
    executeToolCall: vi.fn().mockResolvedValue({ result: 'ok', isError: false }),
    ...overrides,
  } as unknown as T2VTools;
}

/** One stream request's reply: its chunks, or a generator for a reply that waits or fails. */
type Stream = ChatCompletionChunk[] | (() => AsyncGenerator<ChatCompletionChunk>);

function createMockClient(streams: Stream[]): T2VClient {
  let callIndex = 0;
  return {
    streamRequest: vi.fn().mockImplementation(async function* () {
      const stream = streams[callIndex++] ?? [];
      if (typeof stream === 'function') yield* stream();
      else for (const c of stream) yield c;
    }),
  } as unknown as T2VClient;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

let gate: Deferred<void>;

/** A reply held back until the test calls `gate.resolve()`: it keeps a turn in flight. */
function gated(...chunks: ChatCompletionChunk[]): Stream {
  return async function* () {
    await gate.promise;
    for (const c of chunks) yield c;
  };
}

/** A request that fails, as a dropped connection does. */
const failing: Stream = async function* () {
  throw new Error('network down');
};

let tools: T2VTools;
let streamRequest: Mock;
let runner: VoiceTurnRunner;
let states: string[];
let onApproval: Mock<VoiceTurnDeps['onApproval']>;
let onBudgetExceeded: Mock<VoiceTurnDeps['onBudgetExceeded']>;

/** The body of the `i`-th stream request. */
function body(i: number): Record<string, unknown> {
  return streamRequest.mock.calls[i]![1];
}

/**
 * A runner on a chat session with the mint's session id, whose stream
 * requests get `streams` in order. A client tool call is checked against
 * `permission`.
 */
function setup(
  streams: Stream[],
  {
    deps = {},
    permission = { action: 'allow' },
  }: { deps?: Partial<VoiceTurnDeps>; permission?: PermissionCheckResult | Promise<PermissionCheckResult> } = {},
): void {
  const client = createMockClient(streams);
  streamRequest = client.streamRequest as Mock;
  tools = createMockTools({ checkPermission: vi.fn(async () => permission) });
  const session = new T2VSession({ session_id: 's_mint', thread_id: '', model: '' }, client, tools);
  states = [];
  onApproval = vi.fn<VoiceTurnDeps['onApproval']>();
  onBudgetExceeded = vi.fn<VoiceTurnDeps['onBudgetExceeded']>();
  runner = new VoiceTurnRunner({
    session,
    pagePrompt: 'Page',
    onApproval,
    isAlwaysAllowed: () => false,
    onState: (state) => states.push(state),
    onBudgetExceeded,
    ...deps,
  });
}

/** The engine calls `send` with `{ to: 'a' }`, a client tool that needs the end-user's go-ahead; the resume stops. */
function setupSend(deps: Partial<VoiceTurnDeps> = {}): void {
  setup([[interruptChunk('send', 'c1', { to: 'a' })], [stopChunk()]], { deps, permission: { action: 'require_approval' } });
}

beforeEach(() => {
  gate = deferred<void>();
});

describe('VoiceTurnRunner', () => {
  it('runs a turn with surface voice and no history', async () => {
    setup([[textChunk('Done, it is blue.'), stopChunk()]]);
    await expect(runner.ask('paint it blue')).resolves.toBe('Done, it is blue.');
    expect(body(0)).toEqual({
      messages: [{ role: 'system', content: 'Page' }, { role: 'user', content: 'paint it blue' }],
      stream: true,
      model: undefined,
      surface: 'voice',
      supports_approval: false,
      supports_tool_events: false,
    });
    expect(states).toEqual(['working', 'idle']);
  });

  it('turns run on the session for the mint’s session id', async () => {
    setup([[textChunk('Done, it is blue.'), stopChunk()]]);
    await runner.ask('paint it blue');
    expect(streamRequest.mock.calls[0]![0]).toBe('/v1/sessions/s_mint/messages');
  });

  it('identical in-flight request answers already_working', async () => {
    setup([gated(textChunk('Blue.'), stopChunk())]);
    const first = runner.ask('Paint it blue?'); // gated
    await expect(runner.ask('  paint it BLUE! ')).resolves.toBe(ALREADY_WORKING);
    expect(runner.busy).toBe(true);
    gate.resolve();
    await first;
    expect(streamRequest).toHaveBeenCalledTimes(1);
  });

  it('different request waits its turn', async () => {
    setup([gated(textChunk('A.'), stopChunk()), [textChunk('B.'), stopChunk()]]);
    const first = runner.ask('a');
    const second = runner.ask('b'); // one streamRequest call until the gate opens
    expect(streamRequest).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
    await second;
    expect(streamRequest.mock.calls[1]![1].messages.at(-1)).toEqual({ role: 'user', content: 'b' });
    expect(states).toEqual(['working', 'idle', 'working', 'idle']);
  });

  it('approval card decides and resumes', async () => {
    setupSend();
    onApproval.mockResolvedValue({ decision: { action: 'once' } });
    await runner.ask('send it');
    expect(onApproval).toHaveBeenCalledWith('c1', 'send', { to: 'a' });
    expect(body(1)).toEqual({
      tool_call_id: 'c1',
      result: 'ok',
      is_error: false,
      surface: 'voice',
      supports_approval: false,
      supports_tool_events: false,
    });
  });

  it('an approval card that closed unanswered resumes with the reason', async () => {
    setupSend();
    onApproval.mockResolvedValue({ decision: { action: 'deny' }, endedBecause: 'The call ended' });
    await runner.ask('send it');
    expect(body(1)).toEqual({
      tool_call_id: 'c1',
      result: '{"error":"The call ended"}',
      is_error: true,
      surface: 'voice',
      supports_approval: false,
      supports_tool_events: false,
    });
    expect(onApproval).toHaveBeenCalledOnce();
    expect(tools.executeToolCall).not.toHaveBeenCalled();
  });

  it('always allowed skips the card', async () => {
    setupSend({ isAlwaysAllowed: () => true });
    await runner.ask('send it');
    expect(onApproval).not.toHaveBeenCalled();
    expect(tools.executeToolCall).toHaveBeenCalledWith('send', { to: 'a' });
  });

  it('a resumed stream can raise another approval, and the text adds up across the resumes', async () => {
    setup(
      [
        [textChunk('Sending both. '), interruptChunk('send', 'c1', { to: 'a' })],
        [interruptChunk('send', 'c2', { to: 'b' })],
        [textChunk('Both sent.'), stopChunk()],
      ],
      { permission: { action: 'require_approval' } },
    );
    onApproval.mockResolvedValue({ decision: { action: 'once' } });
    await expect(runner.ask('send both')).resolves.toBe('Sending both. Both sent.');
    expect(onApproval.mock.calls.map(([toolCallId]) => toolCallId)).toEqual(['c1', 'c2']);
    expect(body(2)).toMatchObject({ tool_call_id: 'c2', result: 'ok', is_error: false, surface: 'voice' });
  });

  it('budget_exceeded error triggers the callback', async () => {
    setup([[errorChunk('budget_exceeded', 'Out of credit')]]);
    await expect(runner.ask('x')).resolves.toBe('error: Out of credit');
    expect(onBudgetExceeded).toHaveBeenCalledOnce();
  });

  it('any other engine error answers with its message, over the text so far, and leaves the budget alone', async () => {
    setup([[textChunk('Half an answer'), errorChunk('ValidationError', 'An error occurred. Please try again.')]]);
    await expect(runner.ask('x')).resolves.toBe('error: An error occurred. Please try again.');
    expect(onBudgetExceeded).not.toHaveBeenCalled();
  });

  it('a turn without text answers NO_TEXT', async () => {
    setup([[textChunk(' \n '), stopChunk()]]);
    await expect(runner.ask('do it quietly')).resolves.toBe(NO_TEXT);
  });

  it('a stream that throws answers TURN_FAILED, and the next request still runs', async () => {
    setup([failing, [textChunk('Back again.'), stopChunk()]]);
    await expect(runner.ask('x')).resolves.toBe(TURN_FAILED);
    expect(states).toEqual(['working', 'idle']);
    await expect(runner.ask('x')).resolves.toBe('Back again.');
    expect(runner.busy).toBe(false);
  });

  it('abort resolves the in-flight and queued asks with the reason', async () => {
    setup([gated(textChunk('A.'), stopChunk()), [textChunk('B.'), stopChunk()]]);
    const a = runner.ask('a'); // gated
    const b = runner.ask('b');
    runner.abort('NOTICE');
    await expect(a).resolves.toBe('NOTICE');
    await expect(b).resolves.toBe('NOTICE');
    expect(streamRequest.mock.calls[0]![2].aborted).toBe(true); // the in-flight signal
    await expect(runner.ask('c')).resolves.toBe('NOTICE');
    expect(runner.busy).toBe(false);
  });

  it('once aborted, a queued request never reaches the engine', async () => {
    setup([gated(textChunk('A.'), stopChunk()), [textChunk('B.'), stopChunk()]]);
    const a = runner.ask('a');
    const b = runner.ask('b');
    runner.abort('NOTICE');
    gate.resolve(); // the aborted turn's reply still arrives
    await a;
    await b;
    await tick();
    expect(streamRequest).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['working', 'idle']);
  });

  it('an abort while the card is open runs no tool and sends no resume', async () => {
    setupSend();
    const card = deferred<{ decision: HumanDecision; endedBecause?: string }>();
    onApproval.mockReturnValue(card.promise);
    const asked = runner.ask('send it');
    await vi.waitFor(() => expect(onApproval).toHaveBeenCalledOnce());
    runner.abort('NOTICE');
    card.resolve({ decision: { action: 'once' } });
    await expect(asked).resolves.toBe('NOTICE');
    await tick();
    expect(tools.executeToolCall).not.toHaveBeenCalled();
    expect(streamRequest).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['working', 'idle']);
  });

  it.each([false, true])(
    'an abort during the permission check opens no card and runs no tool (always allowed: %s)',
    async (always) => {
      const permission = deferred<PermissionCheckResult>();
      setup([[interruptChunk('send', 'c1', { to: 'a' })], [stopChunk()]], {
        deps: { isAlwaysAllowed: () => always },
        permission: permission.promise,
      });
      const asked = runner.ask('send it');
      await vi.waitFor(() => expect(tools.checkPermission).toHaveBeenCalledOnce());
      runner.abort('NOTICE');
      permission.resolve({ action: 'require_approval' });
      await expect(asked).resolves.toBe('NOTICE');
      await tick();
      expect(onApproval).not.toHaveBeenCalled();
      expect(tools.executeToolCall).not.toHaveBeenCalled();
      expect(streamRequest).toHaveBeenCalledTimes(1);
    },
  );

  it('answers in the words the agent is given', () => {
    expect(ALREADY_WORKING).toBe('status: already_working (still on the previous request)');
    expect(NO_TEXT).toBe('(the agent returned no text)');
    expect(TURN_FAILED).toBe('error: I couldn’t reach the assistant just now.');
  });
});

describe('normaliseRequest', () => {
  it('lower-cases, collapses whitespace and drops trailing ?.! and spaces, as the voice service does', () => {
    expect(normaliseRequest('  Paint\n it\t BLUE?! ')).toBe('paint it blue');
    expect(normaliseRequest('What? Now. ')).toBe('what? now');
    expect(normaliseRequest(' ?! ')).toBe('');
  });
});
