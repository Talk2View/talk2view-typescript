/**
 * Voice controller — the realtime voice agent behind `t2v.voice`.
 *
 * Core never imports this module statically: the `T2VVoice` facade
 * (`voice-facade.ts`) loads it with `import()` on the first `start()`, and it
 * in turn loads the Pipecat libraries, so chat-only partners ship neither.
 *
 * The engine mints a ticket (`POST /v1/voice/sessions`); the Pipecat client
 * libraries are loaded on first `start()` so chat-only partners never ship
 * them; WebRTC audio goes to the voice agent service; client tools the agent
 * calls arrive here over the RTVI data channel and run through the SAME tool
 * registry and permission check as chat, so partners write no new code.
 */

import { TypedEventEmitter } from './event-emitter.js';
import { VoiceStartError } from './voice-error.js';
import type { T2VTools } from './tools.js';
import type {
  HumanDecision,
  VoiceEndReason,
  VoiceError,
  VoiceEventMap,
  VoicePendingApproval,
  VoiceSessionResponse,
  VoiceState,
} from './types.js';

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
  connect(params: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
  sendClientMessage(type: string, data?: unknown): void;
}

export interface VoiceLibs {
  PipecatClient: new (opts: {
    transport: unknown;
    enableMic: boolean;
    enableCam: boolean;
    callbacks: PipecatCallbacks;
  }) => PipecatClientLike;
  SmallWebRTCTransport: new (opts: { iceServers: RTCIceServer[] }) => unknown;
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
  private audio: HTMLAudioElement | null = null;
  private pendingApproval: VoicePendingApproval | null = null;
  /** Ends the open approval without a human answer; the reason goes to the agent. */
  private cancelApproval: ((reason: string) => void) | null = null;
  private readonly alwaysAllowed = new Set<string>();
  /**
   * Bumped by every ending. A `start()` or a client callback from an older
   * epoch belongs to a call that was hung up, and must not touch this one.
   */
  private epoch = 0;
  /** Settles the in-flight `start()`'s connect wait when the call is hung up mid-start. */
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
   * Press the button. Resolves once the microphone is live, or quietly if the
   * call is hung up (`stop()`) before it connects.
   */
  async start(): Promise<void> {
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
    try {
      if (!(await this.deps.ensureSession())) {
        throw new VoiceStartError('account_required', 'Sign in to use voice');
      }
      if (stale()) return;
      // Before the mint: a chunk that fails to load must not burn a ticket.
      const libs = await (this.deps.loadLibs ?? loadPipecatLibs)();
      if (stale()) return;
      const mint = await this.deps.request<VoiceSessionResponse>('/v1/voice/sessions', { method: 'POST' });
      if (stale()) return;
      const token = await this.deps.getValidAccessToken();
      if (stale()) return;
      if (!token) throw new VoiceStartError('auth_expired', 'Sign in again to use voice');

      const transport = new libs.SmallWebRTCTransport({
        iceServers: mint.ice_servers.map((s) => ({
          urls: s.urls,
          ...(s.username ? { username: s.username } : {}),
          ...(s.credential ? { credential: s.credential } : {}),
        })),
      });
      // A refused first offer (503 at capacity, 502) is retried by the transport
      // for several seconds; the ticket cannot succeed on a retry, so allow none
      // until connected, then restore the default for mid-call ICE recovery.
      // `maxReconnectionAttempts` is a public field of the pinned 1.10.8
      // transport that its typings do not declare.
      const retry = transport as { maxReconnectionAttempts?: number };
      const retries = retry.maxReconnectionAttempts;
      if (typeof retries === 'number') retry.maxReconnectionAttempts = 0;
      const pipecat = new libs.PipecatClient({
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
          },
          onDisconnected: () => {
            if (!stale()) void this.finish('disconnected');
          },
          onError: (msg) => {
            if (!stale()) this.emitError('transport_error', msg?.data?.message ?? 'Voice connection error');
          },
          onServerMessage: (data) => {
            if (stale()) return;
            this.handleServerMessage(data).catch(() => {
              if (!stale()) this.emitError('voice_error', 'Something went wrong in the voice call');
            });
          },
          onUserTranscript: (d) => {
            if (!stale()) this.safeEmit('transcript', { role: 'user', text: d.text, final: !!d.final });
          },
          onBotTranscript: (d) => {
            if (!stale()) this.safeEmit('transcript', { role: 'bot', text: d.text, final: true });
          },
          onTrackStarted: (track, participant) => {
            if (stale() || participant?.local || track.kind !== 'audio') return;
            (this.deps.attachAudio ?? this.attachAudio)(track);
          },
          onDeviceError: (error) => {
            if (stale()) return;
            // The call is audio-only: a camera error is not ours to report.
            if (Array.isArray(error?.devices) && !error.devices.includes('mic')) return;
            // No microphone means a call that listens to nothing: end it and say why.
            void this.finish('error', MIC_UNAVAILABLE);
          },
        },
      });
      client = pipecat;
      this.client = pipecat;
      connecting = true;
      connectCall = pipecat.connect({
        webrtcRequestParams: {
          endpoint: mint.voice_url,
          requestData: { ticket: mint.ticket, partner_key: this.deps.partnerKey, access_token: token },
        },
      });
      // connect() waits for the bot; a hang-up mid-connect settles `aborted`.
      await Promise.race([connectCall, aborted]);
      if (stale()) abandon();
    } catch (err) {
      // Hung up mid-start: stop() already tore down and reported the ending.
      if (stale()) {
        abandon();
        return;
      }
      this.abortStart = null;
      this.epoch += 1; // late callbacks from this failed client are not this call's
      await this.teardown();
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
    if (reason === 'disconnected' && this.client === null) return Promise.resolve();
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
    // Privacy first: the mic is released and the client disconnected before any
    // partner listener runs.
    await this.teardown();
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

  private async teardown(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.detachAudio();
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // already gone
      }
    }
    // Last: closing the card emits `approvalChange(null)`. Nothing is sent for
    // it, since the client is gone.
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
