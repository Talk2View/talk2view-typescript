import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { LOGOS } from '../theme';

export interface ChatWidgetProps extends ChatPanelProps {}

export function ChatWidget(props: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', bottom: 'clamp(70px, 5vw + 50px, 100px)',
          right: 'clamp(16px, 3vw, 24px)',
          width: 'min(400px, calc(100vw - 32px))',
          height: 'min(70vh, 600px)',
          borderRadius: 'calc(var(--t2v-radius) * 1px)',
          border: '1px solid var(--t2v-border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          overflow: 'hidden', zIndex: 999998,
          animation: 't2v-fade-in 0.2s ease-out', background: 'var(--t2v-bg)',
        }}>
          <ChatPanel {...props} />
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="t2v-btn" style={{
        position: 'fixed', bottom: 'clamp(16px, 3vw, 24px)', right: 'clamp(16px, 3vw, 24px)',
        width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--t2v-accent)', color: 'var(--t2v-accent-foreground)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 999999,
        transition: 'transform 0.2s', transform: open ? 'scale(0.9)' : 'scale(1)',
      }}>
        {open ? (
          <X size={20} />
        ) : (
          <img src={LOGOS.icon} alt="Talk2View" style={{ width: 28, height: 28 }} />
        )}
      </button>
    </>
  );
}
