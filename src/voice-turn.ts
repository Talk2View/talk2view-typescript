/**
 * The voice turn runner: each `ask_talk2view` request of an ElevenLabs voice
 * call becomes an engine turn on the end-user's chat session, one at a time,
 * as the voice service's handoff does for Gemini Live (`va/handoff.py`).
 *
 * An identical request already in flight or queued is merged
 * ({@link ALREADY_WORKING}); a different one waits its turn. Every `ask()`
 * resolves with plain text for the agent to speak.
 *
 * Keep this module out of core's up-front bundle: only the voice controller,
 * which core loads with `import()`, may import it.
 */

import type { T2VSession, TurnOptions } from './sessions.js';
import type { ChatEvent, HumanDecision, PendingApproval } from './types.js';

/** The answer to a request identical to one already in flight or queued. */
export const ALREADY_WORKING = 'status: already_working (still on the previous request)';

/** The answer when a turn ends without any text. */
export const NO_TEXT = '(the agent returned no text)';

/** The answer when a turn could not be run. */
export const TURN_FAILED = 'error: I couldn’t reach the assistant just now.';

/**
 * What the engine is told about a voice turn: the reply is spoken, and the
 * call collects no approvals and shows no platform-tool activity.
 */
export const VOICE_TURN: TurnOptions = { surface: 'voice', supportsApproval: false, supportsToolEvents: false };

/**
 * What makes two requests the same: lower-cased, whitespace collapsed to
 * single spaces, and trailing `?`, `.`, `!` and spaces dropped, as the voice
 * service's `normalise_request` (`va/handoff.py`).
 */
export function normaliseRequest(text: string): string {
  const collapsed = text.toLowerCase().trim().split(/\s+/).join(' ');
  let end = collapsed.length;
  while (end > 0 && '?.! '.includes(collapsed.charAt(end - 1))) end -= 1;
  return collapsed.slice(0, end);
}

export interface VoiceTurnDeps {
  /** The end-user's chat session the mint names: every turn runs on it. */
  session: T2VSession;
  /** The page prompt, sent as each turn's system message. */
  pagePrompt?: string;
  /**
   * Shows the card for a client tool call that needs the end-user's go-ahead,
   * and resolves with their decision, or with `endedBecause` when the card
   * closed unanswered. The caller remembers an `always`.
   */
  onApproval: (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ decision: HumanDecision; endedBecause?: string }>;
  /** Whether the end-user has said `always` to this tool: it runs without a card. */
  isAlwaysAllowed: (toolName: string) => boolean;
  /** `working` as a turn starts, `idle` once it settles. */
  onState: (state: 'working' | 'idle') => void;
  /** A turn found the end-user's budget spent: the call says goodbye. */
  onBudgetExceeded: () => void;
}

/**
 * Runs a voice call's requests as engine turns, one at a time. `abort()`
 * answers every pending `ask()` at once, as the call ends.
 */
export class VoiceTurnRunner {
  /** Normalised requests in flight or queued. */
  private readonly inFlight = new Set<string>();
  /** The last turn queued: the next one starts when it settles. */
  private last: Promise<unknown> = Promise.resolve();
  /** The controller of the turn in flight. */
  private controller: AbortController | null = null;
  /** Set by {@link abort}: from then on every `ask()` resolves with it. */
  private reason: string | null = null;
  /** Resolves with the reason on {@link abort}; every `ask()` races it. */
  private readonly aborted: Promise<string>;
  private resolveAborted!: (reason: string) => void;

  constructor(private readonly deps: VoiceTurnDeps) {
    this.aborted = new Promise((resolve) => {
      this.resolveAborted = resolve;
    });
  }

  /** A turn is in flight or queued. */
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  /**
   * Run `request` as an engine turn. Resolves with the turn's text, trimmed,
   * or {@link NO_TEXT}; `error: <message>` when the engine reports an error;
   * {@link TURN_FAILED} when the turn could not be run; {@link ALREADY_WORKING}
   * when the same request is already in flight or queued; once aborted, the
   * abort reason.
   */
  ask(request: string): Promise<string> {
    if (this.reason !== null) return Promise.resolve(this.reason);
    const key = normaliseRequest(request);
    if (this.inFlight.has(key)) return Promise.resolve(ALREADY_WORKING);
    // One turn at a time, in order. With none in flight or queued this one
    // starts now, so the engine has it at once.
    const start = (): Promise<string> => this.run(request);
    const idle = !this.busy;
    this.inFlight.add(key);
    const turn = (idle ? start() : this.last.then(start)).finally(() => this.inFlight.delete(key));
    this.last = turn;
    return Promise.race([turn, this.aborted]);
  }

  /**
   * End the runner for good: abort the turn in flight, resolve its `ask()`
   * and every queued one with `reason`, and resolve later ones with it at once.
   */
  abort(reason: string): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.inFlight.clear();
    this.controller?.abort();
    this.resolveAborted(reason);
  }

  /** One turn, unless the runner was aborted while it waited. */
  private async run(request: string): Promise<string> {
    if (this.reason !== null) return this.reason;
    const controller = new AbortController();
    this.controller = controller;
    try {
      this.deps.onState('working');
      return await this.turn(request, controller.signal);
    } catch {
      return TURN_FAILED;
    } finally {
      this.controller = null;
      this.deps.onState('idle');
    }
  }

  /** The turn's answer, from its stream and the stream of each resume. */
  private async turn(request: string, signal: AbortSignal): Promise<string> {
    let text = '';
    let events = this.deps.session.sendMessage(request, { systemPrompt: this.deps.pagePrompt, signal, ...VOICE_TURN });
    for (;;) {
      let approval: PendingApproval | null = null;
      for await (const event of events) {
        if (event.type === 'text') {
          text += event.content;
        } else if (event.type === 'approval_required') {
          approval = {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            arguments: event.arguments,
            description: event.description,
          };
        } else if (event.type === 'error') {
          if (event.errorType === 'budget_exceeded') this.deps.onBudgetExceeded();
          return `error: ${event.message}`;
        }
      }
      if (approval === null) return text.trim() || NO_TEXT;
      // Aborted while the tool permission was checked, or (below) while the
      // card was open: the ask has resolved with the reason already, so no
      // card opens, no tool runs and no resume is sent.
      if (signal.aborted) return TURN_FAILED;
      events = await this.resume(approval, signal);
      if (signal.aborted) return TURN_FAILED;
    }
  }

  /**
   * The resume of a tool call that needs the end-user's go-ahead: approved at
   * once for a tool they always allow, else their decision on the card, or
   * the reason the card closed without one. Nothing runs until it is read.
   */
  private async resume(approval: PendingApproval, signal: AbortSignal): Promise<AsyncGenerator<ChatEvent>> {
    const { session } = this.deps;
    if (this.deps.isAlwaysAllowed(approval.toolName)) {
      return session.respondToApproval(approval, { action: 'once' }, signal, VOICE_TURN);
    }
    const { decision, endedBecause } = await this.deps.onApproval(
      approval.toolCallId,
      approval.toolName,
      approval.arguments,
    );
    if (endedBecause) {
      return session.resumeToolCall(approval.toolCallId, JSON.stringify({ error: endedBecause }), true, signal, VOICE_TURN);
    }
    return session.respondToApproval(approval, decision, signal, VOICE_TURN);
  }
}
