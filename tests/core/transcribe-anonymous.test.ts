/**
 * A logged-out visitor's first action can be the mic, not a message. chat()
 * and uploadAttachment() start the anonymous session themselves; transcribe()
 * did not, so dictating before the first message failed auth — silently, in
 * both the first-party composer and the assistant-ui adapter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VError } from '../../src/errors';

const uploadRequest = vi.fn();
const startAnonymous = vi.fn();

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request: vi.fn(), streamRequest: vi.fn(), uploadRequest })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    startAnonymous,
  })),
}));

import { Talk2View } from '../../src/index';

const clip = () => {
  const form = new FormData();
  form.append('file', new Blob(['a'], { type: 'audio/webm' }), 'recording.webm');
  form.append('model', 'faster-whisper-base');
  return form;
};

beforeEach(() => {
  localStorage.clear();
  uploadRequest.mockReset().mockResolvedValue({ text: 'hello' });
  startAnonymous.mockReset().mockResolvedValue(undefined);
});

describe('Talk2View.transcribe for a logged-out visitor', () => {
  it('starts the anonymous session before sending the clip', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    const order: string[] = [];
    startAnonymous.mockImplementation(async () => { order.push('anonymous'); });
    uploadRequest.mockImplementation(async () => { order.push('upload'); return { text: 'hello' }; });

    await expect(t2v.transcribe(clip())).resolves.toEqual({ text: 'hello' });
    expect(order).toEqual(['anonymous', 'upload']);
    expect(uploadRequest).toHaveBeenCalledWith('/v1/audio/transcriptions', expect.any(FormData));
  });

  it('asks for sign-in, and sends nothing, when the partner refuses anonymous access', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    const unavailable = vi.fn();
    t2v.on('anonymousUnavailable', unavailable);
    startAnonymous.mockRejectedValue(new T2VError('off', 'anonymous_access_disabled', 403));

    await expect(t2v.transcribe(clip())).rejects.toMatchObject({ type: 'sign_in_required' });
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith('anonymous_access_disabled');
  });

  it('does not start a session when auto-start is switched off', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', anonymousAutoStart: false });
    await t2v.transcribe(clip());
    expect(startAnonymous).not.toHaveBeenCalled();
    expect(uploadRequest).toHaveBeenCalledTimes(1);
  });
});
