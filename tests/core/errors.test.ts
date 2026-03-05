import { describe, expect, it } from 'vitest';
import { T2VError } from '../../src/errors';

describe('T2VError', () => {
  it('exposes the code field when provided', () => {
    const err = new T2VError('bad request', 'validation_error', 400, 'invalid_input');
    expect(err.message).toBe('bad request');
    expect(err.type).toBe('validation_error');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('invalid_input');
  });

  it('code is undefined when not provided', () => {
    const err = new T2VError('fail');
    expect(err.code).toBeUndefined();
  });
});
