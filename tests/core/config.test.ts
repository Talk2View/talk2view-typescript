import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import * as storage from '../../src/storage';
import { Talk2View } from '../../src/index';
import type { PartnerConfig } from '../../src/types';

const PARTNER_CONFIG: PartnerConfig = {
  default_llm_model: 'claude-x',
  default_stt_model: 'whisper-x',
  system_prompt: 'be helpful',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function createT2V(): Talk2View {
  return new Talk2View({ partnerKey: 'pk_test_123', baseUrl: 'http://localhost' });
}

describe('Talk2View.getConfig — single-flight + cache', () => {
  it('coalesces concurrent calls into ONE /v1/config request and resolves both to the same value', async () => {
    const request = vi
      .spyOn(T2VClient.prototype, 'request')
      .mockResolvedValue(PARTNER_CONFIG);
    const t2v = createT2V();

    const [a, b] = await Promise.all([t2v.getConfig(), t2v.getConfig()]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/v1/config');
    expect(a).toBe(PARTNER_CONFIG);
    expect(b).toBe(PARTNER_CONFIG);
  });

  it('serves later callers from cache without a second network request', async () => {
    const request = vi
      .spyOn(T2VClient.prototype, 'request')
      .mockResolvedValue(PARTNER_CONFIG);
    const t2v = createT2V();

    const first = await t2v.getConfig();
    const second = await t2v.getConfig();

    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toBe(PARTNER_CONFIG);
    expect(second).toBe(PARTNER_CONFIG);
  });

  it('refetches after an auth state change (config is auth-scoped, not session-scoped)', async () => {
    // No token → logout() clears locally and notifies listeners with null,
    // exercising the real auth.onAuthStateChange wiring.
    vi.spyOn(storage, 'getAccessToken').mockReturnValue(null);
    const request = vi
      .spyOn(T2VClient.prototype, 'request')
      .mockResolvedValue(PARTNER_CONFIG);
    const t2v = createT2V();

    await t2v.getConfig();
    expect(request).toHaveBeenCalledTimes(1);

    // Auth state changes (e.g. logout / user switch) → cache must invalidate.
    await t2v.auth.logout();

    await t2v.getConfig();
    expect(request).toHaveBeenCalledWith('/v1/config');
    // One config fetch before logout, one after — the logout endpoint is
    // skipped (no token), so the second /v1/config proves the refetch.
    const configCalls = request.mock.calls.filter((c) => c[0] === '/v1/config');
    expect(configCalls).toHaveLength(2);
  });

  it('does not cache a failed request (next call retries)', async () => {
    const request = vi
      .spyOn(T2VClient.prototype, 'request')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(PARTNER_CONFIG);
    const t2v = createT2V();

    await expect(t2v.getConfig()).rejects.toThrow('boom');
    const result = await t2v.getConfig();

    expect(result).toBe(PARTNER_CONFIG);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
