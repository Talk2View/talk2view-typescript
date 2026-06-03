/**
 * MessageBubble — renders a single chat message.
 *
 * User messages: right-aligned light-gray bubble, plain text.
 * Assistant messages: left-aligned with Talk2View logo avatar, rendered as
 * plain text (no card) — ThinkingBlock (if plan exists), ToolDisplay (if
 * steps exist), ApprovalCard (if pendingApproval and isStreaming), and a
 * MarkdownRenderer whose content is smoothly revealed while streaming.
 */

import React from 'react';
import type { DisplayMessage } from '../../types';
import { useChat } from '../context';
import { LOGOS } from '../theme';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolStepGroup } from './ToolDisplay';
import { ApprovalCard } from './ApprovalCard';
import { MessageActions } from './MessageActions';
import { Shimmer } from './Shimmer';
import { useSmoothText } from '../useSmoothText';

export interface MessageBubbleProps {
  message: DisplayMessage;
  isLast?: boolean;
  /** Hide the assistant avatar (used to visually group consecutive assistant turns). */
  hideAvatar?: boolean;
}

export function MessageBubble({ message, isLast, hideAvatar }: MessageBubbleProps) {
  const { pendingApproval, approveToolCall } = useChat();
  const isUser = message.role === 'user';
  // Smoothly reveal assistant text while streaming; full text otherwise.
  const displayContent = useSmoothText(message.content, !!message.isStreaming && !isUser);

  if (isUser) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '12px',
          animation: 't2v-fade-in 0.2s ease-out',
        }}
      >
        <div
          style={{
            maxWidth: '80%',
            padding: '8px 14px',
            borderRadius: 'var(--t2v-radius-xl)',
            borderBottomRightRadius: 'var(--t2v-radius-sm)',
            background: 'var(--t2v-user-bubble)',
            color: 'var(--t2v-user-foreground)',
            fontSize: '14px',
            lineHeight: 1.5,
            fontFamily: 'var(--t2v-font)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  const showApproval =
    message.isStreaming &&
    pendingApproval !== null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        marginBottom: '12px',
        animation: 't2v-fade-in 0.2s ease-out',
      }}
    >
      {/* Avatar — replaced by a same-width spacer when grouped so content stays aligned */}
      {hideAvatar ? (
        <div style={{ width: '24px', flexShrink: 0 }} aria-hidden="true" />
      ) : (
        <img
          src={LOGOS.icon}
          alt="Talk2View"
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            flexShrink: 0,
            marginTop: '2px',
            objectFit: 'contain',
            background: 'var(--t2v-bg)',
            border: '1px solid var(--t2v-border)',
          }}
        />
      )}

      {/* Content — plain text on the thread background (assistant-ui style) */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '14px',
          lineHeight: 1.7,
          color: 'var(--t2v-foreground)',
          fontFamily: 'var(--t2v-font)',
        }}
      >
        {/* Thinking / plan block */}
        {message.plan && <ThinkingBlock content={message.plan} />}

        {/* Tool call steps */}
        {message.steps && message.steps.length > 0 && (
          <div style={{ marginBottom: message.content ? '8px' : '0' }}>
            <ToolStepGroup steps={message.steps} isStreaming={message.isStreaming} />
          </div>
        )}

        {/* HITL approval card */}
        {showApproval && pendingApproval && (
          <ApprovalCard
            toolName={pendingApproval.toolName}
            toolCallId={pendingApproval.toolCallId}
            args={pendingApproval.arguments}
            description={pendingApproval.description}
            onDecision={approveToolCall}
          />
        )}

        {/* Shimmer — shown when streaming with no content yet */}
        {message.isStreaming && !message.content && !message.plan && !pendingApproval && (
          <Shimmer />
        )}

        {/* Message content — smoothly revealed while streaming */}
        {displayContent && <MarkdownRenderer content={displayContent} />}

        {/* Message actions — show when not streaming */}
        {!message.isStreaming && message.content && (
          <MessageActions content={message.content} isLast={isLast ?? false} />
        )}
      </div>
    </div>
  );
}
