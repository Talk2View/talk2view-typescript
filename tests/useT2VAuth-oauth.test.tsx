import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useT2VAuth } from '../src/react/useT2VAuth';

const signInWithGoogle = vi.fn().mockResolvedValue({ id: 'u1' });
vi.mock('../src/react/T2VProvider', () => ({
  useT2V: () => ({ t2v: { auth: { signInWithGoogle } }, user: null, isAuthenticated: false }),
}));

describe('useT2VAuth google', () => {
  it('delegates signInWithGoogle to the client', async () => {
    const { result } = renderHook(() => useT2VAuth());
    await act(async () => { await result.current.signInWithGoogle(); });
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });
});
