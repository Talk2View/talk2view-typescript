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
import { Mic, Send, Square, Check, Loader2, Paperclip, X, Info } from 'lucide-react';
import { useChat } from '../context.js';
import { useTalk2View } from '../context.js';
import { useUserPreferences } from '../../react/useUserPreferences.js';
import { usePartnerConfig } from '../../react/usePartnerConfig.js';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_TYPES_LABEL,
  isAllowedAttachmentType,
} from '../../constants.js';
import type { Attachment } from '../../types.js';

interface PendingAttachment {
  /** Local key — stable across the upload lifecycle. */
  localId: string;
  filename: string;
  status: 'uploading' | 'ready';
  attachment?: Attachment;
}

export function Composer() {
  const { sendMessage, isLoading, stop } = useChat();
  const { t2v } = useTalk2View();
  const { preferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();

  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // Transient, friendly hint shown under the composer (unsupported pick, or a
  // server rejection like size/quota). Auto-dismisses.
  const [notice, setNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const localIdRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Clear any pending dismiss timer on unmount.
  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const uploadsInFlight = pendingAttachments.some((p) => p.status === 'uploading');
  const readyAttachments = pendingAttachments
    .filter((p) => p.status === 'ready' && p.attachment)
    .map((p) => p.attachment!);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && readyAttachments.length === 0) || isLoading || uploadsInFlight) return;
    setText('');
    setPendingAttachments([]);
    if (readyAttachments.length > 0) {
      sendMessage(trimmed, { attachments: readyAttachments }).catch(console.error);
    } else {
      sendMessage(trimmed).catch(console.error);
    }
  }, [text, isLoading, uploadsInFlight, readyAttachments, sendMessage]);

  const handleFilesSelected = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const rejected: string[] = [];
      for (const file of Array.from(files)) {
        // Bounce unsupported types before uploading, so the user gets an
        // instant, friendly hint instead of a silent server 415. The public
        // uploadAttachment() enforces the same whitelist for headless callers.
        if (!isAllowedAttachmentType(file.type)) {
          rejected.push(file.name);
          continue;
        }
        const localId = `att-local-${++localIdRef.current}`;
        setPendingAttachments((prev) => [
          ...prev,
          { localId, filename: file.name, status: 'uploading' },
        ]);
        t2v
          .uploadAttachment(file)
          .then((attachment: Attachment) => {
            setPendingAttachments((prev) =>
              prev.map((p) =>
                p.localId === localId ? { ...p, status: 'ready' as const, attachment } : p,
              ),
            );
          })
          .catch((err: unknown) => {
            // Surface the server's reason (size/quota/content mismatch) rather
            // than dropping the chip with no explanation.
            showNotice(err instanceof Error ? err.message : 'Attachment upload failed.');
            setPendingAttachments((prev) => prev.filter((p) => p.localId !== localId));
          });
      }
      if (rejected.length > 0) {
        showNotice(`Can't attach ${rejected.join(', ')} — Talk2View supports ${ATTACHMENT_TYPES_LABEL}.`);
      }
      // Allow re-selecting the same file
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [t2v, showNotice],
  );

  const removeAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => prev.filter((p) => p.localId !== localId));
  }, []);

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
  const hasContent = hasText || readyAttachments.length > 0;
  const canSend = hasContent && !uploadsInFlight;

  return (
    <div style={{ padding: '10px 12px', background: 'var(--t2v-bg)', fontFamily: 'var(--t2v-font)' }}>
      {pendingAttachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingBottom: '8px' }}>
          {pendingAttachments.map((p) => (
            <span
              key={p.localId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: 'var(--t2v-radius-md)',
                border: '1px solid var(--t2v-border)',
                background: 'var(--t2v-surface)',
                fontSize: '12px',
                color: 'var(--t2v-foreground)',
                opacity: p.status === 'uploading' ? 0.6 : 1,
              }}
            >
              {p.status === 'uploading' ? (
                <Loader2 size={12} style={{ animation: 't2v-spin 0.8s linear infinite' }} />
              ) : (
                <Paperclip size={12} />
              )}
              {p.filename}
              <button
                type="button"
                onClick={() => removeAttachment(p.localId)}
                aria-label={`Remove ${p.filename}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--t2v-muted)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {notice && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            paddingBottom: '8px',
            fontSize: '12px',
            lineHeight: 1.4,
            color: 'var(--t2v-muted)',
          }}
        >
          <Info size={13} style={{ flexShrink: 0 }} />
          <span>{notice}</span>
        </div>
      )}
      <div
        className="t2v-composer"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '6px',
          padding: '6px 6px 6px 12px',
          border: '1px solid var(--t2v-border)',
          borderRadius: 'var(--t2v-radius-lg)',
          background: 'var(--t2v-bg)',
          boxShadow: 'var(--t2v-shadow)',
        }}
      >
        {/* Auto-resizing textarea (borderless; the container owns the chrome) */}
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
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '7px 0',
            fontSize: '14px',
            lineHeight: 1.5,
            fontFamily: 'var(--t2v-font)',
            color: 'var(--t2v-foreground)',
            minHeight: '24px',
            maxHeight: '120px',
            overflowY: 'auto',
          }}
        />

        {/* Attach button + hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => handleFilesSelected(e.target.files)}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          aria-label={`Attach a file — ${ATTACHMENT_TYPES_LABEL}`}
          title={`Attach a file — ${ATTACHMENT_TYPES_LABEL}`}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            borderRadius: 'var(--t2v-radius-md)',
            border: 'none',
            background: 'transparent',
            color: 'var(--t2v-muted)',
            cursor: isLoading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s',
          }}
        >
          <Paperclip size={16} />
        </button>

        {/* Mic button */}
        <button
          type="button"
          onClick={() => { handleMic().catch(console.error); }}
          disabled={isTranscribing}
          aria-label={
            isTranscribing ? 'Transcribing…' : isRecording ? 'Finish recording' : 'Voice input'
          }
          title={isRecording ? 'Finish recording' : undefined}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            borderRadius: 'var(--t2v-radius-md)',
            border: 'none',
            background: isRecording ? 'var(--t2v-error)' : 'var(--t2v-accent)',
            color: 'var(--t2v-accent-foreground)',
            cursor: isTranscribing ? 'wait' : 'pointer',
            opacity: isTranscribing ? 0.6 : 1,
            transition: 'background 0.15s, color 0.15s, opacity 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isTranscribing ? <Loader2 size={16} style={{ animation: 't2v-spin 0.8s linear infinite' }} /> : isRecording ? <Check size={16} /> : <Mic size={16} />}
        </button>

        {/* Send button — becomes a Stop button while a response is streaming */}
        <button
          type="button"
          onClick={isLoading ? stop : handleSend}
          disabled={!isLoading && !canSend}
          aria-label={isLoading ? 'Stop generating' : 'Send message'}
          title={isLoading ? 'Stop generating' : undefined}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            borderRadius: 'var(--t2v-radius-md)',
            border: 'none',
            background: isLoading || canSend ? 'var(--t2v-foreground)' : 'transparent',
            color: isLoading || canSend ? '#fff' : 'var(--t2v-muted)',
            cursor: isLoading || canSend ? 'pointer' : 'default',
            opacity: 1,
            transition: 'background 0.15s, color 0.15s, opacity 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isLoading ? <Square size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

