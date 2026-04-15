/**
 * MessageBubble — renders a single chat message.
 *
 * User messages: right-aligned dark bubble, plain text.
 * Assistant messages: left-aligned with Talk2View logo avatar, renders
 * ThinkingBlock (if plan exists), ToolDisplay (if steps exist),
 * ApprovalCard (if pendingApproval and isStreaming), MarkdownRenderer
 * (for content), and a blinking streaming cursor.
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

export interface MessageBubbleProps {
  message: DisplayMessage;
  isLast?: boolean;
}

export function MessageBubble({ message, isLast }: MessageBubbleProps) {
  const { pendingApproval, approveToolCall } = useChat();
  const isUser = message.role === 'user';

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
            maxWidth: '75%',
            padding: '10px 14px',
            borderRadius: 'calc(var(--t2v-radius) * 1px)',
            borderBottomRightRadius: '4px',
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
      {/* Avatar */}
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

      {/* Content */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '14px',
          lineHeight: 1.55,
          color: 'var(--t2v-foreground)',
          fontFamily: 'var(--t2v-font)',
          background: 'var(--t2v-surface)',
          borderRadius: '8px',
          padding: '10px 12px',
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

        {/* Message content */}
        {message.content && <MarkdownRenderer content={message.content} />}

        {/* Streaming cursor — hide during thinking (ThinkingBlock has its own shimmer) and during approval */}
        {message.isStreaming && message.content && !pendingApproval && !message.plan && (
          <span
            style={{
              display: 'inline-block',
              width: '2px',
              height: '1em',
              background: 'var(--t2v-accent)',
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
              animation: 't2v-blink 1s step-start infinite',
            }}
          />
        )}

        {/* Message actions — show when not streaming */}
        {!message.isStreaming && message.content && (
          <MessageActions content={message.content} isLast={isLast ?? false} />
        )}
      </div>
    </div>
  );
}
