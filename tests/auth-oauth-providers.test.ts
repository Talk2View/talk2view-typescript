import { describe, it, expect, vi, afterEach } from 'vitest';
import { T2VAuth } from '../src/auth';
import { T2VClient } from '../src/client';
import { T2VError } from '../src/errors';

function makeAuth() {
  const client = new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'https://eng.example' });
  const requestSpy = vi.spyOn(client, 'request');
  const auth = new T2VAuth(client);
  return { auth, client, requestSpy };
}

describe('getPopupProviders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the engine, without a user token, and returns what it lists', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: ['apple', 'google'], reason: null } as any);

    const providers = await auth.getPopupProviders();

    expect(requestSpy).toHaveBeenCalledWith('/v1/auth/oauth/providers', expect.anything(), false);
    expect(providers).toEqual(['apple', 'google']);
  });

  it('asks once per page however many forms mount', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: ['apple', 'google'], reason: null } as any);

    const p1 = auth.getPopupProviders();
    const p2 = auth.getPopupProviders();
    await Promise.all([p1, p2]);
    await auth.getPopupProviders();

    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it('tells the developer what to register when the website is not on the list', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: [], reason: 'origin_not_registered' } as any);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const providers = await auth.getPopupProviders();

    expect(providers).toEqual([]);
    expect(infoSpy).toHaveBeenCalledOnce();
    const message = infoSpy.mock.calls[0]![0] as string;
    expect(message).toContain(window.location.origin);
    expect(message).toContain('Allowed websites');
  });

  it('keeps Google and hides Apple against an engine that predates the endpoint', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockRejectedValue(new T2VError('Not found', 'not_found', 404));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const providers = await auth.getPopupProviders();

    expect(providers).toEqual(['google']);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('never rejects, and offers nothing, on any other failure', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockRejectedValue(new Error('offline'));

    const providers = await auth.getPopupProviders();

    expect(providers).toEqual([]);
  });

  it('asks again after a failure that says nothing about this website', async () => {
    // One dropped request at mount must not hide the buttons until a reload:
    // the next form to mount gets a fresh answer.
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockRejectedValueOnce(new Error('offline'));
    expect(await auth.getPopupProviders()).toEqual([]);

    requestSpy.mockResolvedValueOnce({ providers: ['apple', 'google'], reason: null });
    expect(await auth.getPopupProviders()).toEqual(['apple', 'google']);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('remembers a definite answer, including "this engine has no such endpoint"', async () => {
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockRejectedValue(new T2VError('Not found', 'not_found', 404));
    await auth.getPopupProviders();
    await auth.getPopupProviders();
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('tells the developer their users will see a check screen on an unregistered website', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: ['apple', 'google'], listed: false, reason: null });

    expect(await auth.getPopupProviders()).toEqual(['apple', 'google']);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toContain(window.location.origin);
    expect(info.mock.calls[0]![0]).toContain('Allowed websites');
    expect(info.mock.calls[0]![0]).toContain('confirm this website');
  });

  it('says nothing on a registered website', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: ['apple', 'google'], listed: true, reason: null });
    await auth.getPopupProviders();
    expect(info).not.toHaveBeenCalled();
  });

  it('explains a blocked Referer rather than showing buttons that cannot work', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { auth, requestSpy } = makeAuth();
    requestSpy.mockResolvedValue({ providers: [], listed: false, reason: 'referrer_blocked' });
    expect(await auth.getPopupProviders()).toEqual([]);
    expect(info.mock.calls[0]![0]).toContain('Referrer-Policy');
  });
});
