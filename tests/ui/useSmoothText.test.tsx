import { renderHook, act } from '@testing-library/react';
import { useSmoothText } from '../../src/ui/useSmoothText';

describe('useSmoothText', () => {
  let frame: ((ts: number) => void) | null = null;

  beforeEach(() => {
    frame = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => { frame = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function pump(ts: number) {
    act(() => { frame?.(ts); });
  }

  const LONG = 'hello world this is a longer streaming message body';

  it('returns the full text immediately when not streaming', () => {
    const { result } = renderHook(() => useSmoothText('hello world', false));
    expect(result.current).toBe('hello world');
  });

  it('reveals progressively while streaming, then completes', () => {
    const { result } = renderHook(() => useSmoothText(LONG, true));
    expect(result.current).toBe('');
    pump(0);                 // establish baseline timestamp
    pump(100);               // ~0.1s later → partial
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan(LONG.length);
    pump(10000);             // far ahead → fully revealed
    expect(result.current).toBe(LONG);
  });

  it('snaps to the full text when streaming stops', () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: boolean }) => useSmoothText('done text', s),
      { initialProps: { s: true } },
    );
    pump(0);
    rerender({ s: false });
    expect(result.current).toBe('done text');
  });
});
