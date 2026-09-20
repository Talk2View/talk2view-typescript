import React from 'react';
import { useChat } from '../context.js';
import { LOGOS } from '../theme.js';

export interface WelcomeScreenProps {
  heading?: string;
  suggestions?: string[];
}

export function WelcomeScreen({ heading, suggestions }: WelcomeScreenProps) {
  const { sendMessage } = useChat();
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px', gap: '20px', textAlign: 'center',
    }}>
      <img src={LOGOS.icon} alt="" style={{ width: 40, height: 40, opacity: 0.7 }} />
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--t2v-foreground)', margin: 0, fontFamily: 'var(--t2v-font)' }}>
        {heading ?? 'How can I help you?'}
      </h2>
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '280px' }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { sendMessage(s).catch(() => {}); }} className="t2v-btn-ghost" style={{
              padding: '10px 14px', borderRadius: 'var(--t2v-radius-md)',
              border: '1px solid var(--t2v-border)', background: 'var(--t2v-bg)',
              cursor: 'pointer', fontFamily: 'var(--t2v-font)', fontSize: '13px',
              color: 'var(--t2v-foreground)', textAlign: 'left', lineHeight: 1.4,
              transition: 'border-color 0.15s',
            }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
