import { useEffect, useRef, useState } from 'react';

/** Steady reveal rate (characters/second) while streaming. */
const CHARS_PER_SECOND = 80;

/**
 * Progressively reveals `target` while `isStreaming`, easing the visible length
 * toward `target.length` at a steady rate (assistant-ui "smooth" reveal feel).
 * Snaps to the full text when streaming ends, when there is no rAF (SSR/tests
 * without rAF), or on unmount. Self-contained.
 */
export function useSmoothText(target: string, isStreaming: boolean): string {
  const [revealed, setRevealed] = useState<string>(() => (isStreaming ? '' : target));
  const lengthRef = useRef<number>(isStreaming ? 0 : target.length);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    const canAnimate =
      isStreaming &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function';

    if (!canAnimate) {
      lengthRef.current = target.length;
      setRevealed(target);
      return;
    }

    // A new turn can make `target` shorter than what we already revealed; restart.
    if (lengthRef.current > target.length) lengthRef.current = 0;
    lastTsRef.current = null;

    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const remaining = target.length - lengthRef.current;
      // Steady base rate, plus catch-up so very long messages don't lag.
      const step = Math.max(CHARS_PER_SECOND * dt, remaining * dt * 3);
      lengthRef.current = Math.min(target.length, lengthRef.current + step);
      setRevealed(target.slice(0, Math.floor(lengthRef.current)));

      if (lengthRef.current < target.length) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [target, isStreaming]);

  return revealed;
}
