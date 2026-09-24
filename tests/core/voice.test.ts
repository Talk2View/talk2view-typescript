import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { T2VVoiceController as T2VVoice, type T2VVoiceDeps, type VoiceLibs } from '../../src/voice.js';
import type { PermissionCheckResult, VoiceState } from '../../src/types.js';

type Callbacks = Record<string, (...args: any[]) => void>;

class FakeTransport {
  /** Mirrors the 1.10.8 transport's public retry field (default 3). */
  maxReconnectionAttempts = 3;
  constructor(public opts: { iceServers: RTCIceServer[] }) {}
}

class FakePipecatClient {
  static instances: FakePipecatClient[] = [];
  sent: Array<{ type: string; data: unknown }> = [];
  connectParams: any;
  disconnected = 0;
  /** Hang-ups that landed before the devices were ready, and so did nothing. */
  ignoredDisconnects = 0;
  /** True from a completed connect() until an effective disconnect(): the mic is streaming. */
  live = false;
  private devicesReady = false;
  private aborted = false;
  static failConnectWith: Error | null = null;
  /**
   * When set, connect() waits on it first: `initDevices()`, the browser's
   * microphone prompt. Like the pinned client-js 1.13.1, that runs BEFORE
   * `Transport.connect()` creates its AbortController or peer connection, so a
   * disconnect() in that window finds nothing to cancel.
   */
  static deviceGate: Promise<void> | null = null;
  /** When set, connect() waits on it after the devices (a slow ICE/offer exchange). */
  static connectGate: Promise<void> | null = null;
  /** When set, connect() resolves only after it, past onConnected (the bot's ready signal). */
  static botReadyGate: Promise<void> | null = null;
  retriesDuringConnect: number | undefined;
  constructor(public opts: { transport: unknown; enableMic: boolean; enableCam: boolean; callbacks: Callbacks }) {
    FakePipecatClient.instances.push(this);
  }
  get callbacks(): Callbacks {
    return this.opts.callbacks;
  }
  async connect(params: unknown): Promise<void> {
    this.connectParams = params;
    this.retriesDuringConnect = (this.opts.transport as FakeTransport).maxReconnectionAttempts;
    if (FakePipecatClient.deviceGate) await FakePipecatClient.deviceGate;
    this.devicesReady = true;
    if (FakePipecatClient.connectGate) await FakePipecatClient.connectGate;
    if (FakePipecatClient.failConnectWith) {
      // Like the real transport: stop(error) fires onDisconnected, then connect() rejects.
      this.callbacks.onDisconnected?.();
      throw FakePipecatClient.failConnectWith;
    }
    // Aborted mid-offer: the transport's _connect() returns without connecting.
    if (this.aborted) return;
    this.live = true;
    this.callbacks.onConnected?.();
    if (FakePipecatClient.botReadyGate) await FakePipecatClient.botReadyGate;
  }
  async disconnect(): Promise<void> {
    if (!this.devicesReady) {
      // No transport session yet: the real stop() returns early, nothing is cancelled.
      this.ignoredDisconnects += 1;
      return;
    }
    this.aborted = true;
    this.disconnected += 1;
    this.live = false;
    this.callbacks.onDisconnected?.();
  }
  sendClientMessage(type: string, data?: unknown): void {
    this.sent.push({ type, data });
  }
  server(msg: unknown): Promise<void> {
    this.callbacks.onServerMessage?.(msg);
    return new Promise((r) => setTimeout(r, 0));
  }
}

const MINT = {
  ticket: 't'.repeat(43),
  voice_url: 'https://engine.test/v1/voice/offer',
  session_id: 's1',
  ice_servers: [{ urls: ['stun:stun.test:3478'] }, { urls: ['turn:t.test'], username: 'u', credential: 'c' }],
  expires_in: 60,
  model: 'gemini-3.8-live',
};

function world(overrides: Partial<T2VVoiceDeps> = {}) {
  FakePipecatClient.instances = [];
  FakePipecatClient.failConnectWith = null;
  FakePipecatClient.connectGate = null;
  FakePipecatClient.deviceGate = null;
  FakePipecatClient.botReadyGate = null;
  const libs: VoiceLibs = { PipecatClient: FakePipecatClient as any, SmallWebRTCTransport: FakeTransport as any };
  const permission: { result: PermissionCheckResult } = { result: { action: 'allow' } };
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: T2VVoiceDeps = {
    request: vi.fn(async () => MINT) as unknown as T2VVoiceDeps['request'],
    ensureSession: vi.fn(async () => true),
    getValidAccessToken: vi.fn(async () => 'jwt-1'),
    tools: {
      checkPermission: vi.fn(async () => permission.result),
      executeToolCall: vi.fn(async (name: string, args: Record<string, unknown>) => {
        executed.push({ name, args });
        return { result: '{"ok":true}', isError: false };
      }),
      getDescription: () => 'Changes the page background',
    } as unknown as T2VVoiceDeps['tools'],
    partnerKey: 'pk_test_x',
    loadLibs: async () => libs,
    attachAudio: vi.fn(),
    approvalTimeoutMs: 30,
    ...overrides,
  };
  const voice = new T2VVoice(deps);
  const states: VoiceState[] = [];
  voice.on('stateChange', (s) => states.push(s));
  return { voice, deps, states, permission, executed, client: () => FakePipecatClient.instances[0]! };
}

describe('T2VVoice.start', () => {
  it('mints, lazy-loads, connects with the ticket and credentials, and listens', async () => {
    const w = world();
    await w.voice.start();
    expect(w.deps.ensureSession).toHaveBeenCalledOnce();
    expect(w.deps.request).toHaveBeenCalledWith('/v1/voice/sessions', { method: 'POST' });
    const c = w.client();
    expect((c.opts.transport as FakeTransport).opts.iceServers).toEqual([
      { urls: ['stun:stun.test:3478'] },
      { urls: ['turn:t.test'], username: 'u', credential: 'c' },
    ]);
    expect(c.opts.enableMic).toBe(true);
    expect(c.connectParams).toEqual({
      webrtcRequestParams: {
        endpoint: MINT.voice_url,
        requestData: { ticket: MINT.ticket, partner_key: 'pk_test_x', access_token: 'jwt-1' },
      },
    });
    expect(w.states).toEqual(['connecting', 'listening']);
    expect(w.voice.state).toBe('listening');
  });

  it('is a no-op while connecting or listening', async () => {
    const w = world();
    await w.voice.start();
    await w.voice.start();
    expect(w.deps.request).toHaveBeenCalledTimes(1);
  });

  it('test_start_surfaces_engine_error_types', async () => {
    const err = Object.assign(new Error('Voice is not enabled'), { type: 'voice_disabled' });
    const w = world({ request: vi.fn(async () => { throw err; }) as unknown as T2VVoiceDeps['request'] });
    const errors: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    await expect(w.voice.start()).rejects.toBe(err);
    expect(errors).toEqual([{ type: 'voice_disabled', message: 'Voice is not enabled' }]);
    expect(w.voice.state).toBe('error');
    expect(FakePipecatClient.instances).toHaveLength(0);
  });

  it('refuses without a session or a token', async () => {
    const a = world({ ensureSession: vi.fn(async () => false) });
    await expect(a.voice.start()).rejects.toMatchObject({ type: 'account_required' });
    const b = world({ getValidAccessToken: vi.fn(async () => null) });
    await expect(b.voice.start()).rejects.toMatchObject({ type: 'auth_expired' });
  });

  it('a failed connect cleans up and reports transport_error, never an ending', async () => {
    const w = world();
    const log: unknown[] = [];
    w.voice.on('stateChange', (s) => log.push(['state', s]));
    w.voice.on('error', (e) => log.push(['error', e]));
    w.voice.on('ended', (r) => log.push(['ended', r]));
    FakePipecatClient.failConnectWith = new Error('ICE failed');
    await expect(w.voice.start()).rejects.toMatchObject({ type: 'transport_error', message: 'ICE failed' });
    expect(log).toEqual([
      ['state', 'connecting'],
      ['error', { type: 'transport_error', message: 'ICE failed' }],
      ['state', 'error'],
    ]);
    expect(w.voice.state).toBe('error');
    expect(w.client().disconnected).toBe(1);
  });

  it('allows no offer retries until connected, then restores them', async () => {
    const w = world();
    await w.voice.start();
    expect(w.client().retriesDuringConnect).toBe(0);
    expect((w.client().opts.transport as FakeTransport).maxReconnectionAttempts).toBe(3);
  });

  it('attaches the bot audio track, never the local one', async () => {
    const w = world();
    await w.voice.start();
    const track = { kind: 'audio' } as MediaStreamTrack;
    w.client().callbacks.onTrackStarted?.(track, { local: true });
    w.client().callbacks.onTrackStarted?.(track, { local: false });
    expect(w.deps.attachAudio).toHaveBeenCalledTimes(1);
  });
});

describe('T2VVoice.stop and endings', () => {
  it('stop disconnects and ends with "stopped"', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    await w.voice.stop();
    expect(w.client().disconnected).toBe(1);
    expect(ended).toEqual(['stopped']);
    expect(w.voice.state).toBe('ended');
    await w.voice.stop(); // idempotent
  });

  it('a server-side end is surfaced with its reason', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    await w.client().server({ type: 't2v-call-ended', reason: 'session_cap' });
    expect(ended).toEqual(['session_cap']);
    expect(w.voice.state).toBe('ended');
  });

  it('test_call_ended_budget_maps_to_error', async () => {
    const w = world();
    const errors: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    await w.voice.start();
    await w.client().server({ type: 't2v-call-ended', reason: 'budget_exhausted' });
    expect(errors).toEqual([{ type: 'insufficient_credit', message: expect.stringMatching(/credit/i) }]);
  });

  it('can start again after an end', async () => {
    const w = world();
    await w.voice.start();
    await w.voice.stop();
    await w.voice.start();
    expect(FakePipecatClient.instances).toHaveLength(2);
    expect(w.voice.state).toBe('listening');
  });
});

describe('bundle boundary', () => {
  it('imports the Pipecat client libraries only through import()', () => {
    const source = readFileSync(join(process.cwd(), 'src/voice.ts'), 'utf8');
    expect(source).not.toMatch(/^import .* from '@pipecat-ai/m);
    expect(source).toMatch(/import\('@pipecat-ai\/client-js'\)/);
    expect(source).toMatch(/import\('@pipecat-ai\/small-webrtc-transport'\)/);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('stop() during start()', () => {
  it('during the mint: never connects, ends "stopped"', async () => {
    const mint = deferred<typeof MINT>();
    const w = world({ request: vi.fn(() => mint.promise) as unknown as T2VVoiceDeps['request'] });
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    mint.resolve(MINT);
    await starting;
    expect(FakePipecatClient.instances).toHaveLength(0);
    expect(w.voice.state).toBe('ended');
    expect(w.states).toEqual(['connecting', 'ended']);
    expect(ended).toEqual(['stopped']);
  });

  it('during the library load: never connects, ends "stopped"', async () => {
    const libs = deferred<VoiceLibs>();
    const w = world({ loadLibs: () => libs.promise });
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    libs.resolve({ PipecatClient: FakePipecatClient as any, SmallWebRTCTransport: FakeTransport as any });
    await starting;
    expect(FakePipecatClient.instances).toHaveLength(0);
    expect(w.deps.request).not.toHaveBeenCalled(); // no ticket was minted for it
    expect(w.voice.state).toBe('ended');
  });

  it('during the offer exchange: disconnects the client and never listens', async () => {
    const w = world();
    const gate = deferred<void>();
    FakePipecatClient.connectGate = gate.promise; // devices are ready; the offer is in flight
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    const starting = w.voice.start();
    await tick();
    expect(FakePipecatClient.instances).toHaveLength(1);
    await w.voice.stop();
    await starting; // resolves although connect() is still pending
    expect(w.client().disconnected).toBe(1);
    expect(w.voice.state).toBe('ended');
    gate.resolve(); // the transport finishes late: its onConnected is stale
    await tick();
    expect(w.client().live).toBe(false);
    expect(w.voice.state).toBe('ended');
    expect(w.states).toEqual(['connecting', 'ended']);
    expect(ended).toEqual(['stopped']);
  });

  it('during the microphone prompt: the hang-up lands once the late connect completes', async () => {
    const w = world();
    const prompt = deferred<void>();
    FakePipecatClient.deviceGate = prompt.promise; // the browser is asking for the mic
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    await starting;
    // Before initDevices() finishes there is nothing to cancel: that disconnect was a no-op.
    expect(w.client().ignoredDisconnects).toBe(1);
    expect(w.voice.state).toBe('ended');
    prompt.resolve(); // the user clicks Allow: connect() carries on and the call comes up
    await tick();
    await tick();
    // ...and is hung up as soon as it does. The mic is not left streaming.
    expect(w.client().live).toBe(false);
    expect(w.client().disconnected).toBeGreaterThanOrEqual(1);
    expect(w.voice.state).toBe('ended');
    expect(w.states).toEqual(['connecting', 'ended']);
    expect(ended).toEqual(['stopped']);
  });

  it('the hang-up after the prompt rides on connect() settling, even with no onConnected', async () => {
    const w = world();
    const prompt = deferred<void>();
    FakePipecatClient.deviceGate = prompt.promise;
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    await starting;
    // Take the early close out of play: only the chained disconnect is left.
    w.client().opts.callbacks.onConnected = () => {};
    prompt.resolve();
    await tick();
    await tick();
    expect(w.client().live).toBe(false);
    expect(w.client().disconnected).toBe(1);
  });

  it('a call that comes up after the hang-up is closed at onConnected, before bot-ready', async () => {
    const w = world();
    const prompt = deferred<void>();
    const botReady = deferred<void>();
    FakePipecatClient.deviceGate = prompt.promise;
    FakePipecatClient.botReadyGate = botReady.promise; // the bot never says it is ready
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    await starting;
    prompt.resolve();
    await tick();
    // connect() is still pending on bot-ready, but the mic is already released.
    expect(w.client().live).toBe(false);
    expect(w.client().disconnected).toBe(1);
  });

  it('a stop during the microphone prompt then a new call: only the new call is left connected', async () => {
    const w = world();
    const prompt = deferred<void>();
    FakePipecatClient.deviceGate = prompt.promise;
    const first = w.voice.start();
    await tick();
    await w.voice.stop();
    await first;
    const second = w.voice.start();
    await tick();
    expect(FakePipecatClient.instances).toHaveLength(2);
    prompt.resolve(); // both prompts answered: both connects complete
    await second;
    await tick();
    const [abandoned, current] = FakePipecatClient.instances;
    expect(abandoned!.live).toBe(false);
    expect(current!.live).toBe(true);
    expect(w.voice.state).toBe('listening');
  });

  it('a late failure of the abandoned connect reports nothing', async () => {
    const w = world();
    const gate = deferred<void>();
    FakePipecatClient.connectGate = gate.promise;
    const errors: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    const starting = w.voice.start();
    await tick();
    await w.voice.stop();
    await starting;
    FakePipecatClient.failConnectWith = new Error('aborted');
    gate.resolve();
    await tick();
    expect(errors).toEqual([]);
    expect(w.voice.state).toBe('ended');
  });
});

describe('voice-service refusals', () => {
  function refusal(status: number, body?: unknown): Error {
    const cause =
      body === undefined
        ? { bodyUsed: false, json: async () => { throw new SyntaxError('not json'); } }
        : { bodyUsed: false, json: async () => body };
    return Object.assign(new Error(`WebRTC offer rejected with status ${status}`), { status, cause });
  }

  async function startWith(err: Error) {
    const w = world();
    const errors: Array<{ type: string; message: string }> = [];
    w.voice.on('error', (e) => errors.push(e));
    FakePipecatClient.failConnectWith = err;
    const rejection = await w.voice.start().catch((e: unknown) => e);
    return { w, errors, rejection: rejection as { type?: string } };
  }

  it("uses the service's error body when it is readable", async () => {
    const { errors, rejection } = await startWith(
      refusal(503, { error: { type: 'voice_at_capacity', message: 'All lines are busy' } }),
    );
    expect(errors).toEqual([{ type: 'voice_at_capacity', message: 'All lines are busy' }]);
    expect(rejection.type).toBe('voice_at_capacity');
  });

  it.each([
    [503, 'voice_at_capacity'],
    [401, 'voice_ticket_invalid'],
    [502, 'upstream_error'],
    [500, 'voice_error'],
  ])('maps status %i to %s when the body is unreadable', async (status, type) => {
    const { w, errors, rejection } = await startWith(refusal(status));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.type).toBe(type);
    expect(rejection.type).toBe(type);
    expect(w.voice.state).toBe('error');
  });
});

describe('RTVI relay failures', () => {
  it('a throwing permission check still answers the tool call, as an error', async () => {
    const w = world();
    (w.deps.tools.checkPermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('secret detail'));
    await w.voice.start();
    await w.client().server({ type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'paint', arguments: {} });
    await tick();
    expect(w.client().sent).toHaveLength(1);
    const sent = w.client().sent[0]!;
    expect(sent.type).toBe('t2v-tool-result');
    const data = sent.data as { tool_call_id: string; result: string; is_error: boolean };
    expect(data.tool_call_id).toBe('c1');
    expect(data.is_error).toBe(true);
    expect(data.result).not.toContain('secret detail');
  });

  it('a throwing token refresh ends the call as auth_expired', async () => {
    const w = world();
    await w.voice.start();
    (w.deps.getValidAccessToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    const errors: Array<{ type: string; message: string }> = [];
    const ended: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    w.voice.on('ended', (r) => ended.push(r));
    await w.client().server({ type: 't2v-token-request' });
    await tick();
    expect(errors.map((e) => e.type)).toEqual(['auth_expired']);
    expect(errors[0]!.message).not.toContain('network down');
    expect(ended).toEqual(['auth_expired']);
    expect(w.voice.state).toBe('ended');
    expect(w.client().disconnected).toBe(1);
  });
});

describe('RTVI relay', () => {
  const CALL = { type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'set_background_color', arguments: { color: 'blue' } };
  type ToolResult = { tool_call_id: string; result: string; is_error: boolean };
  const resultAt = (w: ReturnType<typeof world>, i: number) => w.client().sent[i]!.data as ToolResult;

  it('allow: runs the registered handler and sends the string result', async () => {
    const w = world();
    const calls: unknown[] = [];
    w.voice.on('toolCall', (c) => calls.push(c));
    await w.voice.start();
    await w.client().server(CALL);
    expect(w.deps.tools.checkPermission).toHaveBeenCalledWith('set_background_color', { color: 'blue' });
    expect(w.executed).toEqual([{ name: 'set_background_color', args: { color: 'blue' } }]);
    expect(w.client().sent).toEqual([
      { type: 't2v-tool-result', data: { tool_call_id: 'c1', result: '{"ok":true}', is_error: false } },
    ]);
    expect(calls).toEqual([{ toolCallId: 'c1', toolName: 'set_background_color', arguments: { color: 'blue' } }]);
  });

  it('allow with updatedInput runs the corrected arguments', async () => {
    const w = world();
    w.permission.result = { action: 'allow', updatedInput: { color: 'navy' } };
    await w.voice.start();
    await w.client().server(CALL);
    expect(w.executed[0]!.args).toEqual({ color: 'navy' });
  });

  it('a tool call without arguments runs with {}', async () => {
    const w = world();
    await w.voice.start();
    await w.client().server({ type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'reset' });
    expect(w.executed).toEqual([{ name: 'reset', args: {} }]);
  });

  it('deny: sends an error result and never runs the handler', async () => {
    const w = world();
    w.permission.result = { action: 'deny', message: 'Not on this page' };
    await w.voice.start();
    await w.client().server(CALL);
    expect(w.executed).toEqual([]);
    expect(resultAt(w, 0)).toEqual({ tool_call_id: 'c1', result: '{"error":"Not on this page"}', is_error: true });
  });

  it('a tool error result is relayed as is_error', async () => {
    const w = world();
    (w.deps.tools.executeToolCall as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      result: '{"error":"Unknown tool: set_background_color"}',
      isError: true,
    });
    await w.voice.start();
    await w.client().server(CALL);
    expect(resultAt(w, 0)).toEqual({
      tool_call_id: 'c1',
      result: '{"error":"Unknown tool: set_background_color"}',
      is_error: true,
    });
  });

  it('a throwing toolCall listener is isolated: the call still runs and is answered', async () => {
    const w = world();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      w.voice.on('toolCall', () => {
        throw new Error('partner bug');
      });
      await w.voice.start();
      await w.client().server(CALL);
      await tick();
      expect(w.client().sent).toEqual([
        { type: 't2v-tool-result', data: { tool_call_id: 'c1', result: '{"ok":true}', is_error: false } },
      ]);
      expect(w.executed).toHaveLength(1);
      // Logged generically: the event name only, never the payload or the error.
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toEqual(['[Talk2View] a voice "toolCall" listener threw']);
    } finally {
      log.mockRestore();
    }
  });

  it('require_approval: raises a pending approval; Allow once runs it', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    const approvals: unknown[] = [];
    w.voice.on('approvalChange', (a) => approvals.push(a));
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    const pending = approvals[0] as {
      toolCallId: string;
      toolName: string;
      arguments: unknown;
      description: string;
      decide: (d: unknown) => void;
    };
    expect(pending.toolCallId).toBe('c1');
    expect(pending.toolName).toBe('set_background_color');
    expect(pending.arguments).toEqual({ color: 'blue' });
    expect(pending.description).toBe('Changes the page background');
    expect(w.client().sent).toEqual([]);
    pending.decide({ action: 'once' });
    await relay;
    await tick();
    expect(approvals[1]).toBeNull();
    expect(w.executed).toHaveLength(1);
    expect(resultAt(w, 0)).toMatchObject({ is_error: false });
  });

  it('require_approval: Allow once with edited input runs the edit', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    pending.decide({ action: 'once', updatedInput: { color: 'teal' } });
    await relay;
    await tick();
    expect(w.executed).toEqual([{ name: 'set_background_color', args: { color: 'teal' } }]);
  });

  it('require_approval: Deny sends the feedback as the error', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    pending.decide({ action: 'deny', feedback: 'wrong colour' });
    await relay;
    await tick();
    expect(w.executed).toEqual([]);
    expect(resultAt(w, 0).is_error).toBe(true);
    expect(JSON.parse(resultAt(w, 0).result)).toEqual({ error: 'The user declined: wrong colour' });
  });

  it('Always: the next call of the same tool skips the card', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    const first = w.client().server(CALL);
    await tick();
    pending.decide({ action: 'always' });
    await first;
    await tick();
    pending = null;
    await w.client().server({ ...CALL, tool_call_id: 'c2' });
    expect(pending).toBeNull();
    expect(w.executed).toHaveLength(2);
    expect(w.client().sent.map((m) => (m.data as ToolResult).tool_call_id)).toEqual(['c1', 'c2']);
  });

  it('test_approval_timeout_denies_once', async () => {
    const w = world({ approvalTimeoutMs: 10 });
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    const approvals: unknown[] = [];
    w.voice.on('approvalChange', (a) => {
      approvals.push(a);
      if (a) pending = a;
    });
    await w.voice.start();
    await w.client().server(CALL);
    await new Promise((r) => setTimeout(r, 30));
    expect(w.client().sent).toHaveLength(1);
    expect(resultAt(w, 0).is_error).toBe(true);
    expect(JSON.parse(resultAt(w, 0).result)).toEqual({ error: 'The user did not answer in time' });
    expect(approvals.at(-1)).toBeNull();
    pending.decide({ action: 'once' }); // late click: ignored
    await tick();
    expect(w.client().sent).toHaveLength(1);
    expect(w.executed).toEqual([]);
    expect(approvals.filter((a) => a === null)).toHaveLength(1);
  });

  it('auto-denies after 25 s by default, under the service’s 30 s tool timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const w = world({ approvalTimeoutMs: undefined });
      w.permission.result = { action: 'require_approval' };
      await w.voice.start();
      w.client().callbacks.onServerMessage?.(CALL);
      await vi.advanceTimersByTimeAsync(24_999);
      expect(w.client().sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(w.client().sent).toHaveLength(1);
      expect(JSON.parse(resultAt(w, 0).result)).toEqual({ error: 'The user did not answer in time' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a listener that throws when the card closes does not strand the call', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => {
      if (a) pending = a;
      else throw new Error('partner bug');
    });
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      pending.decide({ action: 'once' });
    } finally {
      log.mockRestore();
    }
    await relay;
    await tick();
    expect(w.executed).toHaveLength(1);
    expect(resultAt(w, 0)).toMatchObject({ tool_call_id: 'c1', is_error: false });
  });

  it('a second approval supersedes the first', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    const approvals: Array<{ toolCallId: string } | null> = [];
    w.voice.on('approvalChange', (a) => approvals.push(a));
    await w.voice.start();
    const a = w.client().server(CALL);
    await tick();
    const b = w.client().server({ ...CALL, tool_call_id: 'c2' });
    await a;
    await tick();
    expect(resultAt(w, 0)).toMatchObject({ tool_call_id: 'c1', is_error: true });
    expect(JSON.parse(resultAt(w, 0).result)).toEqual({ error: 'Superseded by a newer request' });
    expect(approvals.map((x) => x?.toolCallId ?? null)).toEqual(['c1', null, 'c2']);
    await w.voice.stop(); // denies c2 with "The call ended"
    await b;
    await tick();
    // The channel is gone: nothing is sent for c2 and nothing ran.
    expect(w.client().sent).toHaveLength(1);
    expect(w.executed).toEqual([]);
    expect(approvals.at(-1)).toBeNull();
  });

  it('Deny without feedback says the user declined', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    pending.decide({ action: 'deny' });
    await relay;
    await tick();
    expect(JSON.parse(resultAt(w, 0).result)).toEqual({ error: 'The user declined' });
  });

  it('a result for an ended call is never sent', async () => {
    const w = world();
    const gate = deferred<{ result: string; isError: boolean }>();
    (w.deps.tools.executeToolCall as ReturnType<typeof vi.fn>).mockReturnValueOnce(gate.promise);
    await w.voice.start();
    await w.client().server(CALL);
    await w.voice.stop();
    gate.resolve({ result: '{"ok":true}', isError: false });
    await tick();
    expect(w.client().sent).toEqual([]);
  });

  it('answers a token request with a force-refreshed token', async () => {
    const w = world({ getValidAccessToken: vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? 'jwt-2' : 'jwt-1')) });
    await w.voice.start();
    await w.client().server({ type: 't2v-token-request' });
    expect(w.deps.getValidAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(w.client().sent).toEqual([{ type: 't2v-token', data: { access_token: 'jwt-2' } }]);
  });

  it('answers every token request in a turn, and never logs the token', async () => {
    let n = 1;
    const w = world({ getValidAccessToken: vi.fn(async () => `jwt-${++n}`) });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      await w.voice.start();
      await w.client().server({ type: 't2v-token-request' });
      await w.client().server({ type: 't2v-token-request' });
      expect(w.client().sent).toEqual([
        { type: 't2v-token', data: { access_token: 'jwt-3' } },
        { type: 't2v-token', data: { access_token: 'jwt-4' } },
      ]);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('a dead session answers the token request with an empty token', async () => {
    const w = world({ getValidAccessToken: vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? null : 'jwt-1')) });
    await w.voice.start();
    await w.client().server({ type: 't2v-token-request' });
    expect(w.client().sent).toEqual([{ type: 't2v-token', data: { access_token: '' } }]);
  });

  it('relays agent state and ignores unknown messages', async () => {
    const w = world();
    const states: unknown[] = [];
    w.voice.on('agentState', (s) => states.push(s));
    await w.voice.start();
    await w.client().server({ type: 't2v-agent-state', state: 'working' });
    await w.client().server({ type: 't2v-agent-state', state: 'idle' });
    await w.client().server({ type: 'something-else' });
    await w.client().server(null);
    expect(states).toEqual(['working', 'idle']);
    expect(w.client().sent).toEqual([]);
    expect(w.voice.state).toBe('listening');
  });
});

describe('teardown before events (stop always releases the mic)', () => {
  const CALL = { type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'paint', arguments: {} };

  function quietConsole() {
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  it('stop() with an open card disconnects although approvalChange(null) throws', async () => {
    const log = quietConsole();
    try {
      const w = world();
      w.permission.result = { action: 'require_approval' };
      const ended: unknown[] = [];
      w.voice.on('ended', (r) => ended.push(r));
      w.voice.on('approvalChange', (a) => {
        if (a === null) throw new Error('partner bug');
      });
      await w.voice.start();
      const relay = w.client().server(CALL);
      await tick();
      await w.voice.stop();
      await relay;
      expect(w.client().disconnected).toBe(1);
      expect(w.voice.state).toBe('ended');
      expect(ended).toEqual(['stopped']);
      expect(w.client().sent).toEqual([]);
      expect(w.executed).toEqual([]);
      expect(log).toHaveBeenCalledWith('[Talk2View] a voice "approvalChange" listener threw');
    } finally {
      log.mockRestore();
    }
  });

  it('a listener throwing on stateChange does not prevent the disconnect', async () => {
    const log = quietConsole();
    try {
      const w = world();
      const ended: unknown[] = [];
      w.voice.on('ended', (r) => ended.push(r));
      await w.voice.start();
      w.voice.on('stateChange', () => {
        throw new Error('partner bug');
      });
      await w.voice.stop();
      expect(w.client().disconnected).toBe(1);
      expect(w.voice.state).toBe('ended');
      expect(ended).toEqual(['stopped']);
    } finally {
      log.mockRestore();
    }
  });

  it('disconnects before any listener hears of the ending', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    const seen: Array<[string, number]> = [];
    const at = (name: string) => () => seen.push([name, w.client().disconnected]);
    await w.voice.start();
    const relay = w.client().server(CALL);
    await tick();
    w.voice.on('approvalChange', at('approvalChange'));
    w.voice.on('error', at('error'));
    w.voice.on('stateChange', at('stateChange'));
    w.voice.on('ended', at('ended'));
    await w.client().server({ type: 't2v-call-ended', reason: 'budget_exhausted' });
    await relay;
    expect(seen).toEqual([
      ['approvalChange', 1],
      ['error', 1],
      ['stateChange', 1],
      ['ended', 1],
    ]);
  });
});

describe('hang-up races', () => {
  const CALL = { type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'paint', arguments: {} };

  /** Make the fake client's disconnect() wait on a gate (a slow hang-up). */
  function slowDisconnect(w: ReturnType<typeof world>) {
    const gate = deferred<void>();
    const c = w.client();
    const real = c.disconnect.bind(c);
    c.disconnect = async () => {
      await gate.promise;
      await real();
    };
    return gate;
  }

  it.each(['require_approval', 'allow'] as const)(
    'stop during a pending permission check (%s): no card, no tool run, nothing sent',
    async (action) => {
      const w = world();
      const perm = deferred<PermissionCheckResult>();
      (w.deps.tools.checkPermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(perm.promise);
      const approvals: unknown[] = [];
      w.voice.on('approvalChange', (a) => approvals.push(a));
      await w.voice.start();
      await w.client().server(CALL);
      await w.voice.stop();
      perm.resolve({ action });
      await tick();
      expect(approvals).toEqual([]);
      expect(w.executed).toEqual([]);
      expect(w.client().sent).toEqual([]);
      expect(w.voice.state).toBe('ended');
    },
  );

  it('a late Allow after stop never runs the tool', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    await w.client().server(CALL);
    await w.voice.stop();
    pending.decide({ action: 'once' });
    await tick();
    expect(w.executed).toEqual([]);
    expect(w.client().sent).toEqual([]);
  });

  it('an Allow clicked while the hang-up is still disconnecting never runs the tool', async () => {
    const w = world();
    w.permission.result = { action: 'require_approval' };
    let pending: any;
    w.voice.on('approvalChange', (a) => { if (a) pending = a; });
    await w.voice.start();
    await w.client().server(CALL);
    const gate = slowDisconnect(w);
    const stopping = w.voice.stop();
    pending.decide({ action: 'always' }); // the card is still up mid-disconnect
    await tick();
    gate.resolve();
    await stopping;
    await tick();
    expect(w.executed).toEqual([]);
    expect(w.client().sent).toEqual([]);
  });

  it('concurrent stop() calls give one disconnect and one ended', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    const gate = slowDisconnect(w);
    const both = Promise.all([w.voice.stop(), w.voice.stop()]);
    await tick();
    gate.resolve();
    await both;
    expect(ended).toEqual(['stopped']);
    expect(w.client().disconnected).toBe(1);
    expect(w.states).toEqual(['connecting', 'listening', 'ended']);
  });

  it('a server-side end during a stop joins it: one ended', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    const gate = slowDisconnect(w);
    const stopping = w.voice.stop();
    w.client().callbacks.onServerMessage?.({ type: 't2v-call-ended', reason: 'idle' });
    gate.resolve();
    await stopping;
    await tick();
    expect(ended).toEqual(['stopped']);
    expect(w.client().disconnected).toBe(1);
  });
});

describe('final review fixes', () => {
  it('a start() then stop() inside an ended listener end the new call (I1)', async () => {
    const w = world();
    const ended: unknown[] = [];
    let restarted: Promise<void> | null = null;
    w.voice.on('ended', (r) => {
      ended.push(r);
      if (restarted) return;
      restarted = w.voice.start();
      void w.voice.stop();
    });
    await w.voice.start();
    await w.voice.stop();
    await restarted;
    await tick();
    expect(w.voice.state).toBe('ended');
    expect(FakePipecatClient.instances.filter((c) => c.live)).toEqual([]);
    expect(ended).toEqual(['stopped', 'stopped']);
  });

  it('concurrent stop() calls still join one ending after the fix (I1)', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    // A stop() from an error listener during the ending joins it.
    w.voice.on('error', () => void w.voice.stop());
    await w.voice.start();
    await w.client().server({ type: 't2v-call-ended', reason: 'budget_exhausted' });
    await tick();
    expect(ended).toEqual(['budget_exhausted']);
    expect(w.client().disconnected).toBe(1);
  });

  it('expire() ends a live call as auth_expired, with an auth_expired error (I2)', async () => {
    const w = world();
    const errors: Array<{ type: string }> = [];
    const ended: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    await w.voice.expire();
    expect(errors.map((e) => e.type)).toEqual(['auth_expired']);
    expect(ended).toEqual(['auth_expired']);
    expect(w.client().live).toBe(false);
    expect(w.voice.state).toBe('ended');
  });

  it('expire() mid-start ends the start as auth_expired, and never connects (I2)', async () => {
    const mint = deferred<typeof MINT>();
    const w = world({ request: vi.fn(() => mint.promise) as unknown as T2VVoiceDeps['request'] });
    const errors: Array<{ type: string }> = [];
    const ended: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    w.voice.on('ended', (r) => ended.push(r));
    const starting = w.voice.start();
    await tick();
    await w.voice.expire();
    mint.resolve(MINT);
    await starting;
    expect(FakePipecatClient.instances).toHaveLength(0);
    expect(errors.map((e) => e.type)).toEqual(['auth_expired']);
    expect(ended).toEqual(['auth_expired']);
  });

  it('expire() when idle or ended does nothing (I2)', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.expire();
    await w.voice.start();
    await w.voice.stop();
    await w.voice.expire();
    expect(ended).toEqual(['stopped']);
  });

  it('a denied microphone reports mic_unavailable and ends the call (I3)', async () => {
    const w = world();
    const errors: Array<{ type: string; message: string }> = [];
    const ended: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    w.client().callbacks.onDeviceError?.(
      Object.assign(new Error('NotAllowedError: Permission denied'), { devices: ['mic'], type: 'permissions' }),
    );
    await tick();
    expect(errors).toEqual([{ type: 'mic_unavailable', message: expect.stringMatching(/microphone/i) }]);
    expect(errors[0]!.message).not.toContain('NotAllowedError');
    expect(ended).toEqual(['error']);
    expect(w.voice.state).toBe('ended');
    expect(w.client().live).toBe(false);
  });

  it('a mic denied at the prompt ends the call, which is closed once connect() completes (I3 + C1)', async () => {
    const w = world();
    const prompt = deferred<void>();
    FakePipecatClient.deviceGate = prompt.promise;
    const errors: Array<{ type: string }> = [];
    w.voice.on('error', (e) => errors.push(e));
    const starting = w.voice.start();
    await tick();
    w.client().callbacks.onDeviceError?.({ devices: ['mic'], type: 'permissions', message: 'denied' });
    await starting;
    expect(errors.map((e) => e.type)).toEqual(['mic_unavailable']);
    expect(w.voice.state).toBe('ended');
    prompt.resolve();
    await tick();
    await tick();
    expect(w.client().live).toBe(false);
  });

  it('a camera-only device error is ignored (I3)', async () => {
    const w = world();
    const errors: unknown[] = [];
    w.voice.on('error', (e) => errors.push(e));
    await w.voice.start();
    w.client().callbacks.onDeviceError?.({ devices: ['cam'], type: 'not-found', message: 'no camera' });
    await tick();
    expect(errors).toEqual([]);
    expect(w.voice.state).toBe('listening');
  });

  it('an unknown server end reason is reported as "error"', async () => {
    const w = world();
    const ended: unknown[] = [];
    w.voice.on('ended', (r) => ended.push(r));
    await w.voice.start();
    await w.client().server({ type: 't2v-call-ended', reason: 'made_up' });
    expect(ended).toEqual(['error']);
    const v = world();
    const ended2: unknown[] = [];
    v.voice.on('ended', (r) => ended2.push(r));
    await v.voice.start();
    await v.client().server({ type: 't2v-call-ended' });
    expect(ended2).toEqual(['error']);
  });

  it('a failed library load never mints a ticket', async () => {
    const w = world({ loadLibs: async () => { throw new Error('chunk failed'); } });
    await expect(w.voice.start()).rejects.toMatchObject({ type: 'voice_error' });
    expect(w.deps.request).not.toHaveBeenCalled();
    expect(w.voice.state).toBe('error');
  });

  it('the default audio sink keeps one hidden <audio>: a renegotiated track replaces the old one', async () => {
    vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} });
    try {
      const w = world({ attachAudio: undefined });
      await w.voice.start();
      const t1 = { kind: 'audio', id: 'a' } as MediaStreamTrack;
      const t2 = { kind: 'audio', id: 'b' } as MediaStreamTrack;
      w.client().callbacks.onTrackStarted?.(t1, { local: false });
      w.client().callbacks.onTrackStarted?.(t2, { local: false });
      const els = document.querySelectorAll('audio');
      expect(els).toHaveLength(1);
      expect((els[0]!.srcObject as unknown as { tracks: unknown[] }).tracks).toEqual([t2]);
      await w.voice.stop();
      expect(document.querySelectorAll('audio')).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
