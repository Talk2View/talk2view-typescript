/**
 * ChatMessage — renders a single chat message bubble with markdown support.
 *
 * Features:
 * - React.memo with custom comparator for streaming performance
 * - Copy button on assistant messages (appears on hover)
 * - Code block headers with language label + copy button
 * - Inline PlanStep and ToolStepIndicator components
 * - ARIA attributes for accessibility
 */

import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayMessage, ToolStep as ToolStepData } from './useT2VChat';
import { T2V_ALPHA, T2V_COLORS, T2V_FONTS } from './theme';

/** Escape HTML special chars for safe interpolation into attribute values. */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Isolated marked instance — avoids leaking config into partner apps
const md = new Marked({ breaks: true, gfm: true });

// Custom renderer: wrap code blocks with a header (language label + copy button)
const renderer = new md.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const langLabel = escapeHtml(lang || 'code');
  const escaped = escapeHtml(text);
  return (
    `<pre><div class="t2v-code-header"><span>${langLabel}</span>` +
    `<button class="t2v-code-copy" type="button" aria-label="Copy code">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
    `<span>Copy</span></button></div>` +
    `<code class="language-${langLabel}">${escaped}</code></pre>`
  );
};

export interface ChatMessageProps {
  message: DisplayMessage;
  className?: string;
}

/** Fields that affect rendering — used by React.memo comparator. */
function getRenderProps(msg: DisplayMessage) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    isStreaming: msg.isStreaming,
    plan: msg.plan,
    stepsLen: msg.steps?.length ?? 0,
  };
}

export const ChatMessage = React.memo(
  function ChatMessage({ message, className = '' }: ChatMessageProps) {
    const isUser = message.role === 'user';
    const time = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const contentRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);

    const htmlContent = useMemo(() => {
      if (isUser || !message.content) return '';
      const raw = md.parse(message.content, { renderer });
      if (typeof raw !== 'string') return '';
      return DOMPurify.sanitize(raw, {
        ADD_ATTR: ['aria-label'],
      });
    }, [isUser, message.content]);

    // Attach click handlers to code block copy buttons (imperative DOM)
    useEffect(() => {
      if (!contentRef.current) return;
      const buttons = contentRef.current.querySelectorAll<HTMLButtonElement>('.t2v-code-copy');
      const handlers: Array<[HTMLButtonElement, () => void]> = [];

      buttons.forEach((btn) => {
        const pre = btn.closest('pre');
        const code = pre?.querySelector('code');
        if (!code) return;

        const handler = () => {
          navigator.clipboard.writeText(code.textContent ?? '').then(() => {
            btn.setAttribute('data-copied', 'true');
            const label = btn.querySelector('span');
            if (label) label.textContent = 'Copied';
            setTimeout(() => {
              btn.removeAttribute('data-copied');
              if (label) label.textContent = 'Copy';
            }, 2000);
          }).catch(() => { /* clipboard unavailable (iframe / insecure context) */ });
        };
        btn.addEventListener('click', handler);
        handlers.push([btn, handler]);
      });

      return () => {
        handlers.forEach(([btn, handler]) => btn.removeEventListener('click', handler));
      };
    }, [htmlContent]);

    // Copy full message text
    const handleCopyMessage = useCallback(() => {
      navigator.clipboard.writeText(message.content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => { /* clipboard unavailable */ });
    }, [message.content]);

    return (
      <div
        className={`t2v-message t2v-message--${message.role} ${className}`}
        role="article"
        aria-label={`${isUser ? 'You' : 'Assistant'} at ${time}`}
        style={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          marginBottom: '12px',
          animation: 't2v-fade-in 0.25s ease-out',
        }}
      >
        <div
          style={{
            position: 'relative',
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
            backgroundColor: isUser ? T2V_ALPHA.turquoise15 : T2V_ALPHA.turquoise08,
            color: T2V_COLORS.dark,
            fontSize: '14px',
            fontFamily: T2V_FONTS.body,
            lineHeight: '1.55',
            wordBreak: 'break-word',
            ...(isUser ? { whiteSpace: 'pre-wrap' as const } : {}),
          }}
        >
          {/* Copy button — assistant messages only, visible on hover */}
          {!isUser && message.content && !message.isStreaming && (
            <button
              className="t2v-msg-copy"
              onClick={handleCopyMessage}
              data-copied={copied || undefined}
              aria-label={copied ? 'Copied' : 'Copy message'}
              type="button"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}

          {isUser ? (
            <div>{message.content}</div>
          ) : (
            <>
              {message.plan && (
                <PlanStep content={message.plan} isActive={message.isStreaming} />
              )}
              {message.steps?.map((step, i) => (
                <ToolStepIndicator key={`${step.name}-${i}`} step={step} />
              ))}
              <div
                ref={contentRef}
                className="t2v-markdown"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </>
          )}
          {message.isStreaming && (
            <span
              aria-label="Typing"
              style={{
                display: 'inline-block',
                width: '2px',
                height: '14px',
                backgroundColor: T2V_COLORS.turquoise,
                marginLeft: '2px',
                animation: 't2v-blink 1s infinite',
              }}
            />
          )}
          <time
            dateTime={message.timestamp.toISOString()}
            style={{
              display: 'block',
              fontSize: '10px',
              fontFamily: T2V_FONTS.heading,
              color: T2V_COLORS.midGray,
              marginTop: '4px',
              textAlign: 'right',
            }}
          >
            {time}
          </time>
        </div>
      </div>
    );
  },
  (prev, next) => {
    const a = getRenderProps(prev.message);
    const b = getRenderProps(next.message);
    return (
      a.id === b.id &&
      a.content === b.content &&
      a.isStreaming === b.isStreaming &&
      a.plan === b.plan &&
      a.stepsLen === b.stepsLen &&
      prev.className === next.className
    );
  },
);

/* ── PlanStep — Chainlit-inspired collapsible inline step ─────────── */

function PlanStep({ content, isActive }: { content: string; isActive?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [content]);

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      const timer = setTimeout(() => setExpanded(false), 600);
      return () => clearTimeout(timer);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  const planHtml = useMemo(() => {
    const raw = md.parse(content);
    if (typeof raw !== 'string') return '';
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['input'],
      ADD_ATTR: ['type', 'checked', 'disabled'],
    });
  }, [content]);

  return (
    <div
      style={{
        borderLeft: `2px solid ${isActive ? T2V_COLORS.turquoise : T2V_ALPHA.turquoise20}`,
        borderRadius: '0 6px 6px 0',
        backgroundColor: T2V_ALPHA.turquoise06,
        marginBottom: '10px',
        transition: 'border-color 0.3s ease',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={isActive ? 'Planning in progress' : 'Plan'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '7px 10px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '12px',
          fontFamily: T2V_FONTS.heading,
          fontWeight: 600,
          color: isActive ? T2V_COLORS.dark : T2V_COLORS.midGray,
          transition: 'color 0.3s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isActive ? T2V_COLORS.turquoise : T2V_COLORS.midGray} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'stroke 0.3s ease' }}>
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span className={isActive ? 't2v-shimmer' : ''}>{isActive ? 'Planning...' : 'Plan'}</span>
        <span style={{ flex: 1 }} />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease', opacity: 0.5 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div style={{ overflow: 'hidden', maxHeight: expanded ? (contentHeight ?? 500) : 0, opacity: expanded ? 1 : 0, transition: 'max-height 0.25s ease, opacity 0.2s ease' }}>
        <div ref={contentRef} className="t2v-plan-content" style={{ padding: '0 10px 8px', fontFamily: T2V_FONTS.body }} dangerouslySetInnerHTML={{ __html: planHtml }} />
      </div>
    </div>
  );
}

/* ── ToolStepIndicator — Chainlit "Used {tool}" collapsed step ───── */

function ToolStepIndicator({ step }: { step: ToolStepData }) {
  const isDenied = step.status === 'denied';
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', marginBottom: '6px',
        borderLeft: `2px solid ${isDenied ? `${T2V_COLORS.errorRed}40` : T2V_ALPHA.turquoise20}`,
        borderRadius: '0 4px 4px 0',
        backgroundColor: isDenied ? `${T2V_COLORS.errorRed}0A` : T2V_ALPHA.turquoise06,
        animation: 't2v-fade-in 0.25s ease-out',
      }}
    >
      {isDenied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T2V_COLORS.errorRed} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T2V_COLORS.turquoise} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span style={{ fontSize: '11px', fontFamily: T2V_FONTS.heading, fontWeight: 500, color: T2V_COLORS.midGray }}>
        {isDenied ? 'Denied' : 'Used'} {step.name}
      </span>
    </div>
  );
}
