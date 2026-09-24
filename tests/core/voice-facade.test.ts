import { describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index.js';
import type { VoiceState } from '../../src/types.js';
import { T2VVoice, type T2VVoiceOptions, type VoiceControllerLoader } from '../../src/voice-facade.js';
import { T2VVoiceController, type VoiceLibs } from '../../src/voice.js';

// Only for the identity-change test at the bottom: capture the auth callback.
const h = vi.hoisted(() => ({ cb: null as null | ((user: unknown) => void) }));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn((fn: (user: unknown) => void) => {
      h.cb = fn;
      return () => {};
    }),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
    signingOut: false,
  })),
}));

type Callbacks = Record<string, (...args: any[]) => void>;

class FakeTransport {
  maxReconnectionAttempts = 3;
  constructor(public opts: unknown) {}
}

class FakePipecatClient {
  static instances: FakePipecatClient[] = [];
  disconnected = 0;
  constructor(public opts: { callbacks: Callbacks }) {
    FakePipecatClient.instances.push(this);
  }
  async connect(): Promise<void> {
    this.opts.callbacks.onConnected?.();
  }
  async disconnect(): Promise<void> {
    this.disconnected += 1;
    this.opts.callbacks.onDisconnected?.();
  }
  sendClientMessage(): void {}
}

const MINT = {
  ticket: 't'.repeat(43),
  voice_url: 'https://engine.test/v1/voice/offer',
  session_id: 's1',
  ice_servers: [],
  expires_in: 60,
  model: 'gemini-3.8-live',
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function facade(overrides: Partial<T2VVoiceOptions> = {}) {
  FakePipecatClient.instances = [];
  const libs: VoiceLibs = { PipecatClient: FakePipecatClient as any, SmallWebRTCTransport: FakeTransport as any };
  const options: T2VVoiceOptions = {
    request: vi.fn(async () => MINT) as unknown as T2VVoiceOptions['request'],
    ensureSession: vi.fn(async () => true),
    getValidAccessToken: vi.fn(async () => 'jwt-1'),
    tools: {} as T2VVoiceOptions['tools'],
    partnerKey: 'pk_test_x',
    loadLibs: async () => libs,
    attachAudio: vi.fn(),
    ...overrides,
  };
  return { voice: new T2VVoice(options), options };
}

describe('T2VVoice facade', () => {
  it('reports idle and loads nothing before the first start()', () => {
    const loadController = vi.fn<VoiceControllerLoader>(async () => T2VVoiceController);
    const { voice } = facade({ loadController });
    voice.on('stateChange', () => {});
    expect(voice.state).toBe('idle');
    expect(loadController).not.toHaveBeenCalled();
  });

  it('delivers to listeners added before the controller loaded, without duplicates', async () => {
    const { voice } = facade({ loadController: async () => T2VVoiceController });
    const states: VoiceState[] = [];
    const ended: unknown[] = [];
    voice.on('stateChange', (s) => states.push(s));
    voice.on('ended', (r) => ended.push(r));
    await voice.start();
    expect(voice.state).toBe('listening');
    await voice.stop();
    expect(states).toEqual(['connecting', 'listening', 'ended']);
    expect(ended).toEqual(['stopped']);
  });

  it('loads the real controller through import() by default', async () => {
    const { voice } = facade();
    await voice.start();
    expect(voice.state).toBe('listening');
    expect(FakePipecatClient.instances).toHaveLength(1);
  });

  it('off() works before and after the controller loads', async () => {
    const { voice } = facade({ loadController: async () => T2VVoiceController });
    const before = vi.fn();
    const after = vi.fn();
    voice.on('stateChange', before);
    voice.off('stateChange', before);
    await voice.start();
    voice.on('ended', after);
    voice.off('ended', after);
    const unsubscribe = voice.on('stateChange', before);
    unsubscribe();
    await voice.stop();
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('stop() during the lazy load ends the call; the late load never connects', async () => {
    const load = deferred<typeof T2VVoiceController>();
    const { voice, options } = facade({ loadController: () => load.promise });
    const states: VoiceState[] = [];
    const ended: unknown[] = [];
    voice.on('stateChange', (s) => states.push(s));
    voice.on('ended', (r) => ended.push(r));
    const starting = voice.start();
    await tick();
    expect(voice.state).toBe('connecting');
    await voice.stop();
    load.resolve(T2VVoiceController);
    await starting;
    await tick();
    expect(voice.state).toBe('ended');
    expect(states).toEqual(['connecting', 'ended']);
    expect(ended).toEqual(['stopped']);
    expect(options.request).not.toHaveBeenCalled();
    expect(FakePipecatClient.instances).toHaveLength(0);

    // The loaded controller is reused for the next call.
    await voice.start();
    expect(voice.state).toBe('listening');
  });

  it('a failed controller load reports voice_error and can be retried', async () => {
    let attempt = 0;
    const { voice } = facade({
      loadController: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('chunk failed');
        return T2VVoiceController;
      },
    });
    const errors: Array<{ type: string }> = [];
    voice.on('error', (e) => errors.push(e));
    await expect(voice.start()).rejects.toMatchObject({ name: 'VoiceStartError', type: 'voice_error' });
    expect(voice.state).toBe('error');
    expect(errors.map((e) => e.type)).toEqual(['voice_error']);
    await voice.start();
    expect(voice.state).toBe('listening');
  });

  it('stop() during a lazy load that then fails: the next start() retries the import', async () => {
    const first = deferred<typeof T2VVoiceController>();
    const loadController = vi
      .fn<VoiceControllerLoader>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => T2VVoiceController);
    const { voice } = facade({ loadController });
    const errors: unknown[] = [];
    voice.on('error', (e) => errors.push(e));
    const starting = voice.start();
    await tick();
    await voice.stop();
    first.reject(new Error('chunk failed'));
    await starting; // stale: resolves quietly, reports nothing
    expect(errors).toEqual([]);
    expect(voice.state).toBe('ended');

    await voice.start();
    expect(loadController).toHaveBeenCalledTimes(2);
    expect(voice.state).toBe('listening');
  });

  it('forwards the relay events: toolCall and approvalChange reach facade listeners', async () => {
    const { voice } = facade({
      loadController: async () => T2VVoiceController,
      tools: {
        checkPermission: vi.fn(async () => ({ action: 'require_approval' as const })),
        executeToolCall: vi.fn(async () => ({ result: '{"ok":true}', isError: false })),
        getDescription: () => 'Paints',
      } as unknown as T2VVoiceOptions['tools'],
    });
    const log: unknown[] = [];
    voice.on('toolCall', (c) => log.push(['toolCall', c.toolCallId]));
    voice.on('approvalChange', (a) => log.push(['approvalChange', a?.toolCallId ?? null]));
    await voice.start();
    const client = FakePipecatClient.instances[0]!;
    const sent: unknown[] = [];
    client.sendClientMessage = (type: string, data?: unknown) => sent.push({ type, data });
    client.opts.callbacks.onServerMessage?.({ type: 't2v-tool-call', tool_call_id: 'c1', tool_name: 'paint', arguments: {} });
    await tick();
    expect(log).toEqual([['toolCall', 'c1'], ['approvalChange', 'c1']]);
    await voice.stop();
    await tick();
    expect(log.at(-1)).toEqual(['approvalChange', null]);
    expect(sent).toEqual([]);
  });
});

describe('T2VVoice facade: final review fixes', () => {
  it('expire() during the lazy load ends the call as auth_expired, with an error (I2)', async () => {
    const load = deferred<typeof T2VVoiceController>();
    const { voice, options } = facade({ loadController: () => load.promise });
    const errors: Array<{ type: string }> = [];
    const ended: unknown[] = [];
    voice.on('error', (e) => errors.push(e));
    voice.on('ended', (r) => ended.push(r));
    const starting = voice.start();
    await tick();
    await voice.expire();
    load.resolve(T2VVoiceController);
    await starting;
    expect(voice.state).toBe('ended');
    expect(errors.map((e) => e.type)).toEqual(['auth_expired']);
    expect(ended).toEqual(['auth_expired']);
    expect(options.request).not.toHaveBeenCalled();
  });

  it('expire() on a live call reaches the controller (I2)', async () => {
    const { voice } = facade({ loadController: async () => T2VVoiceController });
    const errors: Array<{ type: string }> = [];
    const ended: unknown[] = [];
    voice.on('error', (e) => errors.push(e));
    voice.on('ended', (r) => ended.push(r));
    await voice.start();
    await voice.expire();
    expect(errors.map((e) => e.type)).toEqual(['auth_expired']);
    expect(ended).toEqual(['auth_expired']);
    expect(FakePipecatClient.instances[0]!.disconnected).toBe(1);
  });

  it('a throwing listener cannot reject stop() during the load, or a failed start() with its own error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const load = deferred<typeof T2VVoiceController>();
      const a = facade({ loadController: () => load.promise });
      a.voice.on('ended', () => {
        throw new Error('partner bug');
      });
      a.voice.on('stateChange', () => {
        throw new Error('partner bug');
      });
      const starting = a.voice.start();
      await tick();
      await expect(a.voice.stop()).resolves.toBeUndefined();
      load.resolve(T2VVoiceController);
      await starting;
      expect(a.voice.state).toBe('ended');

      const b = facade({ loadController: async () => { throw new Error('chunk failed'); } });
      b.voice.on('error', () => {
        throw new Error('partner bug');
      });
      // Rejects with the load failure, not the listener's exception.
      await expect(b.voice.start()).rejects.toMatchObject({ name: 'VoiceStartError', type: 'voice_error' });
      expect(b.voice.state).toBe('error');
      expect(log).toHaveBeenCalledWith('[Talk2View] a voice "ended" listener threw');
    } finally {
      log.mockRestore();
    }
  });

  it('a throwing listener on a forwarded event does not break the call', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { voice } = facade({ loadController: async () => T2VVoiceController });
      voice.on('ended', () => {
        throw new Error('partner bug');
      });
      await voice.start();
      await expect(voice.stop()).resolves.toBeUndefined();
      expect(FakePipecatClient.instances[0]!.disconnected).toBe(1);
      expect(log).toHaveBeenCalledWith('[Talk2View] a voice "ended" listener threw');
    } finally {
      log.mockRestore();
    }
  });
});

describe('Talk2View.voice', () => {
  it('a dead session (identity -> null, no logout) ends the call as auth_expired (I2)', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
    h.cb!({ id: 'user-1', email: 'a@x.com' });
    const stop = vi.spyOn(t2v.voice, 'stop');
    const expire = vi.spyOn(t2v.voice, 'expire');
    h.cb!(null);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('a deliberate logout() (identity -> null while signing out) stops the call (I2)', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
    h.cb!({ id: 'user-1', email: 'a@x.com' });
    const stop = vi.spyOn(t2v.voice, 'stop');
    const expire = vi.spyOn(t2v.voice, 'expire');
    (t2v.auth as unknown as { signingOut: boolean }).signingOut = true;
    h.cb!(null);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(expire).not.toHaveBeenCalled();
  });


  it('an identity change stops the active call through the facade', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
    const stop = vi.spyOn(t2v.voice, 'stop');
    h.cb!({ id: 'user-1', email: 'a@x.com' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(t2v.voice.state).toBe('idle');
  });
});
