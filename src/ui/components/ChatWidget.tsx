import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ChatPanel, type ChatPanelProps } from './ChatPanel.js';
import { LOGOS } from '../theme.js';

export interface ChatWidgetProps extends ChatPanelProps {}

export function ChatWidget(props: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 'clamp(84px, 5vw + 64px, 116px)',
          right: 'clamp(16px, 3vw, 24px)',
          width: 'min(400px, calc(100vw - 32px))',
          height: '70vh',
          maxHeight: 'calc(100vh - 132px)',
          borderRadius: 'var(--t2v-radius-lg)',
          border: '1px solid var(--t2v-border)',
          boxShadow: '0 8px 32px rgba(1,22,30,0.14)',
          overflow: 'hidden', zIndex: 999998,
          animation: 't2v-fade-in 0.2s ease-out', background: 'var(--t2v-bg)',
        }}>
          <ChatPanel {...props} />
        </div>
      )}
      {/* Floating trigger — transparent (logo only) when closed, dark with a
          chevron when open; logo and chevron crossfade via scale/rotate. */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        style={{
          position: 'fixed',
          bottom: 'clamp(16px, 3vw, 24px)',
          right: 'clamp(16px, 3vw, 24px)',
          width: 'clamp(3.5rem, 5vw, 5rem)',
          height: 'clamp(3.5rem, 5vw, 5rem)',
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: open ? 'var(--t2v-foreground)' : 'transparent',
          color: open ? '#fff' : 'var(--t2v-foreground)',
          boxShadow: open ? '0 4px 16px rgba(1,22,30,0.18)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999999,
          transition: 'background 0.2s ease, box-shadow 0.2s ease',
        }}
      >
        <img
          src={LOGOS.icon}
          alt="Talk2View"
          className="t2v-modal-logo"
          style={{
            position: 'absolute',
            width: '85%', height: '85%', objectFit: 'contain',
            transform: open ? 'scale(0) rotate(90deg)' : 'scale(1) rotate(0deg)',
            transition: 'transform 150ms ease',
          }}
        />
        <ChevronDown
          size={24}
          className="t2v-modal-chevron"
          style={{
            position: 'absolute',
            transform: open ? 'scale(1) rotate(0deg)' : 'scale(0) rotate(-90deg)',
            transition: 'transform 150ms ease',
          }}
        />
      </button>
    </>
  );
}
