/**
 * Voice module — the realtime voice agent (`t2v.voice`).
 *
 * The engine mints a ticket (`POST /v1/voice/sessions`); the Pipecat client
 * libraries are loaded on first `start()` so chat-only partners never ship
 * them; WebRTC audio goes to the voice agent service; client tools the agent
 * calls arrive here over the RTVI data channel and run through the SAME tool
 * registry and permission check as chat, so partners write no new code.
 */

import { TypedEventEmitter } from './event-emitter.js';
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

export class VoiceStartError extends Error {
  constructor(
    public readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceStartError';
  }
}

export class T2VVoice {
  private readonly emitter = new TypedEventEmitter<VoiceEventMap>();
  private _state: VoiceState = 'idle';
  private client: PipecatClientLike | null = null;
  private audio: HTMLAudioElement | null = null;
  private pendingApproval: VoicePendingApproval | null = null;
  private readonly alwaysAllowed = new Set<string>();

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

  private setState(state: VoiceState): void {
    if (this._state === state) return;
    this._state = state;
    this.emitter.emit('stateChange', state);
  }

  private emitError(type: string, message: string): void {
    this.emitter.emit('error', { type, message } satisfies VoiceError);
  }

  /** Press the button. Resolves once the microphone is live. */
  async start(): Promise<void> {
    if (this._state === 'connecting' || this._state === 'listening') return;
    this.setState('connecting');
    try {
      if (!(await this.deps.ensureSession())) {
        throw new VoiceStartError('account_required', 'Sign in to use voice');
      }
      const mint = await this.deps.request<VoiceSessionResponse>('/v1/voice/sessions', { method: 'POST' });
      const libs = await (this.deps.loadLibs ?? loadPipecatLibs)();
      const token = await this.deps.getValidAccessToken();
      if (!token) throw new VoiceStartError('auth_expired', 'Sign in again to use voice');

      const transport = new libs.SmallWebRTCTransport({
        iceServers: mint.ice_servers.map((s) => ({
          urls: s.urls,
          ...(s.username ? { username: s.username } : {}),
          ...(s.credential ? { credential: s.credential } : {}),
        })),
      });
      const client = new libs.PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected: () => this.setState('listening'),
          onDisconnected: () => void this.finish('disconnected'),
          onError: (msg) => this.emitError('transport_error', msg?.data?.message ?? 'Voice connection error'),
          onServerMessage: (data) => void this.handleServerMessage(data),
          onUserTranscript: (d) => this.emitter.emit('transcript', { role: 'user', text: d.text, final: !!d.final }),
          onBotTranscript: (d) => this.emitter.emit('transcript', { role: 'bot', text: d.text, final: true }),
          onTrackStarted: (track, participant) => {
            if (participant?.local || track.kind !== 'audio') return;
            (this.deps.attachAudio ?? this.attachAudio)(track);
          },
        },
      });
      this.client = client;
      await client.connect({
        webrtcRequestParams: {
          endpoint: mint.voice_url,
          requestData: { ticket: mint.ticket, partner_key: this.deps.partnerKey, access_token: token },
        },
      });
    } catch (err) {
      await this.teardown();
      const type = (err as { type?: string }).type ?? 'voice_error';
      const message = err instanceof Error ? err.message : 'Could not start voice';
      this.emitError(type, message);
      this.setState('error');
      throw err;
    }
  }

  /** Hang up. Safe to call in any state. */
  async stop(): Promise<void> {
    await this.finish('stopped');
  }

  private async finish(reason: VoiceEndReason): Promise<void> {
    if (this._state === 'idle' || this._state === 'ended' || this._state === 'error') return;
    // teardown() nulls the client before disconnecting, so the onDisconnected
    // our own hang-up triggers is not a second, spurious ending.
    if (reason === 'disconnected' && this.client === null) return;
    if (reason === 'budget_exhausted') {
      this.emitError('insufficient_credit', 'You have used up your credits for now.');
    } else if (reason === 'auth_expired') {
      this.emitError('auth_expired', 'Your sign-in expired. Sign in again to keep talking.');
    }
    await this.teardown();
    this.setState('ended');
    this.emitter.emit('ended', reason);
  }

  private async teardown(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.resolveApproval({ action: 'deny', feedback: 'The call ended' });
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // already gone
      }
    }
  }

  private attachAudio = (track: MediaStreamTrack): void => {
    if (typeof document === 'undefined') return;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = new MediaStream([track]);
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audio = el;
  };

  // ── RTVI relay ──

  private async handleServerMessage(data: unknown): Promise<void> {
    const msg = data as { type?: string } & Record<string, unknown>;
    switch (msg?.type) {
      case 't2v-tool-call':
        await this.relayToolCall(msg as unknown as { tool_call_id: string; tool_name: string; arguments?: Record<string, unknown> });
        return;
      case 't2v-token-request': {
        const token = await this.deps.getValidAccessToken({ forceRefresh: true });
        this.client?.sendClientMessage('t2v-token', { access_token: token ?? '' });
        return;
      }
      case 't2v-agent-state':
        this.emitter.emit('agentState', msg.state === 'working' ? 'working' : 'idle');
        return;
      case 't2v-call-ended':
        await this.finish((msg.reason as VoiceEndReason) ?? 'error');
        return;
      default:
        return;
    }
  }

  private async relayToolCall(msg: { tool_call_id: string; tool_name: string; arguments?: Record<string, unknown> }): Promise<void> {
    const toolCallId = msg.tool_call_id;
    const toolName = msg.tool_name;
    const args = msg.arguments ?? {};
    this.emitter.emit('toolCall', { toolCallId, toolName, arguments: args });

    let outcome: { result: string; isError: boolean };
    const perm = await this.deps.tools.checkPermission(toolName, args);
    if (perm.action === 'deny') {
      outcome = { result: JSON.stringify({ error: perm.message ?? 'Denied by the application' }), isError: true };
    } else if (perm.action === 'require_approval' && !this.alwaysAllowed.has(toolName)) {
      const decision = await this.awaitApproval(toolCallId, toolName, args);
      if (decision.action === 'deny') {
        const why = decision.feedback ? `The user declined: ${decision.feedback}` : 'The user declined';
        outcome = { result: JSON.stringify({ error: why }), isError: true };
      } else {
        if (decision.action === 'always') this.alwaysAllowed.add(toolName);
        outcome = await this.deps.tools.executeToolCall(toolName, decision.updatedInput ?? args);
      }
    } else {
      outcome = await this.deps.tools.executeToolCall(toolName, perm.action === 'allow' ? (perm.updatedInput ?? args) : args);
    }
    this.client?.sendClientMessage('t2v-tool-result', {
      tool_call_id: toolCallId,
      result: outcome.result,
      is_error: outcome.isError,
    });
  }

  private resolveApproval(decision: HumanDecision): void {
    const pending = this.pendingApproval;
    if (!pending) return;
    pending.decide(decision);
  }

  private awaitApproval(toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<HumanDecision> {
    // One at a time: a second approval while one waits denies the first.
    this.resolveApproval({ action: 'deny', feedback: 'Superseded by a newer request' });
    return new Promise<HumanDecision>((resolve) => {
      const timeoutMs = this.deps.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
      let settled = false;
      const settle = (decision: HumanDecision): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pendingApproval === pending) this.pendingApproval = null;
        this.emitter.emit('approvalChange', null);
        resolve(decision);
      };
      const timer = setTimeout(() => settle({ action: 'deny', feedback: 'No answer in time' }), timeoutMs);
      const pending: VoicePendingApproval = {
        toolCallId,
        toolName,
        arguments: args,
        description: this.deps.tools.getDescription(toolName),
        decide: settle,
      };
      this.pendingApproval = pending;
      this.emitter.emit('approvalChange', pending);
    });
  }
}
