/**
 * T2VComposer — assistant-ui's default Composer + mic button.
 *
 * Uses assistant-ui's own styled sub-components (Root, Input, Action)
 * so everything aligns perfectly. Adds a mic button that records audio
 * and transcribes via Talk2View's STT endpoint, then inserts the text
 * into the composer input.
 */

import React from 'react';
import { Composer as DefaultComposer } from '@assistant-ui/react-ui';
import { useAssistantRuntime } from '@assistant-ui/react';
import { useT2V } from '../../react/T2VProvider';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';
import { T2V_COLORS } from '../../react/theme';

export const T2VComposer: React.FC = () => {
  return (
    <DefaultComposer.Root>
      <DefaultComposer.Input autoFocus />
      <MicButton />
      <DefaultComposer.Action />
    </DefaultComposer.Root>
  );
};

/**
 * Mic button that records audio directly via MediaRecorder,
 * sends to Talk2View's /v1/audio/transcriptions, and sets
 * the transcript text on the composer.
 *
 * Bypasses the DictationAdapter layer for reliability —
 * handles recording and transcription entirely in-component.
 */
function MicButton() {
  const runtime = useAssistantRuntime();
  const { t2v } = useT2V();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const [isRecording, setIsRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);

  const handleClick = React.useCallback(async () => {
    if (isRecording) {
      // Stop recording — onstop handler will transcribe
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const chunks = chunksRef.current;
        if (chunks.length === 0) return;

        setIsTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: mimeType });
          const formData = new FormData();
          formData.append('file', blob, 'recording.webm');

          const sttModel = preferences.sttModel || partnerConfig?.default_stt_model || 'faster-whisper-base';
          const sttLanguage = preferences.sttLanguage;
          formData.append('model', sttModel);
          if (sttLanguage) formData.append('language', sttLanguage);

          const result = await t2v.transcribe(formData);
          const transcript = result.text.trim();

          if (transcript) {
            const current = runtime.thread.composer.getState().text;
            runtime.thread.composer.setText(
              current ? `${current} ${transcript}` : transcript,
            );
            runtime.thread.composer.send();
          }
        } catch (err) {
          console.error('Transcription failed:', err);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [isRecording, t2v, runtime, preferences.sttModel, preferences.sttLanguage, partnerConfig?.default_stt_model]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isTranscribing}
      aria-label={isTranscribing ? 'Transcribing...' : isRecording ? 'Stop recording' : 'Voice input'}
      style={{
        marginTop: '0.625rem',
        marginBottom: '0.625rem',
        marginRight: '0.25rem',
        width: '2rem',
        height: '2rem',
        padding: '0.5rem',
        flexShrink: 0,
        borderRadius: '0.5rem',
        border: 'none',
        backgroundColor: isRecording ? T2V_COLORS.errorRed : T2V_COLORS.turquoise,
        color: '#fff',
        cursor: isTranscribing ? 'wait' : 'pointer',
        opacity: isTranscribing ? 0.6 : undefined,
        transition: 'background-color 0.15s ease, opacity 0.15s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isTranscribing ? <SpinnerIcon /> : isRecording ? <StopCircleIcon /> : <MicIcon />}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ animation: 't2v-spin 0.8s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function StopCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}
