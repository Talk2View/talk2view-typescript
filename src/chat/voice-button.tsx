'use client';

/**
 * `<VoiceButton>` — press to talk to the agent, press again to hang up.
 *
 * Inside `<Talk2ViewChat>` or the launcher it takes the chat's client and shows
 * only when the partner has voice enabled (`/v1/config` →
 * `voice_agent_enabled`) and `features.voice` is not false. Standalone it takes
 * a `client` prop, and whether to render it is the integrator's call.
 *
 * Everything here is display. The call itself is `t2v.voice` (the facade in
 * `src/voice-facade.ts`), which runs the SAME tool registry, permission check
 * and approvals as chat, so partners write no new code for voice. The one
 * control is `start()` / `stop()`: a press while the call is connecting or live
 * is a `stop()`, and the controller is what releases the microphone.
 */
import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { LoaderCircleIcon, MicIcon, XIcon } from 'lucide-react';
import type { Talk2View } from '../index.js';
import type {
  PartnerConfig,
  VoiceEndReason,
  VoiceError,
  VoicePendingApproval,
  VoiceState,
} from '../types.js';
import { ApprovalCard } from '../ui/components/ApprovalCard.js';
import { BrandWaveform } from './composer-extras.js';
import { cn } from './lib/cn.js';
import { useOptionalChatContext, type Talk2ViewChatFeatures } from './provider.js';

export interface VoiceButtonProps {
  /** Needed outside a chat; inside one the chat's client is used. */
  client?: Talk2View;
  className?: string;
  /** Accessible name. Default "Talk to Talk2View". */
  label?: string;
  /** A short local sound when the microphone goes live (default true). */
  earcon?: boolean;
}

/** The launcher's gate: the integrator has not turned voice off, and the partner has it on. */
export function shouldShowVoice(
  features: Pick<Talk2ViewChatFeatures, 'voice'>,
  config: PartnerConfig | null,
): boolean {
  return features.voice !== false && !!config?.voice_agent_enabled;
}

/** Two rising notes, about 200 ms, from the Web Audio API. Nothing is fetched. */
export function playListeningEarcon(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [660, 0],
      [880, 0.09],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.2, now + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.13);
    }
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // No audio context (tests, locked-down browsers): silence is fine.
  }
}

/**
 * What to tell the end-user for each `VoiceError.type`. Written here rather
 * than taken from `error.message`, so a reason reads the same whichever layer
 * raised it (engine, voice service, transport). `voice_error` is the catch-all:
 * its message is the controller's own, so it is shown as it comes, as is any
 * type added later.
 */
const ERROR_MESSAGES: Record<string, string> = {
  voice_disabled: 'Voice isn’t turned on for this app.',
  account_required: 'Sign in to use voice.',
  auth_expired: 'Your sign-in expired. Sign in again to use voice.',
  insufficient_credit: 'You’re out of credit for now.',
  credit_check_unavailable: 'Couldn’t check your credit just now. Try again shortly.',
  service_unconfigured: 'Voice isn’t available right now.',
  service_unavailable: 'Voice isn’t available right now. Try again shortly.',
  voice_at_capacity: 'Voice is busy right now. Try again shortly.',
  voice_ticket_invalid: 'The call took too long to connect. Try again.',
  upstream_error: 'Voice couldn’t reach the assistant. Try again.',
  transport_error: 'The call couldn’t connect. Check your connection and try again.',
};

export function voiceErrorMessage(error: VoiceError): string {
  return ERROR_MESSAGES[error.type] ?? (error.message || 'Something went wrong with voice. Try again.');
}

/** Why a call ended, when it was not the end-user's own press. */
const ENDED_MESSAGES: Partial<Record<VoiceEndReason, string>> = {
  disconnected: 'The call dropped.',
  session_cap: 'The call reached its time limit.',
  idle: 'The call ended after a quiet spell.',
  error: 'The call ended.',
};
/** How long the "call ended" note stays up. An error stays until it is dismissed or a new call starts. */
const ENDED_NOTE_MS = 4000;

export const VoiceButton: FC<VoiceButtonProps> = (props) => {
  const ctx = useOptionalChatContext();
  const client = props.client ?? ctx?.client;
  if (!client) {
    throw new Error('<VoiceButton> needs a client prop, or must render inside <Talk2ViewChat>.');
  }
  // Inside a chat the partner's switch applies; standalone the integrator decides.
  if (ctx && !shouldShowVoice(ctx.features, ctx.config)) return null;
  return <VoiceControl {...props} client={client} standalone={!ctx} />;
};

const VoiceControl: FC<VoiceButtonProps & { client: Talk2View; standalone: boolean }> = ({
  client,
  standalone,
  className,
  label = 'Talk to Talk2View',
  earcon = true,
}) => {
  const voice = client.voice;
  const [state, setState] = useState<VoiceState>(() => voice.state);
  const [error, setError] = useState<VoiceError | null>(null);
  const [approval, setApproval] = useState<VoicePendingApproval | null>(null);
  const [working, setWorking] = useState(false);
  const [endedNote, setEndedNote] = useState<string | null>(null);
  // Read by the listeners, so changing the prop does not re-subscribe.
  const earconRef = useRef(earcon);
  earconRef.current = earcon;

  useEffect(() => {
    // A remount mid-call (StrictMode, a re-keyed parent) picks up where it is.
    setState(voice.state);
    const offs = [
      voice.on('stateChange', (next) => {
        setState(next);
        if (next !== 'listening') setWorking(false);
        if (next === 'connecting' || next === 'listening') {
          setError(null);
          setEndedNote(null);
        }
        if (next === 'listening' && earconRef.current) playListeningEarcon();
      }),
      voice.on('error', setError),
      voice.on('approvalChange', setApproval),
      voice.on('agentState', (agent) => setWorking(agent === 'working')),
      voice.on('ended', (reason) => setEndedNote(ENDED_MESSAGES[reason] ?? null)),
    ];
    return () => offs.forEach((off) => off());
  }, [voice]);

  // A button that goes away takes its call with it: nothing may keep the
  // microphone open behind a control the end-user can no longer see.
  useEffect(
    () => () => {
      if (voice.state === 'connecting' || voice.state === 'listening') void voice.stop();
    },
    [voice],
  );

  useEffect(() => {
    if (!endedNote) return;
    const timer = setTimeout(() => setEndedNote(null), ENDED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [endedNote]);

  const on = state === 'connecting' || state === 'listening';

  const toggle = useCallback(() => {
    if (voice.state === 'connecting' || voice.state === 'listening') {
      void voice.stop();
      return;
    }
    voice.start().catch(() => {
      // Reported through the 'error' event and shown below.
    });
  }, [voice]);

  const status =
    state === 'connecting'
      ? 'Connecting…'
      : state === 'listening'
        ? working
          ? 'Working…'
          : 'Listening'
        : state === 'ended' && !error
          ? endedNote
          : null;

  const icon: ReactNode =
    state === 'connecting' ? (
      <LoaderCircleIcon className="t2v-voice-spin size-6" aria-hidden="true" />
    ) : state === 'listening' ? (
      // The brand's voice mark, as the composer's dictation face uses it.
      <BrandWaveform mode={working ? 'busy' : 'live'} className="h-[20px] w-[22px]" />
    ) : (
      <MicIcon className="size-6" aria-hidden="true" />
    );

  return (
    <div className={cn('t2v-voice', standalone && 't2v-chat', className)} data-on={on ? '' : undefined}>
      {error || approval || status ? (
        <div className="t2v-voice-popover">
          {error ? (
            <div role="alert" className="t2v-voice-error">
              <span>{voiceErrorMessage(error)}</span>
              <button
                type="button"
                className="t2v-voice-dismiss"
                aria-label="Dismiss"
                onClick={() => setError(null)}
              >
                <XIcon className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {approval ? (
            <div className="t2v-voice-approval">
              <ApprovalCard
                // A new card per call: a half-edited argument must not carry over.
                key={approval.toolCallId}
                toolName={approval.toolName}
                toolCallId={approval.toolCallId}
                args={approval.arguments}
                description={approval.description}
                onDecision={(decision) => approval.decide(decision)}
              />
            </div>
          ) : null}
          {status && !error ? (
            <div aria-hidden="true" className="t2v-voice-status">
              {status}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Always in the DOM, so a screen reader hears each change: a live region
          that appears together with its text is often not announced. */}
      <span role="status" className="t2v-voice-sr">
        {error ? '' : (status ?? '')}
      </span>
      <button
        type="button"
        className="t2v-voice-button"
        onClick={toggle}
        aria-label={label}
        title={on ? 'End the call' : label}
        aria-pressed={on}
        aria-busy={state === 'connecting' || undefined}
        data-state={state}
        data-busy={working ? 'true' : undefined}
      >
        {icon}
      </button>
    </div>
  );
};
