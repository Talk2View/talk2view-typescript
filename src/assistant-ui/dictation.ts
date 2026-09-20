/**
 * Dictation for assistant-ui's composer, transcribed by Talk2View.
 *
 * assistant-ui shows its mic button whenever the runtime has a dictation
 * adapter. This one records with MediaRecorder and sends the clip to the
 * engine's speech-to-text endpoint (`t2v.transcribe`) when the end-user stops
 * — the same flow as the first-party composer in `/ui`, so the partner's
 * speech-to-text models, language setting and billing all apply.
 */
import type { DictationAdapter } from '@assistant-ui/react';
import type { Talk2View } from '../index.js';

export interface Talk2ViewDictationOptions {
  /** Speech-to-text model id (one of `t2v.listAudioModels()`). */
  model?: string;
  /** Spoken language hint, e.g. `'en'`. Omit to let the model detect it. */
  language?: string;
  /**
   * Called when the microphone is refused or transcription fails. assistant-ui
   * has no surface for a dictation error, so without this the mic just stops.
   */
  onError?: (error: unknown) => void;
  /**
   * Where a dictation is up to. assistant-ui reports "listening" for the whole
   * time, including the wait for the transcript after the end-user stops —
   * use this to show that wait as its own state (`'transcribing'`).
   */
  onPhaseChange?: (phase: Talk2ViewDictationPhase) => void;
}

export type Talk2ViewDictationPhase = 'listening' | 'transcribing' | 'idle';

/** The client, as far as dictation needs it. Only `transcribe` is required. */
export type Talk2ViewDictationClient = Pick<Talk2View, 'transcribe'> &
  Partial<Pick<Talk2View, 'ensureSession' | 'getConfig' | 'warmUp'>>;

/** Used when neither the caller nor the partner configuration names a model. */
export const DEFAULT_DICTATION_MODEL = 'faster-whisper-base';

type Listener<T> = (value: T) => void;

function subscribe<T>(set: Set<Listener<T>>, cb: Listener<T>) {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

/**
 * @param getOptions read when a recording is sent, so a settings change
 *   applies to the next dictation without rebuilding the runtime.
 */
export function createTalk2ViewDictationAdapter(
  t2v: Talk2ViewDictationClient,
  getOptions: () => Talk2ViewDictationOptions = () => ({}),
): DictationAdapter {
  return {
    listen(): DictationAdapter.Session {
      const onStart = new Set<Listener<void>>();
      const onEnd = new Set<Listener<DictationAdapter.Result>>();
      const onSpeech = new Set<Listener<DictationAdapter.Result>>();
      const chunks: Blob[] = [];
      let stream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      let cancelled = false;
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });

      const releaseMic = () => stream?.getTracks().forEach((track) => track.stop());
      const phase = (next: Talk2ViewDictationPhase) => getOptions().onPhaseChange?.(next);

      const finish = (reason: 'stopped' | 'cancelled' | 'error') => {
        releaseMic();
        session.status = { type: 'ended', reason };
        phase('idle');
        settle();
      };

      // A logged-out visitor's first action can be the mic. Start the session
      // and mint their key now, while they talk. The two are kept apart: the
      // model lookup below needs only the session, and the mint is seconds long
      // — a short clip must not wait for it. `async` wrappers so a client whose
      // method throws synchronously cannot take the mic down with it.
      const startSession = async () => void (await t2v.ensureSession?.());
      const warm = async () => void (await t2v.warmUp?.());
      const warming = warm().catch(() => undefined);
      // Without ensureSession() the warm-up is the only thing that starts one.
      const ready = t2v.ensureSession ? startSession().catch(() => undefined) : warming;
      const partnerModel = ready
        .then(() => t2v.getConfig?.())
        .then((config) => config?.default_stt_model || undefined)
        .catch(() => undefined);

      const session: DictationAdapter.Session = {
        status: { type: 'starting' },
        // Resolves only once the transcript has been delivered: the composer
        // unsubscribes as soon as stop() settles, and the clip is transcribed
        // after the recording ends, not during it.
        stop: async () => {
          if (recorder?.state === 'recording') recorder.stop();
          else if (session.status.type !== 'ended' && !recorder) cancelled = true;
          await settled;
        },
        cancel: () => {
          cancelled = true;
          if (recorder?.state === 'recording') recorder.stop();
          else if (session.status.type !== 'ended') finish('cancelled');
        },
        onSpeechStart: (cb) => subscribe(onStart, cb),
        onSpeechEnd: (cb) => subscribe(onEnd, cb),
        onSpeech: (cb) => subscribe(onSpeech, cb),
      };

      void (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) return finish('cancelled');

          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';
          recorder = new MediaRecorder(stream, { mimeType });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = async () => {
            // The clip is complete: the browser's recording indicator goes off
            // now, not after the engine answers.
            releaseMic();
            if (cancelled || chunks.length === 0) return finish(cancelled ? 'cancelled' : 'stopped');
            phase('transcribing');
            try {
              const { model: chosen, language } = getOptions();
              const model = chosen || (await partnerModel);
              const form = new FormData();
              form.append('file', new Blob(chunks, { type: mimeType }), 'recording.webm');
              form.append('model', model || DEFAULT_DICTATION_MODEL);
              if (language) form.append('language', language);

              const transcript = (await t2v.transcribe(form)).text.trim();
              if (transcript && !cancelled) {
                // The composer appends on a final `onSpeech`; `onSpeechEnd` only closes the session.
                onSpeech.forEach((cb) => cb({ transcript, isFinal: true }));
                onEnd.forEach((cb) => cb({ transcript }));
              }
              finish(cancelled ? 'cancelled' : 'stopped');
            } catch (error) {
              getOptions().onError?.(error);
              finish('error');
            }
          };
          recorder.start();
          session.status = { type: 'running' };
          phase('listening');
          onStart.forEach((cb) => cb());
        } catch (error) {
          // Microphone refused, or no MediaRecorder in this browser.
          getOptions().onError?.(error);
          finish('error');
        }
      })();

      return session;
    },
  };
}
