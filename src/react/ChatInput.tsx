/**
 * ChatInput — text input with send button.
 */

import React, { useCallback, useState } from 'react';
import { T2V_COLORS, T2V_FONTS } from './theme';

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
  const [value, setValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  const canSend = value.trim().length > 0 && !disabled;

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
        placeholder={placeholder}
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
              : T2V_COLORS.honeyBronze
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
