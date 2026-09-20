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
