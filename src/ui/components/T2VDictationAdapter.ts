/**
 * T2VDictationAdapter — Records audio via MediaRecorder and transcribes
 * via Talk2View's /v1/audio/transcriptions endpoint.
 *
 * Implements assistant-ui's DictationAdapter interface so the composer
 * can start/stop dictation and receive transcribed text.
 */

import type { DictationAdapter } from '@assistant-ui/react';
import type { Talk2View } from '../../index';

type Unsubscribe = () => void;

export class T2VDictationAdapter implements DictationAdapter {
  disableInputDuringDictation = true;

  constructor(
    private readonly t2v: Talk2View,
    private readonly sttModel?: string,
    private readonly sttLanguage?: string,
  ) {}

  listen(): DictationAdapter.Session {
    let status: DictationAdapter.Status = { type: 'starting' };
    const speechStartListeners: Array<() => void> = [];
    const speechEndListeners: Array<(result: DictationAdapter.Result) => void> = [];
    const speechListeners: Array<(result: DictationAdapter.Result) => void> = [];

    let mediaRecorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];

    const setStatus = (newStatus: DictationAdapter.Status) => {
      status = newStatus;
    };

    // Start recording
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
        });
        chunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstart = () => {
          setStatus({ type: 'running' });
          speechStartListeners.forEach((cb) => cb());
        };

        mediaRecorder.onstop = async () => {
          // Stop all tracks to release the mic
          stream.getTracks().forEach((t) => t.stop());

          if (chunks.length === 0) {
            setStatus({ type: 'ended', reason: 'cancelled' });
            return;
          }

          try {
            const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
            const formData = new FormData();
            formData.append('file', blob, 'recording.webm');
            if (this.sttModel) formData.append('model', this.sttModel);
            if (this.sttLanguage) formData.append('language', this.sttLanguage);

            const result = await this.t2v.transcribe(formData);
            const transcript = result.text.trim();

            if (transcript) {
              const finalResult: DictationAdapter.Result = {
                transcript,
                isFinal: true,
              };
              speechListeners.forEach((cb) => cb(finalResult));
              speechEndListeners.forEach((cb) => cb(finalResult));
            }

            setStatus({ type: 'ended', reason: 'stopped' });
          } catch (err) {
            console.error('Transcription failed:', err);
            setStatus({ type: 'ended', reason: 'error' });
          }
        };

        mediaRecorder.start();
      })
      .catch((err) => {
        console.error('Microphone access denied:', err);
        setStatus({ type: 'ended', reason: 'error' });
      });

    return {
      get status() {
        return status;
      },

      stop: async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      },

      cancel: () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          chunks = [];
          mediaRecorder.stop();
        }
      },

      onSpeechStart: (cb: () => void): Unsubscribe => {
        speechStartListeners.push(cb);
        return () => {
          const idx = speechStartListeners.indexOf(cb);
          if (idx >= 0) speechStartListeners.splice(idx, 1);
        };
      },

      onSpeechEnd: (cb: (result: DictationAdapter.Result) => void): Unsubscribe => {
        speechEndListeners.push(cb);
        return () => {
          const idx = speechEndListeners.indexOf(cb);
          if (idx >= 0) speechEndListeners.splice(idx, 1);
        };
      },

      onSpeech: (cb: (result: DictationAdapter.Result) => void): Unsubscribe => {
        speechListeners.push(cb);
        return () => {
          const idx = speechListeners.indexOf(cb);
          if (idx >= 0) speechListeners.splice(idx, 1);
        };
      },
    };
  }
}
