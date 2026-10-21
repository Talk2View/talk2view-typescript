/**
 * Voice controller — the realtime voice agent behind `t2v.voice`.
 *
 * Core never imports this module statically: the `T2VVoice` facade
 * (`voice-facade.ts`) loads it with `import()` on the first `start()`, and it
 * in turn loads the call libraries, so chat-only partners ship none of them.
 *
 * The engine mints the call (`POST /v1/voice/sessions`) on one of the voice
 * models this SDK runs, and the mint says which. A Gemini Live call gets a
 * ticket: the Pipecat client libraries, loaded on every `start()` because the
 * microphone opens through them before the mint, carry its WebRTC audio to
 * the voice agent service, and the client tools the agent calls arrive here
 * over the RTVI data channel. An ElevenLabs call gets a conversation token:
 * it runs in `voice-elevenlabs.ts` on the `@elevenlabs/client` library, and
 * the agent's requests become engine turns on the end-user's chat session
 * (`voice-turn.ts`), all three loaded with `import()` only for such a call. An
 * ElevenLabs call that can't connect is tried once more, on Gemini Live.
 * Either way, client tools run through the SAME tool registry and permission
 * check as chat, so partners write no new code.
 */

import { TypedEventEmitter } from './event-emitter.js';
import { VoiceStartError } from './voice-error.js';
import type { T2VSession } from './sessions.js';
import type { T2VTools } from './tools.js';
import type {
  ElevenLabsCallInfo,
  HumanDecision,
  VoiceEndReason,
  VoiceError,
  VoiceEventMap,
  VoiceModelId,
  VoicePendingApproval,
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceStartOptions,
  VoiceState,
} from './types.js';

// ── Voice models ──

/** The voice models this SDK can run, as it asks the engine for them. */
export const VOICE_MODELS_THIS_SDK_RUNS: readonly VoiceModelId[] = ['gemini-live', 'elevenlabs'];

/** What the end-user is told when no voice model this app allows can take the call. */
export const NO_VOICE_MESSAGE = 'Voice isn’t available right now.';

/**
 * The longest language the engine takes on a mint (35 characters). A longer
 * one is left out, so the engine uses its default instead of refusing the
 * whole mint. `.length` counts UTF-16 units, never fewer than the engine's
 * code points, so anything sent fits.
 */
const MAX_LANGUAGE_LENGTH = 35;

/** Each voice model's name, as the notes say it. */
export const VOICE_MODEL_NAMES: Record<VoiceModelId, string> = { 'gemini-live': 'Gemini Live', elevenlabs: 'ElevenLabs' };

/** The note when a voice model couldn't connect and another took the call: the engine's text. */
export const NOTE_COULD_NOT_CONNECT = 'Using {fallback} — {wanted} couldn’t connect.';

/** {@link NOTE_COULD_NOT_CONNECT} for the voice model used (`fallback`) and the one given up (`wanted`). */
export function couldNotConnectNote(fallback: VoiceModelId, wanted: VoiceModelId): string {
  return NOTE_COULD_NOT_CONNECT.replace('{fallback}', VOICE_MODEL_NAMES[fallback]).replace('{wanted}', VOICE_MODEL_NAMES[wanted]);
}

// ── The slice of the Pipecat client we use, so tests can hand in a fake ──

export interface PipecatCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: { data?: { message?: string } }) => void;
  onServerMessage?: (data: unknown) => void;
  onUserTranscript?: (data: { text: string; final?: boolean }) => void;
  onBotTranscript?: (data: { text: string }) => void;
  onTrackStarted?: (track: MediaStreamTrack, participant?: { local?: boolean }) => void;
  /** client-js 1.13.1 passes a `DeviceError` (`devices`, `type`, `message`). */
  onDeviceError?: (error: { devices?: string[]; type?: string; message?: string }) => void;
}

export interface PipecatClientLike {
  /** Opens the microphone (the browser's permission prompt, first time). */
  initDevices(): Promise<void>;
  connect(params: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
  sendClientMessage(type: string, data?: unknown): void;
  /** The live tracks; `local.audio` is the microphone. */
  tracks(): { local?: { audio?: MediaStreamTrack | null } };
}

export interface VoiceLibs {
  PipecatClient: new (opts: {
    transport: unknown;
    enableMic: boolean;
    enableCam: boolean;
    callbacks: PipecatCallbacks;
  }) => PipecatClientLike;
  /** `iceServers` can be set after construction, before `connect()`. */
  SmallWebRTCTransport: new (opts: { iceServers: RTCIceServer[] }) => { iceServers: RTCIceServer[] };
}

export type VoiceLibLoader = () => Promise<VoiceLibs>;

/** Dynamic imports: a bundler splits these into their own chunk. */
export const loadPipecatLibs: VoiceLibLoader = async () => {
  const [client, transport] = await Promise.all([
    import('@pipecat-ai/client-js'),
    import('@pipecat-ai/small-webrtc-transport'),
  ]);
  return {
    PipecatClient: client.PipecatClient as unknown as VoiceLibs['PipecatClient'],
    SmallWebRTCTransport: transport.SmallWebRTCTransport as unknown as VoiceLibs['SmallWebRTCTransport'],
  };
};

// ── The ElevenLabs call: its module is loaded with `import()`, so only its types are named here ──

/** An ElevenLabs call, as the controller holds it. */
type ElevenLabsCallHandle = import('./voice-elevenlabs.js').ElevenLabsCall;

/**
 * What an ElevenLabs call needs loaded before it starts: the call itself, the
 * runner for its requests, and the library it runs on.
 */
interface LoadedElevenLabs {
  ElevenLabsCall: typeof import('./voice-elevenlabs.js').ElevenLabsCall;
  VoiceTurnRunner: typeof import('./voice-elevenlabs.js').VoiceTurnRunner;
  libs: import('./voice-elevenlabs.js').ElevenLabsLibs;
}

/**
 * Where a call's start spends its time, in ms since the click. Logged only
 * when `localStorage['t2v:debug'] === '1'`: step names and numbers, nothing
 * about the user.
 */
function startTimings(): { mark(step: string): void; done(step: string): void } {
  const clock = globalThis.performance;
  const started = clock?.now() ?? 0;
  const steps: Record<string, number> = {};
  const mark = (step: string): void => {
    if (clock) steps[step] = Math.round(clock.now() - started);
  };
  return {
    mark,
    done(step) {
      mark(step);
      let enabled = false;
      try {
        enabled = globalThis.localStorage?.getItem('t2v:debug') === '1';
      } catch {
        // storage blocked: stay quiet
      }
      if (enabled) console.debug('[Talk2View] voice start, ms since click', steps);
    },
  };
}

/** Every `VoiceEndReason`; a `t2v-call-ended` reason outside it is reported as `'error'`. */
const END_REASONS: ReadonlySet<string> = new Set<VoiceEndReason>([
  'stopped',
  'disconnected',
  'session_cap',
  'idle',
  'budget_exhausted',
  'auth_expired',
  'error',
]);

const MIC_UNAVAILABLE: VoiceError = {
  type: 'mic_unavailable',
  message: 'Voice needs microphone access. Allow the microphone and try again.',
};

const AUTH_EXPIRED: VoiceError = {
  type: 'auth_expired',
  message: 'Your sign-in expired. Sign in again to keep talking.',
};

export interface T2VVoiceDeps {
  request: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  ensureSession: () => Promise<boolean>;
  getValidAccessToken: (opts?: { forceRefresh?: boolean }) => Promise<string | null>;
  tools: Pick<T2VTools, 'checkPermission' | 'executeToolCall' | 'getDescription'>;
  partnerKey: string;
  loadLibs?: VoiceLibLoader;
  /** Where the bot's audio goes. Default: an autoplaying `<audio>` element. */
  attachAudio?: (track: MediaStreamTrack) => void;
  /** Auto-deny an approval nobody answers. Under the service's 30 s tool timeout. */
  approvalTimeoutMs?: number;
  /** Whether the browser will prompt for the microphone. Default: the Permissions API. */
  micPermission?: () => Promise<PermissionState | 'unknown'>;
  /**
   * The chat session a voice call's turns run on, from the mint's
   * `session_id`: the end-user's one engine session for this partner.
   */
  sessionFor: (sessionId: string) => T2VSession;
  /**
   * Loads the ElevenLabs client library, only when an ElevenLabs call starts.
   * Default: `loadElevenLabsLibs` (`voice-elevenlabs.ts`).
   */
  loadElevenLabs?: import('./voice-elevenlabs.js').ElevenLabsLibLoader;
  /** The browser's language tag, for the call's greeting and language. Default: `navigator.language`. */
  language?: () => string;
}

/** The microphone's permission state, or 'unknown' where the browser cannot say. */
async function queryMicPermission(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await globalThis.navigator?.permissions?.query({ name: 'microphone' as PermissionName });
    return status?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Release the microphone of a client that may never have connected. Before a
 * peer connection exists client-js's disconnect() returns early and leaves
 * the mic track live, so the track itself is stopped. Safe to repeat.
 */
function releaseMic(client: PipecatClientLike): void {
  try {
    client.tracks()?.local?.audio?.stop();
  } catch {
    // no tracks yet, or already released
  }
}

/** A Gemini Live mint's ICE servers, as the transport takes them. */
function iceServersOf(mint: VoiceSessionResponse): RTCIceServer[] {
  return (mint.ice_servers ?? []).map((s) => ({
    urls: s.urls,
    ...(s.username ? { username: s.username } : {}),
    ...(s.credential ? { credential: s.credential } : {}),
  }));
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 25_000;

/** What the voice service's refusal statuses mean when its JSON body is unreadable. */
const OFFER_STATUS: Record<number, VoiceError> = {
  401: { type: 'voice_ticket_invalid', message: 'The voice session expired before it connected. Try again.' },
  502: { type: 'upstream_error', message: 'The voice service could not reach the assistant. Try again.' },
  503: { type: 'voice_at_capacity', message: 'Voice is busy right now. Try again in a minute.' },
};

/**
 * Turn a failed start into a `VoiceError`. Engine errors (`T2VError`) and our
 * own `VoiceStartError` carry `.type`. The transport rejects a refused offer
 * with a `TransportStartError` carrying `.status` and, as `.cause`, the
 * service's unread `Response`, whose `{error: {type, message}}` body wins.
 */
async function describeStartError(err: unknown, connecting: boolean): Promise<VoiceError> {
  const e = (err ?? {}) as { type?: unknown; status?: unknown; cause?: unknown };
  const message = err instanceof Error && err.message ? err.message : 'Could not start voice';
  if (typeof e.type === 'string') return { type: e.type, message };
  if (typeof e.status === 'number') {
    const cause = e.cause as { json?: unknown; bodyUsed?: boolean } | undefined;
    if (cause && typeof cause.json === 'function' && !cause.bodyUsed) {
      try {
        const body = (await (cause.json as () => Promise<unknown>)()) as { error?: { type?: unknown; message?: unknown } };
        if (typeof body?.error?.type === 'string') {
          const fallback = OFFER_STATUS[e.status]?.message ?? 'Could not start voice';
          return { type: body.error.type, message: typeof body.error.message === 'string' ? body.error.message : fallback };
        }
      } catch {
        // not JSON: fall back to the status
      }
    }
    return OFFER_STATUS[e.status] ?? { type: 'voice_error', message: 'Could not start voice' };
  }
  return { type: connecting ? 'transport_error' : 'voice_error', message };
}

export { VoiceStartError };

/** The voice controller. Construct the {@link T2VVoice} facade (`t2v.voice`) instead. */
export class T2VVoiceController {
  private readonly emitter = new TypedEventEmitter<VoiceEventMap>();
  private _state: VoiceState = 'idle';
  private client: PipecatClientLike | null = null;
  /** The ElevenLabs call, from its start until the call ends. It reports its own end. */
  private elCall: ElevenLabsCallHandle | null = null;
  /**
   * The conversation id of an ElevenLabs call the engine minted that no
   * {@link elCall} has taken over yet: an ending reports its end.
   */
  private mintedCall: string | null = null;
  /**
   * The mint in flight, until the start that sent it reads the answer. It
   * may yet return an ElevenLabs call, so an ending meanwhile reports that
   * call's end once it returns.
   */
  private mintInFlight: Promise<VoiceSessionResponse> | null = null;
  /**
   * ElevenLabs end reports the engine has not answered yet, and mints an
   * ending came during. The next start waits for them before it mints, since
   * the engine releases a call's credit when it hears of the end. Never
   * rejects.
   */
  private pendingEndReports: Promise<void> | null = null;
  private audio: HTMLAudioElement | null = null;
  private libs: Promise<VoiceLibs> | null = null;
  private pendingApproval: VoicePendingApproval | null = null;
  /** Ends the open approval without a human answer; the reason goes to the agent. */
  private cancelApproval: ((reason: string) => void) | null = null;
  private readonly alwaysAllowed = new Set<string>();
  /**
   * Bumped by every ending. A `start()` or a client callback from an older
   * epoch belongs to a call that was hung up, and must not touch this one.
   */
  private epoch = 0;
  /** Settles the in-flight `start()`'s waits when the call is hung up mid-start. */
  private abortStart: (() => void) | null = null;
  /**
   * The hang-up in progress; a concurrent `stop()` joins it. Tagged with the
   * epoch it ended, so a `stop()` for a call started after it (say, from an
   * `ended` listener) is not mistaken for a second hang-up of the old one.
   */
  private ending: { epoch: number; promise: Promise<void> } | null = null;

  constructor(private readonly deps: T2VVoiceDeps) {}

  get state(): VoiceState {
    return this._state;
  }

  on<K extends keyof VoiceEventMap & string>(
    event: K,
    callback: (...args: VoiceEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Emit without letting a throwing partner listener break the caller: a hang-up
   * must still release the mic and a tool call must still be answered. Logged
   * by event name only, never the payload (it can carry tool arguments).
   */
  private safeEmit<K extends keyof VoiceEventMap & string>(event: K, ...args: VoiceEventMap[K]): void {
    try {
      this.emitter.emit(event, ...args);
    } catch {
      console.error(`[Talk2View] a voice "${event}" listener threw`);
    }
  }

  private setState(state: VoiceState): void {
    if (this._state === state) return;
    this._state = state;
    this.safeEmit('stateChange', state);
  }

  private emitError(type: string, message: string): void {
    this.safeEmit('error', { type, message } satisfies VoiceError);
  }

  /**
   * @internal Start loading the call libraries before the first `start()`
   * (the button calls this on hover). `start()` reuses the load.
   */
  preload(): void {
    this.loadLibs().catch(() => undefined);
  }

  /** The call libraries, loaded once. A failed load is retried next time. */
  private loadLibs(): Promise<VoiceLibs> {
    const load = (this.libs ??= (this.deps.loadLibs ?? loadPipecatLibs)());
    load.catch(() => {
      if (this.libs === load) this.libs = null;
    });
    return load;
  }

  /**
   * Press the button. Resolves once the microphone is live, or quietly if the
   * call is hung up (`stop()`) before it connects.
   */
  async start(options: VoiceStartOptions = {}): Promise<void> {
    if (this._state === 'connecting' || this._state === 'listening') return;
    const epoch = ++this.epoch;
    const stale = (): boolean => epoch !== this.epoch;
    this.setState('connecting');
    const aborted = new Promise<void>((resolve) => {
      this.abortStart = resolve;
    });
    let connecting = false;
    let client: PipecatClientLike | null = null;
    let connectCall: Promise<unknown> | null = null;
    // A hang-up while the browser is still asking for the microphone reaches
    // the client before its transport exists: client-js 1.13.1's connect()
    // awaits initDevices() before Transport.connect() makes its AbortController,
    // and the transport's stop() returns early without a peer connection. So
    // that disconnect() cancels nothing, and once the prompt is answered the
    // call comes up anyway. Hang up again when connect() settles (on bot-ready
    // or failure), which closes the peer connection and releases the mic.
    const abandon = (): void => {
      const orphan = client;
      if (!orphan || !connectCall) return;
      connectCall.then(() => orphan.disconnect(), () => undefined).catch(() => undefined);
    };
    const timings = startTimings();
    try {
      // An ElevenLabs call's end report the engine has not answered yet, or a
      // mint hung up in flight that may yet return such a call: the engine
      // releases that call's credit as it hears of the end, and this call's
      // mint must find it released. A slow engine holds back this start,
      // which shows `connecting`, never the last call's `ended`.
      const endReports = this.pendingEndReports;
      if (endReports) {
        await Promise.race([endReports, aborted]);
        if (stale()) return;
      }
      // The call libraries load while the session is checked: the same chunk
      // whatever the answer. Awaited before the mint, so a chunk that fails
      // to load still never burns a ticket.
      const libsLoad = this.loadLibs();
      libsLoad.catch(() => undefined); // awaited below; never an unhandled rejection
      if (!(await this.deps.ensureSession())) {
        throw new VoiceStartError('account_required', 'Sign in to use voice');
      }
      timings.mark('session');
      if (stale()) return;
      const libs = await libsLoad;
      timings.mark('libs');
      if (stale()) return;
      // The client is built before the mint so the microphone can open while
      // (or before) the call is minted; a Gemini Live call's ICE servers come
      // with the mint.
      const first = this.buildPipecat(libs, stale);
      let { pipecat, transport } = first;
      client = pipecat;
      this.client = pipecat;

      // The microphone. A ticket lives 60 s, so while the browser will still
      // ask, the mic opens first: a user reading the prompt must not let the
      // ticket expire (they got "took too long to connect"). Already allowed,
      // it opens alongside the mint and costs no time.
      const micAllowed = (await (this.deps.micPermission ?? queryMicPermission)()) === 'granted';
      if (stale()) return;
      const devices = first.pipecat.initDevices();
      devices.catch(() => undefined); // awaited below
      // A hang-up must not wait on the prompt: start() returns at once, and
      // the mic the prompt opens later is released as soon as it opens (the
      // teardown that ran first found none to release).
      const micOpened = async (): Promise<boolean> => {
        await Promise.race([devices, aborted]);
        if (!stale()) return true;
        devices.then(() => releaseMic(first.pipecat), () => undefined);
        return false;
      };
      if (!micAllowed) {
        if (!(await micOpened())) return;
        timings.mark('mic');
      }
      // The access token is fetched alongside the mint, not after it.
      const tokenFetch = this.deps.getValidAccessToken();
      tokenFetch.catch(() => undefined); // awaited below
      // An ending while the mint is in flight takes it over: once the mint
      // returns, that ending reports the end of the ElevenLabs call it made.
      const minting = this.mintVoice(options, []);
      this.mintInFlight = minting;
      let mint: VoiceSessionResponse;
      try {
        mint = await minting;
      } finally {
        // In the same step as the check below: no ending falls between them.
        if (this.mintInFlight === minting) this.mintInFlight = null;
      }
      timings.mark('mint');
      const elevenlabs = mint.voice_model === 'elevenlabs' ? (mint.elevenlabs ?? null) : null;
      // Hung up during the mint: the ending took the mint over, and reports its end.
      if (stale()) return;
      // An ElevenLabs call's module and library load while the token and the
      // microphone are awaited. Until the call takes over, an ending reports
      // the end of the call the engine minted.
      const elevenlabsLoad = elevenlabs ? this.loadElevenLabsCall() : null;
      elevenlabsLoad?.catch(() => undefined); // awaited below
      if (elevenlabs) this.mintedCall = elevenlabs.conversation_id;
      // The engine's word on the voice model it chose, shown once, at the start.
      if (mint.note) this.safeEmit('note', mint.note);
      const token = await tokenFetch;
      timings.mark('token');
      if (stale()) return;
      if (!token) throw new VoiceStartError('auth_expired', 'Sign in again to use voice');
      if (micAllowed) {
        if (!(await micOpened())) return;
        timings.mark('mic');
      }
      if (elevenlabs && elevenlabsLoad) {
        // ElevenLabs opens its own microphone: Pipecat's is released first,
        // once it is open, and that client never connects.
        releaseMic(first.pipecat);
        this.client = null;
        client = null;
        if (await this.startElevenLabs(elevenlabs, mint.session_id, options, elevenlabsLoad, stale, aborted)) {
          if (!stale()) timings.done('connected');
          return;
        }
        // It couldn't connect: tried once more, on Gemini Live, with a fresh client.
        const retry = await this.fallBackToGeminiLive(elevenlabs.conversation_id, options, stale);
        if (!retry || stale()) return;
        mint = retry;
        ({ pipecat, transport } = this.buildPipecat(libs, stale));
        client = pipecat;
        this.client = pipecat;
      }
      // A Gemini Live call: the mint carries its ticket, offer URL and ICE servers.
      transport.iceServers = iceServersOf(mint);
      connecting = true;
      connectCall = this.connectGemini(pipecat, mint, token);
      // connect() waits for the bot; a hang-up mid-connect settles `aborted`.
      await Promise.race([connectCall, aborted]);
      if (stale()) abandon();
      else timings.done('connected');
    } catch (err) {
      // Hung up mid-start: stop() already tore down and reported the ending.
      if (stale()) {
        abandon();
        if (client) releaseMic(client);
        return;
      }
      this.abortStart = null;
      this.epoch += 1; // late callbacks from this failed client are not this call's
      await this.teardown('error');
      const error = await describeStartError(err, connecting);
      this.emitError(error.type, error.message);
      this.setState('error');
      throw typeof (err as { type?: unknown })?.type === 'string'
        ? err
        : new VoiceStartError(error.type, error.message, { cause: err });
    } finally {
      if (!stale()) this.abortStart = null;
    }
  }

  /**
   * A Pipecat client for a Gemini Live call, its callbacks bound to the
   * start that built it (`stale`). They do nothing once the client is no
   * longer the controller's: an ElevenLabs call took over, or the call
   * ended. A refused first offer (503 at capacity, 502) is retried by the
   * transport for several seconds; the ticket cannot succeed on a retry, so
   * it allows none until connected, then gets its default back for mid-call
   * ICE recovery.
   */
  private buildPipecat(
    libs: VoiceLibs,
    stale: () => boolean,
  ): { pipecat: PipecatClientLike; transport: { iceServers: RTCIceServer[] } } {
    const transport = new libs.SmallWebRTCTransport({ iceServers: [] });
    // `maxReconnectionAttempts` is a public field of the pinned 1.10.8
    // transport that its typings do not declare.
    const retry = transport as { maxReconnectionAttempts?: number };
    const retries = retry.maxReconnectionAttempts;
    if (typeof retries === 'number') retry.maxReconnectionAttempts = 0;
    const current = (): boolean => !stale() && this.client === pipecat;
    const pipecat: PipecatClientLike = new libs.PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => {
          // A call that comes up after it was hung up (see `abandon`) is
          // closed at once, not left streaming the mic until bot-ready.
          if (stale()) {
            pipecat.disconnect().catch(() => undefined);
            return;
          }
          if (typeof retries === 'number') retry.maxReconnectionAttempts = retries;
          this.setState('listening');
          this.safeEmit('callStarted', { voiceModel: 'gemini-live', greeting: null });
        },
        onDisconnected: () => {
          if (current()) void this.finish('disconnected');
        },
        onError: (msg) => {
          if (current()) this.emitError('transport_error', msg?.data?.message ?? 'Voice connection error');
        },
        onServerMessage: (data) => {
          if (!current()) return;
          this.handleServerMessage(data).catch(() => {
            if (!stale()) this.emitError('voice_error', 'Something went wrong in the voice call');
          });
        },
        onUserTranscript: (d) => {
          if (current()) this.safeEmit('transcript', { role: 'user', text: d.text, final: !!d.final });
        },
        onBotTranscript: (d) => {
          if (current()) this.safeEmit('transcript', { role: 'bot', text: d.text, final: true });
        },
        onTrackStarted: (track, participant) => {
          if (!current() || participant?.local || track.kind !== 'audio') return;
          (this.deps.attachAudio ?? this.attachAudio)(track);
        },
        onDeviceError: (error) => {
          if (!current()) return;
          // The call is audio-only: a camera error is not ours to report.
          if (Array.isArray(error?.devices) && !error.devices.includes('mic')) return;
          // No microphone means a call that listens to nothing: end it and say why.
          void this.finish('error', MIC_UNAVAILABLE);
        },
      },
    });
    return { pipecat, transport };
  }

  /**
   * Connect a Gemini Live call with the mint's ticket and offer URL, its ICE
   * servers already on the transport. Resolves once the bot is ready.
   */
  private connectGemini(pipecat: PipecatClientLike, mint: VoiceSessionResponse, token: string): Promise<unknown> {
    return pipecat.connect({
      webrtcRequestParams: {
        endpoint: mint.voice_url!,
        requestData: { ticket: mint.ticket!, partner_key: this.deps.partnerKey, access_token: token },
      },
    });
  }

  /**
   * Ask the engine for a call (`POST /v1/voice/sessions`) on any voice model
   * this SDK runs but `exclude`, with the page's instructions and the
   * browser's language (left out when longer than {@link MAX_LANGUAGE_LENGTH}).
   * The engine chooses the voice model. When none is left for this app and
   * this SDK (403 `voice_model_unavailable`), the start fails with
   * {@link NO_VOICE_MESSAGE}.
   */
  private async mintVoice(options: VoiceStartOptions, exclude: readonly VoiceModelId[]): Promise<VoiceSessionResponse> {
    const systemPrompt = options.systemPrompt?.trim();
    const language = (this.deps.language ?? (() => globalThis.navigator?.language))();
    const body: VoiceSessionRequest = {
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      voice_models: VOICE_MODELS_THIS_SDK_RUNS.filter((model) => !exclude.includes(model)),
      ...(language && language.length <= MAX_LANGUAGE_LENGTH ? { language } : {}),
    };
    try {
      return await this.deps.request<VoiceSessionResponse>('/v1/voice/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      if ((err as { type?: unknown } | undefined)?.type === 'voice_model_unavailable') {
        throw new VoiceStartError('voice_model_unavailable', NO_VOICE_MESSAGE, { cause: err });
      }
      throw err;
    }
  }

  /**
   * The ElevenLabs call's module, with the voice turn runner, and the
   * library it runs on, both loaded with `import()`.
   */
  private async loadElevenLabsCall(): Promise<LoadedElevenLabs> {
    const { ElevenLabsCall, VoiceTurnRunner, loadElevenLabsLibs } = await import('./voice-elevenlabs.js');
    const libs = await (this.deps.loadElevenLabs ?? loadElevenLabsLibs)();
    return { ElevenLabsCall, VoiceTurnRunner, libs };
  }

  /**
   * Start the ElevenLabs call the engine minted, once its module and library
   * have loaded. Its requests run as engine turns on the chat session the
   * mint names, with the page prompt as their system message; the agent gets
   * the page prompt unfenced (`voice-elevenlabs.ts`). Resolves `true` when
   * the call started, or the start was hung up (that ending reported the
   * call's end); `false` when it couldn't connect, and its end is still to
   * be reported.
   */
  private async startElevenLabs(
    info: ElevenLabsCallInfo,
    sessionId: string,
    options: VoiceStartOptions,
    load: Promise<LoadedElevenLabs>,
    stale: () => boolean,
    aborted: Promise<void>,
  ): Promise<boolean> {
    let loaded: LoadedElevenLabs;
    try {
      loaded = await load;
    } catch {
      // Not loaded: the call can't connect. Hung up meanwhile, the ending reported it.
      return stale();
    }
    if (stale()) return true;
    const pagePrompt = options.systemPrompt?.trim() || undefined;
    const turns = new loaded.VoiceTurnRunner({
      session: this.deps.sessionFor(sessionId),
      pagePrompt,
      onApproval: async (toolCallId, toolName, args) => {
        const answer = await this.awaitApproval(toolCallId, toolName, args);
        // Remembered as on a Gemini Live call, but not once the call has ended.
        if (!stale() && answer.decision.action === 'always') this.alwaysAllowed.add(toolName);
        return answer;
      },
      isAlwaysAllowed: (toolName) => this.alwaysAllowed.has(toolName),
      // A turn aborted as the call ended settles after it: its `idle` is not this call's.
      onState: (state) => {
        if (!stale()) this.safeEmit('agentState', state);
      },
      // Called mid-turn: the goodbye neither throws nor rejects.
      onBudgetExceeded: () => {
        if (!stale()) void call.goodbye();
      },
    });
    const call: ElevenLabsCallHandle = new loaded.ElevenLabsCall({
      libs: loaded.libs,
      info,
      pagePrompt,
      turns,
      onConnected: () => {
        if (stale()) return;
        this.setState('listening');
        this.safeEmit('callStarted', { voiceModel: 'elevenlabs', greeting: info.greeting });
      },
      onTranscript: (transcript) => {
        if (!stale()) this.safeEmit('transcript', transcript);
      },
      onError: (message) => {
        if (!stale()) this.emitError('voice_error', message);
      },
      onEnded: (reason, error) => {
        if (!stale()) void this.finish(reason, error);
      },
      reportEnd: (reason) => this.reportEnd(info.conversation_id, reason),
    });
    // From here on the call reports its own end.
    this.mintedCall = null;
    this.elCall = call;
    const starting = call.start();
    starting.catch(() => undefined); // raced below
    try {
      await Promise.race([starting, aborted]);
      return true;
    } catch {
      // It never connected, and reported nothing.
      if (!stale()) this.elCall = null;
      return false;
    }
  }

  /**
   * The ElevenLabs call couldn't connect, and nothing has reported its end.
   * The engine is told (it releases the credit it holds for the call), then
   * asked for the call once more, without ElevenLabs, and its note shown.
   * Resolves that mint, or `null` once the start is hung up.
   */
  private async fallBackToGeminiLive(
    conversationId: string,
    options: VoiceStartOptions,
    stale: () => boolean,
  ): Promise<VoiceSessionResponse | null> {
    if (stale()) {
      this.keepEndReport(this.reportEnd(conversationId, 'connect_failed'));
      return null;
    }
    this.mintedCall = null;
    // Awaited, and kept: a start after a hang-up meanwhile waits for it too.
    const report = this.reportEnd(conversationId, 'connect_failed');
    this.keepEndReport(report);
    await report;
    if (stale()) return null;
    const mint = await this.mintVoice(options, ['elevenlabs']);
    if (stale()) return null;
    this.safeEmit('note', mint.note ?? couldNotConnectNote(mint.voice_model, 'elevenlabs'));
    return mint;
  }

  /** Keep an end report until the engine answers it: the next start waits for it. */
  private keepEndReport(report: Promise<void>): void {
    const pending: Promise<void> = this.pendingEndReports
      ? Promise.all([this.pendingEndReports, report]).then(() => undefined)
      : report;
    this.pendingEndReports = pending;
    void pending.then(() => {
      if (this.pendingEndReports === pending) this.pendingEndReports = null;
    });
  }

  /**
   * The end report for a mint that was in flight as the call ended. Once the
   * mint returns, the end of the ElevenLabs call it made is reported, with
   * the ending's reason. Settles once the engine answers that report, or as
   * soon as the mint fails or returns a Gemini Live call. Never rejects.
   */
  private async reportEndAfterMint(minting: Promise<VoiceSessionResponse>, reason: VoiceEndReason): Promise<void> {
    const mint = await minting.catch(() => null);
    const elevenlabs = mint?.voice_model === 'elevenlabs' ? (mint.elevenlabs ?? null) : null;
    if (elevenlabs) await this.reportEnd(elevenlabs.conversation_id, reason);
  }

  /**
   * Tell the engine an ElevenLabs call has ended (`POST
   * /v1/voice/calls/{id}/end`), so it settles the credit it holds for the
   * call. Sent with `keepalive`, so it outlives the page. A failure is
   * swallowed: the engine settles a call nobody reported from ElevenLabs'
   * bill.
   */
  private async reportEnd(conversationId: string, reason: string): Promise<void> {
    try {
      await this.deps.request(`/v1/voice/calls/${encodeURIComponent(conversationId)}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        keepalive: true,
      });
    } catch {
      // Swallowed, as above.
    }
  }

  /** Hang up. Safe to call in any state. */
  async stop(): Promise<void> {
    await this.finish('stopped');
  }

  /**
   * @internal The signed-in session died (not a deliberate sign-out): end any
   * call, starting or live, as `auth_expired` with an `auth_expired` error.
   */
  async expire(): Promise<void> {
    await this.finish('auth_expired');
  }

  private finish(reason: VoiceEndReason, error?: VoiceError): Promise<void> {
    // A second hang-up while the first is still tearing down joins it: one
    // disconnect, one `ended`. Only the same call's: a call started since
    // (a new epoch) gets its own ending.
    if (this.ending && this.ending.epoch === this.epoch) return this.ending.promise;
    if (this._state === 'idle' || this._state === 'ended' || this._state === 'error') return Promise.resolve();
    // teardown() nulls the client before disconnecting, so the onDisconnected
    // our own hang-up triggers is not a second, spurious ending.
    if (reason === 'disconnected' && this.client === null && this.elCall === null) return Promise.resolve();
    // A transport that fails to connect fires onDisconnected before connect()
    // rejects; start()'s catch reports that failure as an error, not an ending.
    if (reason === 'disconnected' && this._state === 'connecting') return Promise.resolve();
    // endCall() bumps the epoch synchronously, before its first await.
    const promise = this.endCall(reason, error);
    const ending = { epoch: this.epoch, promise };
    this.ending = ending;
    void promise.finally(() => {
      if (this.ending === ending) this.ending = null;
    });
    return promise;
  }

  private async endCall(reason: VoiceEndReason, error?: VoiceError): Promise<void> {
    // Everything from the call being ended (a start still in flight, late
    // callbacks, tool calls mid-relay) is now stale.
    this.epoch += 1;
    const abortStart = this.abortStart;
    this.abortStart = null;
    // Privacy first: the mic is released and the call hung up before any
    // partner listener runs.
    await this.teardown(reason);
    abortStart?.();
    if (error) {
      this.emitError(error.type, error.message);
    } else if (reason === 'budget_exhausted') {
      this.emitError('insufficient_credit', 'You have used up your credits for now.');
    } else if (reason === 'auth_expired') {
      this.emitError(AUTH_EXPIRED.type, AUTH_EXPIRED.message);
    }
    this.setState('ended');
    this.safeEmit('ended', reason);
  }

  private async teardown(reason: VoiceEndReason): Promise<void> {
    const client = this.client;
    this.client = null;
    const call = this.elCall;
    this.elCall = null;
    const minted = this.mintedCall;
    this.mintedCall = null;
    const minting = this.mintInFlight;
    this.mintInFlight = null;
    this.detachAudio();
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // already gone
      }
      // A client that never connected keeps its mic after disconnect().
      releaseMic(client);
    }
    // An ElevenLabs call ends its session and reports its own end; the end of
    // one minted but not started yet is reported here, and so is the end of
    // one the mint in flight may yet return. None waits for the engine's
    // answer: the next start does.
    if (call) {
      await call.stop(reason);
      this.keepEndReport(call.reported());
    } else if (minted) {
      this.keepEndReport(this.reportEnd(minted, reason));
    } else if (minting) {
      this.keepEndReport(this.reportEndAfterMint(minting, reason));
    }
    // Last: closing the card emits `approvalChange(null)`. Nothing is sent for
    // it, since the call is gone.
    this.endApproval('The call ended');
  }

  private attachAudio = (track: MediaStreamTrack): void => {
    if (typeof document === 'undefined') return;
    // A renegotiation (ICE recovery) fires onTrackStarted again: one sink, not two.
    this.detachAudio();
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = new MediaStream([track]);
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audio = el;
  };

  private detachAudio(): void {
    if (!this.audio) return;
    this.audio.srcObject = null;
    this.audio.remove();
    this.audio = null;
  }

  // ── RTVI relay ──

  private async handleServerMessage(data: unknown): Promise<void> {
    const msg = data as { type?: string } & Record<string, unknown>;
    switch (msg?.type) {
      case 't2v-tool-call':
        await this.relayToolCall(msg as unknown as { tool_call_id: string; tool_name: string; arguments?: Record<string, unknown> });
        return;
      case 't2v-token-request': {
        const client = this.client;
        let token: string | null;
        try {
          token = await this.deps.getValidAccessToken({ forceRefresh: true });
        } catch {
          // The call cannot continue without a fresh token: end it as expired.
          if (this.client === client) await this.finish('auth_expired');
          return;
        }
        if (this.client === client) client?.sendClientMessage('t2v-token', { access_token: token ?? '' });
        return;
      }
      case 't2v-agent-state':
        this.safeEmit('agentState', msg.state === 'working' ? 'working' : 'idle');
        return;
      case 't2v-call-ended':
        await this.finish(
          typeof msg.reason === 'string' && END_REASONS.has(msg.reason) ? (msg.reason as VoiceEndReason) : 'error',
        );
        return;
      default:
        return;
    }
  }

  private async relayToolCall(msg: { tool_call_id: string; tool_name: string; arguments?: Record<string, unknown> }): Promise<void> {
    const toolCallId = msg.tool_call_id;
    const toolName = msg.tool_name;
    const args = msg.arguments ?? {};
    const client = this.client;

    let outcome: { result: string; isError: boolean };
    try {
      // A throwing `toolCall` listener is isolated: the call still runs and is answered.
      this.safeEmit('toolCall', { toolCallId, toolName, arguments: args });
      outcome = await this.runToolCall(toolCallId, toolName, args);
    } catch {
      // A throwing permission callback or tool: the agent still gets an answer.
      outcome = { result: JSON.stringify({ error: 'The application could not run this tool' }), isError: true };
    }
    // Only to the call that asked: a result for an ended call goes nowhere.
    if (this.client !== client) return;
    client?.sendClientMessage('t2v-tool-result', {
      tool_call_id: toolCallId,
      result: outcome.result,
      is_error: outcome.isError,
    });
  }

  private async runToolCall(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ result: string; isError: boolean }> {
    // Hung up while the partner's permission callback or the card was pending:
    // no card, no tool run. Nothing is sent either (the channel is gone).
    const epoch = this.epoch;
    const CALL_ENDED = { result: JSON.stringify({ error: 'The call ended' }), isError: true };
    let outcome: { result: string; isError: boolean };
    const perm = await this.deps.tools.checkPermission(toolName, args);
    if (epoch !== this.epoch) return CALL_ENDED;
    if (perm.action === 'deny') {
      outcome = { result: JSON.stringify({ error: perm.message ?? 'Denied by the application' }), isError: true };
    } else if (perm.action === 'require_approval' && !this.alwaysAllowed.has(toolName)) {
      const { decision, endedBecause } = await this.awaitApproval(toolCallId, toolName, args);
      if (epoch !== this.epoch) return CALL_ENDED;
      if (endedBecause) {
        outcome = { result: JSON.stringify({ error: endedBecause }), isError: true };
      } else if (decision.action === 'deny') {
        const why = decision.feedback ? `The user declined: ${decision.feedback}` : 'The user declined';
        outcome = { result: JSON.stringify({ error: why }), isError: true };
      } else {
        if (decision.action === 'always') this.alwaysAllowed.add(toolName);
        outcome = await this.deps.tools.executeToolCall(toolName, decision.updatedInput ?? args);
      }
    } else {
      outcome = await this.deps.tools.executeToolCall(toolName, perm.action === 'allow' ? (perm.updatedInput ?? args) : args);
    }
    return outcome;
  }

  /** Close the open card without a human answer, telling the agent why. */
  private endApproval(reason: string): void {
    this.cancelApproval?.(reason);
  }

  private awaitApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ decision: HumanDecision; endedBecause?: string }> {
    // One at a time: a second approval while one waits denies the first.
    this.endApproval('Superseded by a newer request');
    return new Promise((resolve) => {
      const timeoutMs = this.deps.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
      let settled = false;
      const settle = (decision: HumanDecision, endedBecause?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pendingApproval === pending) {
          this.pendingApproval = null;
          this.cancelApproval = null;
        }
        resolve(endedBecause ? { decision, endedBecause } : { decision });
        this.safeEmit('approvalChange', null);
      };
      const end = (reason: string): void => settle({ action: 'deny' }, reason);
      const timer = setTimeout(() => end('The user did not answer in time'), timeoutMs);
      const pending: VoicePendingApproval = {
        toolCallId,
        toolName,
        arguments: args,
        description: this.deps.tools.getDescription(toolName),
        decide: (decision) => settle(decision),
      };
      this.pendingApproval = pending;
      this.cancelApproval = end;
      this.safeEmit('approvalChange', pending);
    });
  }
}
