'use client';

/**
 * The voice button, mounted into the composer through the one slot the vendored
 * thread carries (`scripts/chat/patches/thread.aui.patch`). Supplying the slot
 * replaces upstream's mic and stop buttons, so this renders both states.
 *
 * One button for the whole dictation: the inverted wave face. While listening
 * the bars move like a level meter and a tap stops. After the tap the clip is on
 * its way to the engine: the same bars settle into short dashes that pulse left
 * to right, a beam circles the face, and taps are ignored. The glyph never swaps
 * for a different icon and the button never remounts, so nothing flickers.
 */
import type { FC } from 'react';
import { AuiIf, ComposerPrimitive } from '@assistant-ui/react';
import { TooltipIconButton } from './vendor/tooltip-icon-button.js';
import { cn } from './lib/cn.js';
import { useDictationPhase } from './lib/dictation-phase.js';
import { useChatContext } from './provider.js';

/* The Talk2View voice mark — T2Board's BrandWaveform, geometry copied from
   T2BoardKeyboard/Keyboard/BrandWaveform.swift: four SHARP bars (the brand's
   dash, never rounded caps) at 0.42 / 1.0 / 0.66 / 0.30 of the height, each 44%
   of its slot wide, in a 1.1 : 1 box, growing from the middle out. The face
   follows T2Board too: Smoke on Teal at rest, inverting to Teal on Smoke while
   listening. `live` moves the bars like a level meter and `busy` pulses them in
   order; both say what the mic is doing, so they run under reduced motion too. */
const WAVE_LEVELS = [0.42, 1.0, 0.66, 0.3];
const BUSY_LEVELS = [0.5, 0.5, 0.5, 0.5];

export const BrandWaveform: FC<{ mode?: 'rest' | 'live' | 'busy'; className?: string }> = ({
  mode = 'rest',
  className,
}) => (
  <svg
    viewBox="0 0 110 100"
    fill="currentColor"
    aria-hidden="true"
    // 40% of the 28px face, as in BrandWaveformFace. size-auto: ui/button.tsx
    // shrinks any svg without a `size-` class to 16px.
    className={cn('size-auto h-[11px] w-[12px] overflow-visible', className)}
  >
    {/* Busy: equal short dashes, so the pulse reads as one travelling beat. */}
    {(mode === 'busy' ? BUSY_LEVELS : WAVE_LEVELS).map((level, i) => (
      <rect
        key={i}
        x={27.5 * (i + 0.5) - 6.05}
        y={50 - level * 50}
        width={12.1}
        height={level * 100}
        className={mode === 'rest' ? undefined : `t2v-wave-bar t2v-wave-${mode}`}
        // Listening: out of phase, like speech. Busy: in order, left to right.
        style={
          mode === 'rest'
            ? undefined
            : { animationDelay: mode === 'live' ? `${i * -0.23}s` : `${i * 0.14}s` }
        }
      />
    ))}
  </svg>
);

const ComposerStartDictation: FC = () => (
  <ComposerPrimitive.Dictate
    render={
      <TooltipIconButton
        tooltip="Voice input"
        side="bottom"
        type="button"
        variant="ghost"
        size="icon"
        // Tokens, not hexes: Teal on Smoke by default, because that is what
        // `--primary` / `--primary-foreground` are, and a partner who rethemes
        // the chat gets a voice button that follows. `hover:` repeats them so
        // the ghost variant cannot repaint the face on hover; brightness is
        // what gives the press its feedback.
        className="aui-composer-dictate bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground size-7 rounded-full hover:brightness-95"
        aria-label="Start voice input"
      />
    }
  >
    <BrandWaveform className="aui-composer-dictate-icon" />
  </ComposerPrimitive.Dictate>
);

const ComposerStopDictation: FC = () => {
  const { dictation } = useChatContext();
  const busy = useDictationPhase(dictation) === 'transcribing';
  return (
    <ComposerPrimitive.StopDictation
      render={
        <TooltipIconButton
          tooltip={busy ? 'Transcribing…' : 'Stop dictation'}
          side="bottom"
          type="button"
          variant="ghost"
          size="icon"
          aria-label={busy ? 'Transcribing' : 'Stop voice input'}
          aria-busy={busy || undefined}
          data-busy={busy ? '' : undefined}
          // The inverted face, in the same two tokens the other way round. The
          // dark override stays: `--primary-foreground` is Smoke in both
          // palettes, and a Smoke face on the dark chat's Smoke ground would
          // vanish — `--secondary` is the dark palette's raised surface.
          className="aui-composer-stop-dictation t2v-voice-face bg-primary-foreground text-primary hover:bg-primary-foreground hover:text-primary dark:bg-secondary dark:hover:bg-secondary relative size-7 rounded-full data-busy:pointer-events-none data-busy:cursor-progress"
        />
      }
    >
      <BrandWaveform mode={busy ? 'busy' : 'live'} className="aui-composer-stop-dictation-icon" />
    </ComposerPrimitive.StopDictation>
  );
};

/**
 * Both halves of the voice control. The slot sits inside the thread's own
 * `capabilities.dictation` gate, so a runtime without a dictation adapter shows
 * nothing at all.
 */
export const ComposerDictation: FC = () => (
  <>
    <AuiIf condition={(s) => s.composer.dictation == null}>
      <ComposerStartDictation />
    </AuiIf>
    <AuiIf condition={(s) => s.composer.dictation != null}>
      <ComposerStopDictation />
    </AuiIf>
  </>
);
