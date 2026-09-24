import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { T2VVoice, type T2VVoiceDeps, type VoiceLibs } from '../../src/voice.js';
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
  static failConnectWith: Error | null = null;
  /** When set, connect() waits on it (a slow ICE/offer exchange). */
  static connectGate: Promise<void> | null = null;
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
    if (FakePipecatClient.connectGate) await FakePipecatClient.connectGate;
    if (FakePipecatClient.failConnectWith) {
      // Like the real transport: stop(error) fires onDisconnected, then connect() rejects.
      this.callbacks.onDisconnected?.();
      throw FakePipecatClient.failConnectWith;
    }
    this.callbacks.onConnected?.();
  }
  async disconnect(): Promise<void> {
    this.disconnected += 1;
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
    expect(w.voice.state).toBe('ended');
  });

  it('during connect: disconnects the client (mic released) and never listens', async () => {
    const w = world();
    const gate = deferred<void>();
    FakePipecatClient.connectGate = gate.promise;
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
    expect(w.voice.state).toBe('ended');
    expect(w.states).toEqual(['connecting', 'ended']);
    expect(ended).toEqual(['stopped']);
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
