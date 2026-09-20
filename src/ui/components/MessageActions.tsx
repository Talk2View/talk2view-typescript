import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { useChat } from '../context.js';

export interface MessageActionsProps {
  content: string;
  isLast: boolean;
}

export function MessageActions({ content, isLast }: MessageActionsProps) {
  const { retryLastMessage } = useChat();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear timeout on unmount to prevent memory leak
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for insecure contexts (HTTP)
      try {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        clearTimeout(timerRef.current);
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    });
  };

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: '6px',
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: 'var(--t2v-muted)', fontSize: '14px',
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div style={{ display: 'flex', gap: '2px', marginTop: '4px', opacity: 0.6, transition: 'opacity 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
    >
      <button onClick={handleCopy} title={copied ? 'Copied!' : 'Copy message'}
        style={{ ...btnStyle, color: copied ? 'var(--t2v-accent)' : 'var(--t2v-muted)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--t2v-surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {isLast && (
        <button onClick={() => { retryLastMessage().catch(() => {}); }} title="Regenerate response" style={btnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--t2v-surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}
