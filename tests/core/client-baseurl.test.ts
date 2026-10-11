/**
 * The base URL an integrator passes decides where every end-user token goes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';

const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

afterEach(() => vi.restoreAllMocks());

describe('the base URL', () => {
  it('says nothing for https', () => {
    const spy = warn();
    new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'https://engine.talk2view.com' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('says nothing for a local address, which is how people develop', () => {
    const spy = warn();
    new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'http://localhost:8080' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('warns when tokens would cross the network in the clear', () => {
    const spy = warn();
    new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'http://engine.example.com' });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]![0])).toMatch(/not https/i);
  });

  it('warns when it is not a URL at all', () => {
    const spy = warn();
    new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'engine.talk2view.com' });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('the partner key', () => {
  it('refuses a missing one where the mistake was made, not three layers later', () => {
    // The old behaviour sent the literal header `X-T2V-Partner-Key: undefined`
    // and surfaced as a 401 from an unrelated call.
    expect(() => new T2VClient({ partnerKey: '' })).toThrow(/No partner key/);
    expect(() => new T2VClient({ partnerKey: undefined as unknown as string })).toThrow(
      /No partner key/,
    );
  });

  it('says where a key comes from while Talk2View is in private beta', () => {
    let message = '';
    try {
      new T2VClient({ partnerKey: '' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('private beta');
    expect(message).toContain('https://talk2view.com/resources/contact?subject=partner-key');
    expect(message).toContain('https://docs.talk2view.com');
    // Partners cannot create keys in the dashboard, so it must not send them there.
    expect(message).not.toContain('dashboard.talk2view.com');
  });

  it('refuses a secret pasted into the public field', () => {
    expect(() => new T2VClient({ partnerKey: 'sk_live_not_for_browsers' })).toThrow(
      /public identifiers rather than secrets/,
    );
  });

  it('accepts anything shaped like a key, because the rest is the engine’s to judge', () => {
    expect(() => new T2VClient({ partnerKey: 'pk_live_whatever' })).not.toThrow();
    expect(() => new T2VClient({ partnerKey: 'pk_some_future_format' })).not.toThrow();
  });
});
