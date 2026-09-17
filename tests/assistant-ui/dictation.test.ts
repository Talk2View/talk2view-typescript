import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTalk2ViewDictationAdapter, DEFAULT_DICTATION_MODEL } from '../../src/assistant-ui/dictation';

/** Just enough MediaRecorder for the adapter: start, stop → dataavailable + stop. */
class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  static last: FakeRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  emitsAudio = true;
  constructor(public stream: MediaStream, public options: { mimeType: string }) {
    FakeRecorder.last = this;
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (this.emitsAudio) this.ondataavailable?.({ data: new Blob(['audio'], { type: this.options.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  stopTrack.mockReset();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  FakeRecorder.last = null;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});
afterEach(() => vi.unstubAllGlobals());

describe('createTalk2ViewDictationAdapter', () => {
  it('records, transcribes on stop, and delivers the text before stop() settles', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: '  send the report to Dr Chen ' });
    const session = createTalk2ViewDictationAdapter({ transcribe }, () => ({ model: 'scribe-v2', language: 'en' })).listen();
    const order: string[] = [];
    session.onSpeechStart(() => order.push('start'));
    session.onSpeech((r) => order.push(`speech:${r.transcript}:${r.isFinal}`));
    session.onSpeechEnd((r) => order.push(`end:${r.transcript}`));

    expect(session.status).toEqual({ type: 'starting' });
    await flush();
    expect(session.status).toEqual({ type: 'running' });

    await session.stop().then(() => order.push('stop-settled'));

    // The composer unsubscribes when stop() settles, so the text has to land first.
    expect(order).toEqual([
      'start',
      'speech:send the report to Dr Chen:true',
      'end:send the report to Dr Chen',
      'stop-settled',
    ]);
    expect(session.status).toEqual({ type: 'ended', reason: 'stopped' });
    expect(stopTrack).toHaveBeenCalled();

    const form = transcribe.mock.calls[0]![0] as FormData;
    expect(form.get('model')).toBe('scribe-v2');
    expect(form.get('language')).toBe('en');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('falls back to the default model and sends no language when none is chosen', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe }).listen();
    await flush();
    await session.stop();
    const form = transcribe.mock.calls[0]![0] as FormData;
    expect(form.get('model')).toBe(DEFAULT_DICTATION_MODEL);
    expect(form.has('language')).toBe(false);
  });

  it('reads the options when the clip is sent, not when listening began', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    let model = 'first';
    const session = createTalk2ViewDictationAdapter({ transcribe }, () => ({ model })).listen();
    await flush();
    model = 'second';
    await session.stop();
    expect((transcribe.mock.calls[0]![0] as FormData).get('model')).toBe('second');
  });

  it('cancel discards the recording without transcribing', async () => {
    const transcribe = vi.fn();
    const session = createTalk2ViewDictationAdapter({ transcribe }).listen();
    const speech = vi.fn();
    session.onSpeech(speech);
    await flush();
    session.cancel();
    await flush();
    expect(transcribe).not.toHaveBeenCalled();
    expect(speech).not.toHaveBeenCalled();
    expect(session.status).toEqual({ type: 'ended', reason: 'cancelled' });
    expect(stopTrack).toHaveBeenCalled();
  });

  it('ends with an error when the microphone is refused', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const session = createTalk2ViewDictationAdapter({ transcribe: vi.fn() }).listen();
    await flush();
    expect(session.status).toEqual({ type: 'ended', reason: 'error' });
    await expect(session.stop()).resolves.toBeUndefined();
  });

  it('ends with an error, and inserts nothing, when transcription fails', async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error('engine down'));
    const session = createTalk2ViewDictationAdapter({ transcribe }).listen();
    const speech = vi.fn();
    session.onSpeech(speech);
    await flush();
    await session.stop();
    expect(speech).not.toHaveBeenCalled();
    expect(session.status).toEqual({ type: 'ended', reason: 'error' });
  });

  it('reports a refused microphone and a failed transcription to onError', async () => {
    const onError = vi.fn();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    createTalk2ViewDictationAdapter({ transcribe: vi.fn() }, () => ({ onError })).listen();
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'NotAllowedError' }));

    const failure = new Error('engine down');
    const session = createTalk2ViewDictationAdapter({ transcribe: vi.fn().mockRejectedValue(failure) }, () => ({ onError })).listen();
    await flush();
    await session.stop();
    expect(onError).toHaveBeenLastCalledWith(failure);
  });

  it('inserts nothing for silence', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: '   ' });
    const session = createTalk2ViewDictationAdapter({ transcribe }).listen();
    const speech = vi.fn();
    session.onSpeech(speech);
    await flush();
    await session.stop();
    expect(speech).not.toHaveBeenCalled();
    expect(session.status).toEqual({ type: 'ended', reason: 'stopped' });
  });
  it('releases the microphone when recording stops, not when the transcript arrives', async () => {
    let deliver!: (r: { text: string }) => void;
    const transcribe = vi.fn(() => new Promise<{ text: string }>((r) => { deliver = r; }));
    const session = createTalk2ViewDictationAdapter({ transcribe }).listen();
    await flush();
    const stopping = session.stop();
    await flush();
    // Still waiting on the engine — but the browser's "recording" light must be off.
    expect(stopTrack).toHaveBeenCalled();
    expect(session.status).toEqual({ type: 'running' });
    deliver({ text: 'hi' });
    await stopping;
  });

  it('reports listening, then transcribing, then idle', async () => {
    const phases: string[] = [];
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe }, () => ({ onPhaseChange: (p) => phases.push(p) })).listen();
    await flush();
    await session.stop();
    expect(phases).toEqual(['listening', 'transcribing', 'idle']);
  });

  it('ends on idle when cancelled or refused', async () => {
    const phases: string[] = [];
    const options = () => ({ onPhaseChange: (p: string) => phases.push(p) });
    const session = createTalk2ViewDictationAdapter({ transcribe: vi.fn() }, options).listen();
    await flush();
    session.cancel();
    await flush();
    expect(phases).toEqual(['listening', 'idle']);

    phases.length = 0;
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    createTalk2ViewDictationAdapter({ transcribe: vi.fn() }, options).listen();
    await flush();
    expect(phases).toEqual(['idle']);
  });

  it('starts the session while the end-user is still talking', async () => {
    const ensureSession = vi.fn().mockResolvedValue(true);
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    createTalk2ViewDictationAdapter({ transcribe, ensureSession }).listen();
    await flush();
    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('warms the key when listening begins, and still transcribes if warming fails', async () => {
    const warmUp = vi.fn().mockRejectedValue(new Error('offline'));
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe, warmUp }).listen();
    await flush();
    expect(warmUp).toHaveBeenCalledTimes(1);
    await session.stop();
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("uses the partner's default voice model when none is chosen", async () => {
    const order: string[] = [];
    const ensureSession = vi.fn(async () => { order.push('session'); return true; });
    const getConfig = vi.fn(async () => { order.push('config'); return { default_stt_model: 'scribe-v2' }; });
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe, ensureSession, getConfig }).listen();
    await flush();
    await session.stop();
    // Config needs auth, so it is asked for after the session exists.
    expect(order).toEqual(['session', 'config']);
    expect((transcribe.mock.calls[0]![0] as FormData).get('model')).toBe('scribe-v2');
  });

  it('prefers a chosen model, and falls back when the partner has no default or config fails', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const getConfig = vi.fn().mockResolvedValue({ default_stt_model: 'scribe-v2' });
    let session = createTalk2ViewDictationAdapter({ transcribe, getConfig }, () => ({ model: 'medasr' })).listen();
    await flush();
    await session.stop();
    expect((transcribe.mock.calls[0]![0] as FormData).get('model')).toBe('medasr');

    for (const broken of [vi.fn().mockResolvedValue({ default_stt_model: null }), vi.fn().mockRejectedValue(new Error('401'))]) {
      transcribe.mockClear();
      session = createTalk2ViewDictationAdapter({ transcribe, getConfig: broken }).listen();
      await flush();
      await session.stop();
      expect((transcribe.mock.calls[0]![0] as FormData).get('model')).toBe(DEFAULT_DICTATION_MODEL);
    }
  });
  it("does not hold the partner's voice model behind the key warm-up", async () => {
    // The warm-up is a 2-5 s mint. The model lookup only needs the session, so
    // a short clip must not wait for the mint before it can be sent.
    const warmUp = vi.fn(() => new Promise<void>(() => {})); // never settles
    const ensureSession = vi.fn().mockResolvedValue(true);
    const getConfig = vi.fn().mockResolvedValue({ default_stt_model: 'scribe-v2' });
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe, warmUp, ensureSession, getConfig }).listen();
    await flush();
    expect(warmUp).toHaveBeenCalledTimes(1);
    expect(getConfig).toHaveBeenCalledTimes(1);
    await session.stop();
    expect((transcribe.mock.calls[0]![0] as FormData).get('model')).toBe('scribe-v2');
  });

  it('keeps the mic working when a client\'s warmUp throws synchronously', async () => {
    const warmUp = vi.fn(() => { throw new Error('boom'); });
    const transcribe = vi.fn().mockResolvedValue({ text: 'hi' });
    const session = createTalk2ViewDictationAdapter({ transcribe, warmUp }).listen();
    await flush();
    expect(session.status).toEqual({ type: 'running' });
    await session.stop();
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});
