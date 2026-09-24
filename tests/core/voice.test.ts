import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { T2VVoice, type T2VVoiceDeps, type VoiceLibs } from '../../src/voice.js';
import type { PermissionCheckResult, VoiceState } from '../../src/types.js';

type Callbacks = Record<string, (...args: any[]) => void>;

class FakeTransport {
  constructor(public opts: { iceServers: RTCIceServer[] }) {}
}

class FakePipecatClient {
  static instances: FakePipecatClient[] = [];
  sent: Array<{ type: string; data: unknown }> = [];
  connectParams: any;
  disconnected = 0;
  static failConnectWith: Error | null = null;
  constructor(public opts: { transport: unknown; enableMic: boolean; enableCam: boolean; callbacks: Callbacks }) {
    FakePipecatClient.instances.push(this);
  }
  get callbacks(): Callbacks {
    return this.opts.callbacks;
  }
  async connect(params: unknown): Promise<void> {
    this.connectParams = params;
    if (FakePipecatClient.failConnectWith) throw FakePipecatClient.failConnectWith;
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

  it('a failed connect cleans up and reports transport_error', async () => {
    const w = world();
    FakePipecatClient.failConnectWith = new Error('ICE failed');
    await expect(w.voice.start()).rejects.toThrow('ICE failed');
    expect(w.voice.state).toBe('error');
    expect(w.client().disconnected).toBe(1);
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
