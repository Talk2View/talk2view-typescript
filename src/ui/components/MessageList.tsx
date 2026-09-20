/**
 * MessageList — scrollable list of chat messages.
 *
 * - Auto-scrolls to bottom when messages change (only if already near bottom).
 * - Shows a scroll-to-bottom button when scrolled up more than 150px.
 * - Shows a Shimmer typing indicator when isLoading and last message has no content.
 * - Renders a MessageBubble for each message.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useChat } from '../context.js';
import { MessageBubble } from './MessageBubble.js';
import { Shimmer } from './Shimmer.js';
import { LOGOS } from '../theme.js';

export interface MessageListProps {
  /**
   * Visually merge consecutive assistant messages into one turn by hiding the
   * avatar on every assistant message that immediately follows another.
   */
  groupAssistantMessages?: boolean;
}

export function MessageList({ groupAssistantMessages }: MessageListProps = {}) {
  const { messages, isLoading } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Auto-scroll when messages change (only if already near bottom)
  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom('smooth');
    }
  }, [messages, isNearBottom, scrollToBottom]);

  // Track scroll position to show/hide scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 150);
  }, []);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        className="t2v-scrollable"
        onScroll={handleScroll}
        style={{
          height: '100%',
          overflowY: 'auto',
          padding: '16px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={i === messages.length - 1}
              hideAvatar={
                groupAssistantMessages === true &&
                msg.role === 'assistant' &&
                messages[i - 1]?.role === 'assistant'
              }
            />
          ))}

          {/* Shimmer is rendered inside MessageBubble, not here */}

          {/* Spacer so content isn't hidden behind scroll button */}
          <div style={{ height: showScrollBtn ? '40px' : '0' }} />
        </div>
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom('smooth')}
          aria-label="Scroll to bottom"
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 12px',
            background: 'var(--t2v-bg)',
            border: '1px solid var(--t2v-border)',
            borderRadius: 'var(--t2v-radius-pill)',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'var(--t2v-font)',
            color: 'var(--t2v-muted)',
            boxShadow: 'var(--t2v-shadow)',
            zIndex: 1,
          }}
        >
          <ArrowDown size={14} />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
