/**
 * ChatInput — text input with mic and send buttons.
 *
 * Voice input uses MediaRecorder + Talk2View's /v1/audio/transcriptions endpoint.
 */

import React, { useCallback, useRef, useState } from 'react';
import { getLiteLLMApiKey } from '../storage';
import { T2V_COLORS, T2V_FONTS } from './theme';
import { useT2V } from './T2VProvider';

export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  className = '',
}: ChatInputProps) {
  const { t2v } = useT2V();
  const [value, setValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const [micHover, setMicHover] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const canSend = value.trim().length > 0 && !disabled;
  const micDisabled = disabled || isTranscribing;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed);
      setValue('');
    },
    [value, disabled, onSend],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsTranscribing(true);
      try {
        const voiceUrl = t2v.config.voiceApiUrl || t2v.config.baseUrl || 'http://localhost:8000';
        const url = `${voiceUrl}/v1/audio/transcriptions`;

        const apiKey = getLiteLLMApiKey();
        const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';

        const formData = new FormData();
        formData.append('file', audioBlob, `recording.${ext}`);
        formData.append('model', 'whisper-1');

        const headers: Record<string, string> = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(url, { method: 'POST', headers, body: formData });

        if (!response.ok) {
          console.error('Transcription failed:', response.status);
          return;
        }

        const data = await response.json();
        const text = data.text?.trim();
        if (text) {
          onSend(text);
        }
      } catch (err) {
        console.error('Transcription error:', err);
      } finally {
        setIsTranscribing(false);
      }
    },
    [t2v, onSend],
  );

  const toggleRecording = useCallback(async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (audioBlob.size > 0) {
          transcribeAudio(audioBlob);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [isRecording, transcribeAudio]);

  return (
    <form
      onSubmit={handleSubmit}
      className={`t2v-chat-input ${className}`}
      style={{
        display: 'flex',
        gap: '8px',
        padding: '12px',
        borderTop: `1px solid ${T2V_COLORS.lightGray}`,
        backgroundColor: T2V_COLORS.light,
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        placeholder={isRecording ? 'Recording...' : isTranscribing ? 'Transcribing...' : placeholder}
        disabled={disabled}
        style={{
          flex: 1,
          padding: '10px 14px',
          borderRadius: '8px',
          border: `1.5px solid ${inputFocused ? T2V_COLORS.turquoise : T2V_COLORS.lightGray}`,
          fontSize: '14px',
          fontFamily: T2V_FONTS.body,
          outline: 'none',
          backgroundColor: disabled ? T2V_COLORS.lightGray : '#ffffff',
          color: T2V_COLORS.dark,
          boxShadow: inputFocused ? `0 0 0 3px rgba(64, 212, 182, 0.15)` : 'none',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        }}
      />
      {/* Mic button */}
      <button
        type="button"
        onClick={toggleRecording}
        disabled={micDisabled}
        onMouseEnter={() => setMicHover(true)}
        onMouseLeave={() => setMicHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '42px',
          height: '42px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: isRecording
            ? T2V_COLORS.errorRed
            : isTranscribing
              ? T2V_COLORS.turquoise
              : micHover
                ? T2V_COLORS.stormyTeal
                : T2V_COLORS.lightGray,
          color: isRecording || isTranscribing || micHover ? T2V_COLORS.light : T2V_COLORS.midGray,
          cursor: micDisabled ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.15s ease, transform 0.15s ease',
          transform: micHover && !micDisabled ? 'translateY(-1px)' : 'none',
          flexShrink: 0,
        }}
        aria-label={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Start voice input'}
      >
        {isTranscribing ? (
          <span
            style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              border: `2px solid ${T2V_COLORS.light}`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 't2v-spin 0.6s linear infinite',
            }}
          />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
      {/* Send button */}
      <button
        type="submit"
        disabled={!canSend}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '42px',
          height: '42px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: canSend
            ? btnHover
              ? T2V_COLORS.stormyTeal
              : T2V_COLORS.accent
            : T2V_COLORS.lightGray,
          color: canSend ? T2V_COLORS.dark : T2V_COLORS.midGray,
          cursor: canSend ? 'pointer' : 'not-allowed',
          transition: 'background-color 0.15s ease, transform 0.15s ease',
          transform: canSend && btnHover ? 'translateY(-1px)' : 'none',
          flexShrink: 0,
        }}
        aria-label="Send message"
      >
        {/* Send arrow icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}
