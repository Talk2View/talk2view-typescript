/**
 * A logged-out visitor can open Settings before sending anything. The model
 * lists need auth, and nothing had started the anonymous session yet, so both
 * pickers came back 401 ("couldn't load the list"). The two lists are fetched
 * side by side, so the start has to be shared — two starts would be two guest
 * accounts against the partner's daily anonymous cap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VError } from '../../src/errors';

const request = vi.fn();
const startAnonymous = vi.fn();

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request, streamRequest: vi.fn(), uploadRequest: vi.fn() })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    startAnonymous,
  })),
}));

import { Talk2View } from '../../src/index';

beforeEach(() => {
  localStorage.clear();
  request.mockReset().mockResolvedValue({ object: 'list', data: [] });
  startAnonymous.mockReset().mockResolvedValue(undefined);
});

describe('model lists for a logged-out visitor', () => {
  it('starts the anonymous session before listing chat models', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    const order: string[] = [];
    startAnonymous.mockImplementation(async () => { order.push('anonymous'); });
    request.mockImplementation(async (path: string) => { order.push(path); return { object: 'list', data: [] }; });

    await t2v.listModels();
    expect(order).toEqual(['anonymous', '/v1/models']);
  });

  it('starts it before listing voice models, and keeps their supported languages', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    request.mockResolvedValue({ object: 'list', data: [{ id: 'scribe-v2', supported_languages: ['en', 'vi'] }] });

    const res = await t2v.listAudioModels();
    expect(startAnonymous).toHaveBeenCalledTimes(1);
    expect(res.data[0]!.supported_languages).toEqual(['en', 'vi']);
  });

  it('shares one start between lists fetched side by side', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    let release!: () => void;
    startAnonymous.mockImplementation(() => new Promise<void>((r) => { release = r; }));

    const both = Promise.all([t2v.listModels(), t2v.listAudioModels()]);
    await Promise.resolve();
    release();
    await both;
    expect(startAnonymous).toHaveBeenCalledTimes(1);
  });

  it('asks for sign-in, and lists nothing, when the partner refuses anonymous access', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    startAnonymous.mockRejectedValue(new T2VError('off', 'anonymous_access_disabled', 403));

    await expect(t2v.listModels()).rejects.toMatchObject({ type: 'sign_in_required' });
    expect(request).not.toHaveBeenCalled();
  });

  it('starts nothing when auto-start is off', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', anonymousAutoStart: false });
    await t2v.listModels();
    expect(startAnonymous).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('/v1/models');
  });
});
