/**
 * Voice never runs createSession(), which is where chat re-registers the
 * client tools. A signed-out visitor's page-load registration 401s (no end-user
 * yet), so the guest a voice call starts had none of the site's tools and the
 * agent said it could not check anything. Voice's session step now registers
 * them for whoever the session belongs to, once per identity.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(() => () => {}),
    getUser: vi.fn(() => h.user),
    isAnonymous: vi.fn().mockReturnValue(true),
    signingOut: false,
  })),
}));

import { Talk2View } from '../../src/index.js';

type VoiceDeps = { ensureSession: () => Promise<boolean> };
const depsOf = (t2v: Talk2View): VoiceDeps =>
  (t2v.voice as unknown as { deps?: VoiceDeps; options?: VoiceDeps }).deps ??
  (t2v.voice as unknown as { options: VoiceDeps }).options;

describe('voice registers the client tools for the session it starts', () => {
  it('registers once per identity, after the session exists', async () => {
    h.user = null;
    const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
    const reRegister = vi.spyOn(t2v.tools, 'reRegister').mockResolvedValue({ registered: ['search_pages'], count: 1 });
    vi.spyOn(t2v, 'ensureSession').mockImplementation(async () => {
      h.user ??= { id: 'guest-1' }; // the anonymous session this call starts
      return true;
    });
    const { ensureSession } = depsOf(t2v);

    await expect(ensureSession()).resolves.toBe(true);
    expect(reRegister).toHaveBeenCalledTimes(1);
    await ensureSession();
    expect(reRegister).toHaveBeenCalledTimes(1); // same guest: not again

    h.user = { id: 'user-2' };
    await ensureSession();
    expect(reRegister).toHaveBeenCalledTimes(2); // a different end-user: again
  });

  it('does not register when no session could be started', async () => {
    h.user = null;
    const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
    const reRegister = vi.spyOn(t2v.tools, 'reRegister');
    vi.spyOn(t2v, 'ensureSession').mockResolvedValue(false);
    await expect(depsOf(t2v).ensureSession()).resolves.toBe(false);
    expect(reRegister).not.toHaveBeenCalled();
  });

  it('a failed registration does not block the call, and is retried next time', async () => {
    h.user = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t2v = new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
      const reRegister = vi
        .spyOn(t2v.tools, 'reRegister')
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue(null);
      vi.spyOn(t2v, 'ensureSession').mockImplementation(async () => {
        h.user ??= { id: 'guest-3' };
        return true;
      });
      await expect(depsOf(t2v).ensureSession()).resolves.toBe(true);
      await depsOf(t2v).ensureSession();
      expect(reRegister).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
