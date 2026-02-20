/**
 * ChatMessage — renders a single chat message bubble with markdown support.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import React, { useMemo } from 'react';
import type { DisplayMessage } from './useT2VChat';
import { T2V_COLORS, T2V_FONTS } from './theme';

// Configure marked for inline-friendly output
marked.setOptions({ breaks: true, gfm: true });

export interface ChatMessageProps {
  message: DisplayMessage;
  className?: string;
}

export function ChatMessage({ message, className = '' }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const time = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const htmlContent = useMemo(() => {
    if (isUser || !message.content) return '';
    const raw = marked.parse(message.content);
    if (typeof raw !== 'string') return '';
    return DOMPurify.sanitize(raw);
  }, [isUser, message.content]);

  return (
    <div
      className={`t2v-message t2v-message--${message.role} ${className}`}
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '12px',
        animation: 't2v-fade-in 0.25s ease-out',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          backgroundColor: isUser ? T2V_COLORS.dark : 'rgba(64, 212, 182, 0.08)',
          color: isUser ? T2V_COLORS.light : T2V_COLORS.dark,
          fontSize: '14px',
          fontFamily: T2V_FONTS.body,
          lineHeight: '1.55',
          wordBreak: 'break-word',
          ...(isUser ? { whiteSpace: 'pre-wrap' as const } : {}),
        }}
      >
        {isUser ? (
          <div>{message.content}</div>
        ) : (
          <div
            className="t2v-markdown"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        )}
        {message.isStreaming && (
          <span
            style={{
              display: 'inline-block',
              width: '2px',
              height: '14px',
              backgroundColor: isUser ? T2V_COLORS.light : T2V_COLORS.turquoise,
              marginLeft: '2px',
              animation: 't2v-blink 1s infinite',
            }}
          />
        )}
        <div
          style={{
            fontSize: '10px',
            fontFamily: T2V_FONTS.heading,
            color: isUser ? 'rgba(248, 250, 252, 0.5)' : T2V_COLORS.midGray,
            marginTop: '4px',
            textAlign: 'right',
          }}
        >
          {time}
        </div>
      </div>
    </div>
  );
}
