import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useT2VAuth } from '../src/react/useT2VAuth';

const signInWithGoogle = vi.fn().mockResolvedValue({ id: 'u1' });
const signInWithApple = vi.fn().mockResolvedValue({ id: 'u1' });
const getPopupProviders = vi.fn().mockResolvedValue(['apple']);
vi.mock('../src/react/T2VProvider', () => ({
  useT2V: () => ({
    t2v: { auth: { signInWithGoogle, signInWithApple, getPopupProviders } },
    user: null,
    isAuthenticated: false,
  }),
}));

describe('useT2VAuth google', () => {
  it('delegates signInWithGoogle to the client', async () => {
    const { result } = renderHook(() => useT2VAuth());
    await act(async () => { await result.current.signInWithGoogle(); });
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('delegates signInWithApple to the client, and reports a failure', async () => {
    const { result } = renderHook(() => useT2VAuth());
    await act(async () => { await result.current.signInWithApple(); });
    expect(signInWithApple).toHaveBeenCalledOnce();

    signInWithApple.mockRejectedValueOnce(new Error('Popup blocked. Please allow popups and try again.'));
    await act(async () => { await result.current.signInWithApple().catch(() => {}); });
    expect(result.current.error).toMatch(/popup blocked/i);
    expect(result.current.oauthLoading).toBe(false);
  });

  it('finds out which popup providers are available and reports them once known', async () => {
    const { result } = renderHook(() => useT2VAuth());
    expect(result.current.oauthProviders).toBeNull();

    await act(async () => {});

    expect(result.current.oauthProviders).toEqual(['apple']);
  });
});
