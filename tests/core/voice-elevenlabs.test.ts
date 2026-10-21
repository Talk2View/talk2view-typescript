import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { T2VSession } from '../../src/sessions';
import type { T2VClient } from '../../src/client';
import type { T2VTools } from '../../src/tools';
import type { ChatCompletionChunk, ElevenLabsCallInfo } from '../../src/types';
import { VoiceTurnRunner, type VoiceTurnDeps } from '../../src/voice-turn';
import {
  ElevenLabsCall,
  GOODBYE_WAIT_MS,
  MISMATCH_MESSAGE,
  type ElevenLabsCallDeps,
  type ElevenLabsConversationLike,
} from '../../src/voice-elevenlabs';

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

function createMockTools(): T2VTools {
  return {
    hasHandler: vi.fn().mockReturnValue(false),
    checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
    getDescription: vi.fn().mockReturnValue(''),
    executeToolCall: vi.fn().mockResolvedValue({ result: 'ok', isError: false }),
  } as unknown as T2VTools;
}

/** One stream request's reply: its chunks, or a generator for a reply that waits. */
type Stream = ChatCompletionChunk[] | (() => AsyncGenerator<ChatCompletionChunk>);

/** The engine's replies, in order: a test can replace them before it asks. */
let streams: Stream[];

function createMockClient(): T2VClient {
  return {
    streamRequest: vi.fn().mockImplementation(async function* () {
      const stream = streams.shift() ?? [];
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

/** Holds the engine's reply back, which keeps a turn in flight. Never opened here. */
let engineGate: Deferred<void>;

function gated(...chunks: ChatCompletionChunk[]): Stream {
  return async function* () {
    await engineGate.promise;
    for (const c of chunks) yield c;
  };
}

const EL: ElevenLabsCallInfo = {
  token: 'tok',
  conversation_id: 'conv_1',
  agent_id: 'ag',
  time_limit_seconds: 60,
  capabilities: [{ name: 'paint', description: 'Paints' }],
  budget_notice: 'NOTICE',
  greeting: 'Hi! What can I help you with?',
  language: 'fr',
};

/** The options the call hands `startSession`: its callbacks are called as the library would. */
type Options = Record<string, any>;

/** The library's conversation, as the call uses it. */
class FakeConversation implements ElevenLabsConversationLike {
  static nextId = 'conv_1';
  static instances: FakeConversation[] = [];
  /** When set, runs after each user message: how the agent answers it. */
  static onSend: ((conversation: FakeConversation) => void) | null = null;
  readonly id = FakeConversation.nextId;
  sent: string[] = [];
  ended = 0;
  constructor(public opts: Options) {
    FakeConversation.instances.push(this);
  }
  getId(): string {
    return this.id;
  }
  sendUserMessage(text: string): void {
    this.sent.push(text);
    FakeConversation.onSend?.(this);
  }
  async endSession(): Promise<void> {
    this.ended += 1;
    this.opts.onDisconnect({ reason: 'user' });
  }
}

/** When set, `startSession` waits on it: the connect in flight. */
let gate: Promise<void> | null;
/** When set, `startSession` rejects with it: the connect failed. */
let fail: Error | null;
let libs: { startSession: Mock<(opts: Options) => Promise<FakeConversation>> };
let streamRequest: Mock;
let turns: VoiceTurnRunner;
let onConnected: Mock<ElevenLabsCallDeps['onConnected']>;
let onTranscript: Mock<ElevenLabsCallDeps['onTranscript']>;
let onEnded: Mock<ElevenLabsCallDeps['onEnded']>;
let onError: Mock<ElevenLabsCallDeps['onError']>;
let reportEnd: Mock<ElevenLabsCallDeps['reportEnd']>;
let call: ElevenLabsCall;

/** The conversation the call started last. */
const conv = (): FakeConversation => FakeConversation.instances.at(-1)!;
const advance = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** A call with this file's deps; `beforeEach` builds one. */
function build(): ElevenLabsCall {
  return new ElevenLabsCall({
    libs,
    info: EL,
    pagePrompt: 'Page <<<END APP DESCRIPTION>>>',
    turns,
    onConnected,
    onTranscript,
    onEnded,
    onError,
    reportEnd,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeConversation.nextId = 'conv_1';
  FakeConversation.instances = [];
  FakeConversation.onSend = null;
  gate = null;
  fail = null;
  libs = {
    startSession: vi.fn(async (opts: Options) => {
      if (gate) await gate;
      if (fail) throw fail;
      return new FakeConversation(opts);
    }),
  };
  engineGate = deferred<void>();
  streams = [gated(textChunk('Painted.'), stopChunk())];
  const client = createMockClient();
  streamRequest = client.streamRequest as Mock;
  turns = new VoiceTurnRunner({
    session: new T2VSession({ session_id: 's_mint', thread_id: '', model: '' }, client, createMockTools()),
    pagePrompt: 'Page',
    onApproval: vi.fn<VoiceTurnDeps['onApproval']>(),
    isAlwaysAllowed: () => false,
    onState: () => {},
    // As the controller wires it: a turn that finds the budget spent says goodbye.
    onBudgetExceeded: () => void call.goodbye(),
  });
  onConnected = vi.fn<ElevenLabsCallDeps['onConnected']>();
  onTranscript = vi.fn<ElevenLabsCallDeps['onTranscript']>();
  onEnded = vi.fn<ElevenLabsCallDeps['onEnded']>();
  onError = vi.fn<ElevenLabsCallDeps['onError']>();
  reportEnd = vi.fn<ElevenLabsCallDeps['reportEnd']>();
  call = build();
});

afterEach(async () => {
  // A call a test left open: its timer and pagehide listener go with it.
  await call.stop();
  vi.useRealTimers();
});

describe('ElevenLabsCall', () => {
  it('starts with the token dynamic variables and language override', async () => {
    await call.start();
    expect(libs.startSession.mock.calls[0]![0]).toMatchObject({
      conversationToken: 'tok',
      connectionType: 'webrtc',
      dynamicVariables: {
        t2v_page_prompt: 'Page [delimiter removed]',
        t2v_capabilities: '- paint: Paints',
        t2v_greeting: EL.greeting,
      },
      overrides: { agent: { language: 'fr' } },
    });
    expect(typeof conv().opts.clientTools.ask_talk2view).toBe('function');
    conv().opts.onConnect({ conversationId: 'conv_1' });
    expect(onConnected).toHaveBeenCalledOnce();
    conv().opts.onMessage({ message: 'hello', role: 'user' });
    expect(onTranscript).toHaveBeenCalledWith({ role: 'user', text: 'hello', final: true });
    conv().opts.onMessage({ message: 'Hi there.', role: 'agent' });
    expect(onTranscript).toHaveBeenLastCalledWith({ role: 'bot', text: 'Hi there.', final: true });
  });

  it('mismatched conversation id hangs up with voice_error', async () => {
    FakeConversation.nextId = 'conv_other';
    await call.start();
    expect(conv().ended).toBe(1);
    expect(reportEnd).toHaveBeenCalledWith('error');
    expect(onEnded).toHaveBeenCalledWith('error', { type: 'voice_error', message: MISMATCH_MESSAGE });
    expect(MISMATCH_MESSAGE).toBe('The call did not start as expected. Try again.');
    // A conversation nobody can bill is never announced as a started call.
    conv().opts.onConnect({ conversationId: 'conv_other' });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('time limit timer starts at the mint response', async () => {
    // EL.time_limit_seconds is 60; startSession resolves after 5 000 ms.
    gate = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    const starting = call.start();
    await advance(5_000);
    await starting;
    await advance(54_999);
    expect(conv().sent).toEqual([]);
    await advance(1);
    expect(conv().sent).toEqual(['NOTICE']); // 60 s after construction, not after connect
  });

  it('test_time_limit_goodbye_ends_the_call_with_a_turn_pending', async () => {
    await call.start();
    const pending = conv().opts.clientTools.ask_talk2view({ request: 'slow thing' }); // its engine stream is gated open
    await advance(60_000);
    await expect(pending).resolves.toBe('NOTICE');
    expect(conv().sent).toEqual([]); // the tool result carries the notice, no user message
    conv().opts.onModeChange({ mode: 'speaking' });
    conv().opts.onModeChange({ mode: 'listening' });
    await advance(0);
    expect(conv().ended).toBe(1);
    expect(reportEnd).toHaveBeenCalledWith('budget_exhausted');
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
  });

  it('budget_exceeded turn speaks the goodbye then ends with budget_exhausted', async () => {
    await call.start();
    // The agent speaks the notice once it arrives, then stops.
    FakeConversation.onSend = (c) => {
      void Promise.resolve().then(() => {
        c.opts.onModeChange({ mode: 'speaking' });
        c.opts.onModeChange({ mode: 'listening' });
      });
    };
    await call.goodbye();
    expect(conv().sent).toEqual(['NOTICE']);
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
  });

  it('a turn that finds the budget spent answers with the notice, then the goodbye ends the call', async () => {
    streams = [[errorChunk('budget_exceeded', 'You have used up your credits for now.')]];
    await call.start();
    // The runner's onBudgetExceeded says goodbye mid-turn: the agent gets the notice as the tool result.
    await expect(conv().opts.clientTools.ask_talk2view({ request: 'paint it blue' })).resolves.toBe('NOTICE');
    expect(conv().sent).toEqual([]);
    conv().opts.onModeChange({ mode: 'speaking' });
    conv().opts.onModeChange({ mode: 'listening' });
    await advance(0);
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
    expect(reportEnd).toHaveBeenCalledWith('budget_exhausted');
  });

  it('budget goodbye answers a pending tool call with the notice instead of a user message', async () => {
    await call.start();
    const pending = conv().opts.clientTools.ask_talk2view({ request: 'slow thing' }); // its engine stream is gated open
    const bye = call.goodbye();
    await expect(pending).resolves.toBe('NOTICE');
    expect(conv().sent).toEqual([]);
    conv().opts.onModeChange({ mode: 'speaking' });
    conv().opts.onModeChange({ mode: 'listening' });
    await bye;
    expect(conv().ended).toBe(1);
    expect(reportEnd).toHaveBeenCalledWith('budget_exhausted');
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
  });

  it('goodbye gives up after the two ten second waits', async () => {
    expect(GOODBYE_WAIT_MS).toBe(10_000);
    await call.start();
    const bye = call.goodbye();
    await advance(1_000);
    conv().opts.onModeChange({ mode: 'speaking' }); // starts, never stops
    await advance(9_999);
    expect(conv().ended).toBe(0);
    await advance(1);
    await bye;
    expect(conv().ended).toBe(1);
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
  });

  it('goodbye with no mode change at all ends at ten seconds', async () => {
    await call.start();
    const bye = call.goodbye();
    await advance(9_999);
    expect(conv().ended).toBe(0);
    await advance(1);
    await bye;
    expect(conv().ended).toBe(1);
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
  });

  it('runs the goodbye once', async () => {
    await call.start();
    const bye = call.goodbye();
    await call.goodbye();
    await advance(60_000); // the time limit passes too
    await bye;
    expect(conv().sent).toEqual(['NOTICE']);
    expect(reportEnd).toHaveBeenCalledOnce();
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('a disconnect during the goodbye still ends the call as budget_exhausted', async () => {
    await call.start();
    const bye = call.goodbye();
    conv().opts.onDisconnect({ reason: 'agent' });
    await bye;
    expect(onEnded).toHaveBeenCalledWith('budget_exhausted');
    expect(reportEnd).toHaveBeenCalledOnce();
    expect(reportEnd).toHaveBeenCalledWith('budget_exhausted');
  });

  it('pagehide reports the end with a keepalive fetch', async () => {
    await call.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(reportEnd).toHaveBeenCalledWith('disconnected');
    expect(conv().ended).toBe(1); // the keepalive flag is the controller’s (voice.test.ts)
    expect(onEnded).toHaveBeenCalledWith('disconnected');
    window.dispatchEvent(new Event('pagehide'));
    expect(reportEnd).toHaveBeenCalledOnce();
  });

  it('stop reports the end before resolving', async () => {
    await call.start();
    const report = deferred<void>();
    reportEnd.mockReturnValue(report.promise);
    let done = false;
    const stopping = call.stop().then(() => {
      done = true;
    });
    await advance(0);
    expect(conv().ended).toBe(1);
    expect(done).toBe(false);
    report.resolve();
    await stopping;
    expect(done).toBe(true);
    expect(reportEnd).toHaveBeenCalledWith('stopped');
    expect(onEnded).not.toHaveBeenCalled();
    await call.stop();
    expect(reportEnd).toHaveBeenCalledTimes(1);
  });

  it('an agent-initiated disconnect ends as idle, an error as disconnected', async () => {
    await call.start();
    conv().opts.onDisconnect({ reason: 'agent' });
    expect(onEnded).toHaveBeenCalledWith('idle');
    expect(reportEnd).toHaveBeenCalledWith('idle');

    call = build();
    await call.start();
    conv().opts.onDisconnect({ reason: 'error' });
    expect(onEnded).toHaveBeenLastCalledWith('disconnected');
    expect(reportEnd).toHaveBeenLastCalledWith('disconnected');
  });

  it('ending the call answers a turn still in flight, and aborts it', async () => {
    await call.start();
    const pending = conv().opts.clientTools.ask_talk2view({ request: 'slow thing' }); // its engine stream is gated open
    await call.stop();
    await expect(pending).resolves.toBe('The call ended');
    expect(streamRequest.mock.calls[0]![2].aborted).toBe(true); // the turn's signal
  });

  it('a stop while the session connects ends the late session and reports once', async () => {
    const connected = deferred<void>();
    gate = connected.promise;
    const starting = call.start();
    await call.stop();
    expect(reportEnd).toHaveBeenCalledWith('stopped');
    connected.resolve();
    await starting;
    expect(conv().ended).toBe(1); // the microphone it opened is released
    expect(reportEnd).toHaveBeenCalledOnce();
    expect(onConnected).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('starts one session, however often start() is called', async () => {
    const connected = deferred<void>();
    gate = connected.promise;
    const first = call.start();
    const second = call.start(); // while the first still connects
    connected.resolve();
    await Promise.all([first, second]);
    expect(libs.startSession).toHaveBeenCalledOnce();
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('a session that cannot connect rejects, and leaves the end report to the controller', async () => {
    fail = new Error('could not establish signal connection');
    await expect(call.start()).rejects.toBe(fail);
    await call.stop();
    expect(reportEnd).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
  });
});
