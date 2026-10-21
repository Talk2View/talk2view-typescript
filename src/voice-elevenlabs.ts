/**
 * An ElevenLabs voice call, run through the official `@elevenlabs/client`
 * library.
 *
 * The engine mints the call when it picks ElevenLabs (`POST
 * /v1/voice/sessions`): a conversation token, the conversation's id, the
 * time limit the end-user's budget allows (never past the call cap), and the
 * notice the agent speaks when the credit runs out. This module starts the
 * conversation with that token, answers the agent's `ask_talk2view`
 * requests through the voice turn runner (`voice-turn.ts`), says goodbye
 * when the budget's time limit passes or a turn finds the budget spent, ends
 * the call at the cap without one, and tells the engine, once, that the call
 * has ended, so the engine settles the credit it holds for it.
 *
 * Keep this module and the library out of core's up-front bundle: only the
 * voice controller loads this module, with `import()`, and only for an
 * ElevenLabs call; this module loads the library the same way. The
 * controller gets the voice turn runner from this module too, so a Gemini
 * Live call loads neither.
 */

import { formatCapabilities, NONE_PLACEHOLDER, unfence } from './voice-fence.js';
import { VoiceTurnRunner } from './voice-turn.js';
import type { ElevenLabsCallInfo, VoiceEndReason, VoiceError, VoiceTranscript } from './types.js';

/** The voice turn runner, for the controller: it loads it only with this module. */
export { VoiceTurnRunner };

/** The library's conversation, as the call uses it. */
export interface ElevenLabsConversationLike {
  getId(): string;
  endSession(): Promise<void>;
  sendUserMessage(text: string): void;
}

/** The slice of the library the call uses, so tests can hand in a fake. */
export interface ElevenLabsLibs {
  startSession(options: Record<string, unknown>): Promise<ElevenLabsConversationLike>;
}

export type ElevenLabsLibLoader = () => Promise<ElevenLabsLibs>;

/** A dynamic import: a bundler splits the library into its own chunk. */
export const loadElevenLabsLibs: ElevenLabsLibLoader = async () => {
  const m = await import('@elevenlabs/client');
  return {
    startSession: (o) => m.Conversation.startSession(o as never) as Promise<ElevenLabsConversationLike>,
  };
};

/**
 * How long the goodbye waits for the agent to start speaking the notice and,
 * once it has, for it to finish.
 */
export const GOODBYE_WAIT_MS = 10_000;

/** The error when the conversation that started is not the one the engine minted. */
export const MISMATCH_MESSAGE = 'The call did not start as expected. Try again.';

/**
 * The longest an ElevenLabs call runs, in seconds, and so the cap on its time
 * limit. Mirrors the engine's `CALL_CAP_SECONDS`
 * (`t2v/services/elevenlabs_calls.py`). A time limit this long is the cap,
 * not the end of the end-user's credit: the call ends there as `session_cap`,
 * with no goodbye, as a Gemini Live call does at its cap.
 */
export const CALL_CAP_SECONDS = 900;

/** The answer to a request still waiting on an engine turn as the call ends. */
const CALL_ENDED = 'The call ended';

export interface ElevenLabsCallDeps {
  libs: ElevenLabsLibs;
  /** The mint's ElevenLabs half. */
  info: ElevenLabsCallInfo;
  /** The page prompt. The agent gets it, unfenced, in a dynamic variable. */
  pagePrompt?: string;
  /** Runs the agent's `ask_talk2view` requests as engine turns. */
  turns: VoiceTurnRunner;
  /** The conversation connected, and it is the one the engine minted. */
  onConnected(): void;
  onTranscript(t: VoiceTranscript): void;
  /**
   * The call ended by itself: the agent or the connection ended it, the
   * goodbye finished, the time limit reached the call cap, the page went
   * away, or the conversation was not the one minted. Never called for
   * {@link ElevenLabsCall.stop}.
   */
  onEnded(reason: VoiceEndReason, error?: VoiceError): void;
  /** The library reported an error mid-call. `message` is its own text, written for developers. */
  onError(message: string): void;
  /** Tells the engine the call has ended, with the reason it ended with. Called once per call. */
  reportEnd(reason: string): Promise<void>;
  /** Default {@link GOODBYE_WAIT_MS}. */
  goodbyeWaitMs?: number;
  /** When the mint answered, by the `now` clock: the time limit counts from here. */
  startedAt: number;
  /** The clock for the time limit. Default `Date.now`. */
  now?: () => number;
}

/** Run `task`, swallowing its failure, thrown or rejected: an ending must go through. */
async function quietly(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch {
    // Swallowed, as above.
  }
}

/**
 * One ElevenLabs call, from `start()` until it ends. It ends once: by
 * `stop()`, by the library (the agent or the connection), by the goodbye, at
 * the call cap, or as the page goes away; and it reports that end once,
 * through `reportEnd`. A call whose session never connected reports nothing:
 * `start()` rejects, and the caller reports it.
 */
export class ElevenLabsCall {
  /** When the time limit runs out: counted from the mint's response (`startedAt`). */
  private readonly deadline: number;
  private started = false;
  private conversation: ElevenLabsConversationLike | null = null;
  /** The conversation is the one the engine minted. */
  private verified = false;
  private announced = false;
  /** Transcripts that arrived before the conversation was verified, delivered once it is. */
  private early: VoiceTranscript[] = [];
  /** A disconnect that arrived before the conversation was verified. */
  private earlyDisconnect: { reason: unknown } | null = null;
  private closed = false;
  /** The session's ending, under way or done: a later `stop()` joins it. */
  private closing: Promise<void> = Promise.resolve();
  /** The end report, once the call has ended: settles with the engine's answer, never rejects. */
  private reporting: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The agent is speaking, as the library last said. */
  private speaking = false;
  private saidGoodbye = false;
  /** Since the goodbye was said, the agent started speaking; then it stopped. */
  private goodbyeSpeaking = false;
  private goodbyeSpoken = false;
  /** Wakes the goodbye's wait: on a mode change, or as the call ends. */
  private wake: (() => void) | null = null;

  constructor(private readonly deps: ElevenLabsCallDeps) {
    this.deadline = deps.startedAt + deps.info.time_limit_seconds * 1000;
  }

  /**
   * Start the conversation with the mint's token. Resolves once it is
   * connected, or has ended: a conversation other than the one minted ends
   * the call with {@link MISMATCH_MESSAGE}. Rejects when the session can't
   * connect; the call has then ended, and reported nothing. Runs once.
   */
  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    let conversation: ElevenLabsConversationLike;
    try {
      conversation = await this.deps.libs.startSession(this.sessionOptions());
    } catch (err) {
      // Hung up while it connected: the hang-up reported the end.
      if (this.closed) return;
      this.closed = true;
      // No request can reach the runner, but it ends with the call all the same.
      this.deps.turns.abort(CALL_ENDED);
      throw err;
    }
    if (this.closed) {
      // Hung up while it connected: the late session ends, and its microphone with it.
      await quietly(() => conversation.endSession());
      return;
    }
    this.conversation = conversation;
    // The engine holds credit for, and settles, the conversation it minted: any other is hung up.
    if (conversation.getId() !== this.deps.info.conversation_id) {
      this.early = [];
      await this.close('error', true, { type: 'voice_error', message: MISMATCH_MESSAGE });
      return;
    }
    this.verified = true;
    this.timer = setTimeout(() => this.timeUp(), Math.max(0, this.deadline - this.now()));
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
    this.announce();
    const early = this.early;
    this.early = [];
    for (const transcript of early) this.deps.onTranscript(transcript);
    if (this.earlyDisconnect) this.disconnected(this.earlyDisconnect.reason);
  }

  /**
   * Hang up: the caller's own ending, so `onEnded` is not called. Resolves
   * once the session has ended, its microphone with it. The end report has
   * gone by then; {@link reported} settles with the engine's answer. On a
   * call that has ended already it joins that ending, and reports nothing
   * more.
   */
  stop(reason: VoiceEndReason = 'stopped'): Promise<void> {
    return this.close(reason, false);
  }

  /**
   * Settles once the engine has answered the end report, or the report
   * failed; never rejects. Settled already while the call has not ended, and
   * for a call that never connected (it reports nothing).
   */
  reported(): Promise<void> {
    return this.reporting;
  }

  /**
   * Say goodbye, then end the call as `budget_exhausted`: the budget's time
   * limit passed, or a turn found the end-user's budget spent. The agent gets
   * the mint's notice as the answer to the request it is waiting on, or else
   * as a message. The call ends once the agent has spoken it: after up to
   * {@link GOODBYE_WAIT_MS} for the agent to start speaking and, once it has,
   * as long again for it to finish. An agent already speaking as the notice
   * goes can run straight on into it, with no fresh start: then the call
   * waits as long again for that speech to end. Runs once; never rejects.
   */
  async goodbye(): Promise<void> {
    if (this.saidGoodbye || this.closed || !this.verified) return;
    this.saidGoodbye = true;
    this.clearTimer();
    const { info, turns } = this.deps;
    const speakingAtNotice = this.speaking;
    try {
      if (turns.busy) turns.abort(info.budget_notice);
      else this.conversation?.sendUserMessage(info.budget_notice);
    } catch {
      // The connection is going: the waits below end the call.
    }
    const wait = this.deps.goodbyeWaitMs ?? GOODBYE_WAIT_MS;
    if (await this.waitFor(() => this.goodbyeSpeaking, wait)) {
      await this.waitFor(() => this.goodbyeSpoken, wait);
    } else if (speakingAtNotice && this.speaking) {
      // No fresh start: the speech under way as the notice went ran on into it.
      await this.waitFor(() => !this.speaking, wait);
    }
    await this.close('budget_exhausted', true);
  }

  /**
   * The time limit ran out. A limit at the call cap is the cap, not the end
   * of the end-user's credit: the call ends as `session_cap`, with no
   * goodbye. Under it, the credit ran out: the goodbye.
   */
  private timeUp(): void {
    if (this.deps.info.time_limit_seconds >= CALL_CAP_SECONDS) void this.close('session_cap', true);
    else void this.goodbye();
  }

  /** The options `startSession` gets, as `@elevenlabs/client` 1.29.0 names them. */
  private sessionOptions(): Record<string, unknown> {
    const { info, pagePrompt, turns } = this.deps;
    return {
      conversationToken: info.token,
      connectionType: 'webrtc',
      dynamicVariables: {
        t2v_page_prompt: pagePrompt?.trim() ? unfence(pagePrompt) : NONE_PLACEHOLDER,
        t2v_capabilities: formatCapabilities(info.capabilities),
        t2v_greeting: info.greeting,
      },
      overrides: { agent: { language: info.language } },
      clientTools: {
        ask_talk2view: (parameters?: { request?: unknown }) => turns.ask(String(parameters?.request ?? '')),
      },
      onConnect: () => this.announce(),
      onDisconnect: (details?: { reason?: unknown }) => this.disconnected(details?.reason),
      onModeChange: (change?: { mode?: unknown }) => this.modeChanged(change?.mode),
      onMessage: (payload?: { message?: unknown; role?: unknown }) => this.message(payload),
      onError: (message?: unknown) => {
        if (!this.verified || this.closed) return;
        this.deps.onError(typeof message === 'string' && message ? message : 'Voice connection error');
      },
    };
  }

  /**
   * Tell the caller the call is up, once, and only for the conversation the
   * engine minted. The library fires `onConnect` before `startSession`
   * resolves, so it is `start()` that announces, once the id is checked.
   */
  private announce(): void {
    if (!this.verified || this.closed || this.announced) return;
    this.announced = true;
    this.deps.onConnected();
  }

  /** A line of the transcript; `agent` is the SDK's `bot`. Held back until the conversation is verified. */
  private message(payload?: { message?: unknown; role?: unknown }): void {
    if (this.closed || typeof payload?.message !== 'string') return;
    const transcript: VoiceTranscript = { role: payload.role === 'agent' ? 'bot' : 'user', text: payload.message, final: true };
    if (this.verified) this.deps.onTranscript(transcript);
    else this.early.push(transcript);
  }

  /**
   * The library's session ended: our own `endSession()` (the call has ended
   * by then), the agent hanging up (`agent`, an `idle` ending), or the
   * connection failing (`error`, a `disconnected` one). During the goodbye
   * the call still ends as `budget_exhausted`.
   */
  private disconnected(reason: unknown): void {
    if (this.closed) return;
    if (!this.verified) {
      this.earlyDisconnect ??= { reason };
      return;
    }
    const ending: VoiceEndReason = this.saidGoodbye ? 'budget_exhausted' : reason === 'agent' ? 'idle' : 'disconnected';
    void this.close(ending, true);
  }

  /**
   * The agent started (`speaking`) or stopped (`listening`) speaking. Only
   * the goodbye listens; it also asks whether the agent was speaking as it
   * began.
   */
  private modeChanged(mode: unknown): void {
    if (mode === 'speaking') this.speaking = true;
    else if (mode === 'listening') this.speaking = false;
    if (!this.saidGoodbye) return;
    if (mode === 'speaking') this.goodbyeSpeaking = true;
    else if (mode === 'listening' && this.goodbyeSpeaking) this.goodbyeSpoken = true;
    this.wake?.();
  }

  /**
   * Resolves `true` once `done()` holds, checked now and on every wake;
   * `false` after `ms`, or as soon as the call has ended.
   */
  private waitFor(done: () => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: boolean): void => {
        clearTimeout(timer);
        this.wake = null;
        resolve(value);
      };
      const check = (): void => {
        if (done()) finish(true);
        else if (this.closed) finish(false);
      };
      this.wake = check;
      timer = setTimeout(() => finish(false), ms);
      check();
    });
  }

  /** The page is going away: the end report, a keepalive request, leaves before it does. */
  private readonly onPageHide = (): void => {
    void this.close('disconnected', true);
  };

  /**
   * End the call, once. Stop the time limit and the pagehide listener,
   * answer any request still waiting on a turn, report the end, and end the
   * session; then, when the call ended by itself (`notify`), tell the
   * caller. The report goes first, so it is sent even as the page goes away.
   * Resolves once the session has ended, without waiting for the engine's
   * answer to the report ({@link reported}); never rejects.
   */
  private close(reason: VoiceEndReason, notify: boolean, error?: VoiceError): Promise<void> {
    if (this.closed) return this.closing;
    this.closed = true;
    this.clearTimer();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    this.deps.turns.abort(CALL_ENDED);
    this.reporting = quietly(() => this.deps.reportEnd(reason));
    const conversation = this.conversation;
    this.closing = conversation ? quietly(() => conversation.endSession()) : Promise.resolve();
    this.wake?.();
    if (notify) {
      try {
        if (error) this.deps.onEnded(reason, error);
        else this.deps.onEnded(reason);
      } catch {
        // The caller's failure: the call has ended all the same.
      }
    }
    return this.closing;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
