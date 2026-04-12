/**
 * Composer — text input + mic button for sending messages.
 *
 * - Auto-resizing textarea (min 1 row, max ~120px).
 * - Send on Enter, Shift+Enter inserts newline.
 * - Disabled while loading.
 * - Mic button records audio via MediaRecorder, sends to t2v.transcribe(),
 *   and inserts the transcript into the textarea.
 * - Prefers audio/webm;codecs=opus, falls back to audio/webm.
 * - STT model/language from useUserPreferences + usePartnerConfig.
 * - Send button uses accent color when text is present, border color when empty.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Loader2 } from 'lucide-react';
import { useChat } from '../context';
import { useTalk2View } from '../context';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';

export function Composer() {
  const { sendMessage, isLoading } = useChat();
  const { t2v } = useTalk2View();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();

  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setText('');
    sendMessage(trimmed).catch(console.error);
  }, [text, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleMic = useCallback(async () => {
    if (isRecording) {
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

          const sttModel =
            preferences.sttModel ||
            partnerConfig?.default_stt_model ||
            'faster-whisper-base';
          const sttLanguage = preferences.sttLanguage;
          formData.append('model', sttModel);
          if (sttLanguage) formData.append('language', sttLanguage);

          const result = await t2v.transcribe(formData);
          const transcript = result.text.trim();
          if (transcript) {
            setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
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
  }, [isRecording, t2v, preferences.sttModel, preferences.sttLanguage, partnerConfig?.default_stt_model]);

  const hasText = text.trim().length > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '6px',
        padding: '10px 12px',
        borderTop: '1px solid var(--t2v-border)',
        background: 'var(--t2v-bg)',
        fontFamily: 'var(--t2v-font)',
      }}
    >
      {/* Auto-resizing textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        placeholder="Type a message…"
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          border: '1px solid var(--t2v-border)',
          borderRadius: 'calc(var(--t2v-radius) * 0.75px)',
          padding: '8px 10px',
          fontSize: '14px',
          lineHeight: 1.5,
          fontFamily: 'var(--t2v-font)',
          color: 'var(--t2v-foreground)',
          background: 'var(--t2v-bg)',
          outline: 'none',
          minHeight: '36px',
          maxHeight: '120px',
          overflowY: 'auto',
          transition: 'border-color 0.15s',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--t2v-accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--t2v-border)';
        }}
      />

      {/* Mic button */}
      <button
        type="button"
        onClick={() => { handleMic().catch(console.error); }}
        disabled={isTranscribing}
        aria-label={
          isTranscribing
            ? 'Transcribing…'
            : isRecording
              ? 'Stop recording'
              : 'Voice input'
        }
        style={{
          width: '36px',
          height: '36px',
          flexShrink: 0,
          borderRadius: 'calc(var(--t2v-radius) * 0.75px)',
          border: 'none',
          background: isRecording ? 'var(--t2v-error)' : 'var(--t2v-accent)',
          color: 'var(--t2v-accent-foreground)',
          cursor: isTranscribing ? 'wait' : 'pointer',
          opacity: isTranscribing ? 0.6 : 1,
          transition: 'background 0.15s, opacity 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isTranscribing ? <Loader2 size={16} style={{ animation: 't2v-spin 0.8s linear infinite' }} /> : isRecording ? <Square size={16} /> : <Mic size={16} />}
      </button>

      {/* Send button */}
      <button
        type="button"
        onClick={handleSend}
        disabled={isLoading || !hasText}
        aria-label="Send message"
        style={{
          width: '36px',
          height: '36px',
          flexShrink: 0,
          borderRadius: 'calc(var(--t2v-radius) * 0.75px)',
          border: hasText ? 'none' : '1px solid var(--t2v-border)',
          background: hasText ? 'var(--t2v-accent)' : 'transparent',
          color: hasText ? 'var(--t2v-accent-foreground)' : 'var(--t2v-muted)',
          cursor: hasText && !isLoading ? 'pointer' : 'default',
          opacity: isLoading ? 0.5 : 1,
          transition: 'background 0.15s, border 0.15s, color 0.15s, opacity 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Send size={16} />
      </button>
    </div>
  );
}

