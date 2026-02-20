/**
 * ChatPanel — self-contained, embeddable chat panel with tool support.
 *
 * Drop-in chat UI that handles authentication, tool registration,
 * streaming, and the full interrupt/resume cycle.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientTool } from '../types';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';
import { LoginModal } from './LoginModal';
import { useT2V } from './T2VProvider';
import { useT2VAuth } from './useT2VAuth';
import { useT2VChat } from './useT2VChat';
import { useT2VTools } from './useT2VTools';
import { T2V_COLORS, T2V_FONTS, T2VLogo, injectT2VFonts, injectT2VStyles } from './theme';

export interface ChatPanelProps {
  tools?: ClientTool[];
  systemPrompt?: string;
  signupUrl?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ChatPanel({
  tools = [],
  systemPrompt,
  signupUrl,
  className = '',
  style,
}: ChatPanelProps) {
  const { isAuthenticated, logout } = useT2VAuth();
  const { registerTools, registeredTools, isRegistered } = useT2VTools();
  const { messages, isLoading, error, agentStatus, todos, sendMessage, clearMessages, clearError } = useT2VChat({
    systemPrompt,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [clearHover, setClearHover] = useState(false);
  const [logoutHover, setLogoutHover] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [todosExpanded, setTodosExpanded] = useState(true);

  // Thinking timer
  useEffect(() => {
    if (!isLoading) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Inject fonts and keyframes once
  useEffect(() => {
    injectT2VFonts();
    injectT2VStyles();
  }, []);

  // Register tools when authenticated
  useEffect(() => {
    if (isAuthenticated && tools.length > 0 && !isRegistered) {
      registerTools(tools).catch(console.error);
    }
  }, [isAuthenticated, tools, isRegistered, registerTools]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content).catch(console.error);
    },
    [sendMessage],
  );

  const panelShell: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: T2V_COLORS.light,
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(1, 22, 30, 0.10)',
    overflow: 'hidden',
    fontFamily: T2V_FONTS.body,
    ...style,
  };

  if (!isAuthenticated) {
    return (
      <div className={`t2v-chat-panel ${className}`} style={panelShell}>
        <LoginModal signupUrl={signupUrl} />
      </div>
    );
  }

  return (
    <div className={`t2v-chat-panel ${className}`} style={panelShell}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: T2V_COLORS.dark,
          color: T2V_COLORS.light,
        }}
      >
        <T2VLogo size={22} variant="horizontalDark" />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={clearMessages}
            onMouseEnter={() => setClearHover(true)}
            onMouseLeave={() => setClearHover(false)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${clearHover ? T2V_COLORS.turquoise : 'rgba(248, 250, 252, 0.2)'}`,
              backgroundColor: clearHover ? 'rgba(64, 212, 182, 0.1)' : 'transparent',
              fontSize: '12px',
              fontFamily: T2V_FONTS.heading,
              cursor: 'pointer',
              color: T2V_COLORS.light,
              transition: 'all 0.15s ease',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => { logout().catch(console.error); }}
            onMouseEnter={() => setLogoutHover(true)}
            onMouseLeave={() => setLogoutHover(false)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${logoutHover ? T2V_COLORS.errorRed : 'rgba(248, 250, 252, 0.2)'}`,
              backgroundColor: logoutHover ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              fontSize: '12px',
              fontFamily: T2V_FONTS.heading,
              cursor: 'pointer',
              color: T2V_COLORS.light,
              transition: 'all 0.15s ease',
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '12px',
            }}
          >
            <T2VLogo size={40} />
            <span
              style={{
                color: T2V_COLORS.midGray,
                fontSize: '15px',
                fontFamily: T2V_FONTS.heading,
                fontWeight: 500,
              }}
            >
              How can I help you?
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '10px 14px',
              color: T2V_COLORS.midGray,
              fontSize: '13px',
              fontFamily: T2V_FONTS.heading,
            }}
          >
            <span>{agentStatus?.message ?? 'Thinking'}</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  backgroundColor: T2V_COLORS.turquoise,
                  animation: `t2v-dot-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Todos panel */}
      {todos && (
        <div
          style={{
            borderTop: `1px solid ${T2V_COLORS.lightGray}`,
            backgroundColor: 'rgba(64, 212, 182, 0.06)',
          }}
        >
          <div
            onClick={() => setTodosExpanded((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontFamily: T2V_FONTS.heading,
                fontWeight: 600,
                color: T2V_COLORS.turquoise,
              }}
            >
              Agent Plan
            </span>
            <span
              style={{
                fontSize: '11px',
                color: T2V_COLORS.midGray,
                transform: todosExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              &#9660;
            </span>
          </div>
          {todosExpanded && (
            <div style={{ padding: '0 16px 10px' }}>
              {todos.split('\n').map((line, i) => {
                const unchecked = line.match(/^-\s*\[\s*\]\s*(.*)/);
                const checked = line.match(/^-\s*\[x\]\s*(.*)/i);
                if (checked) {
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '3px 0',
                        fontSize: '13px',
                        fontFamily: T2V_FONTS.body,
                        color: T2V_COLORS.midGray,
                        textDecoration: 'line-through',
                      }}
                    >
                      <span style={{ color: T2V_COLORS.turquoise, flexShrink: 0 }}>&#10003;</span>
                      <span>{checked[1]}</span>
                    </div>
                  );
                }
                if (unchecked) {
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '3px 0',
                        fontSize: '13px',
                        fontFamily: T2V_FONTS.body,
                        color: T2V_COLORS.dark,
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: '14px',
                          height: '14px',
                          borderRadius: '3px',
                          border: `1.5px solid ${T2V_COLORS.turquoise}`,
                          flexShrink: 0,
                          marginTop: '2px',
                        }}
                      />
                      <span>{unchecked[1]}</span>
                    </div>
                  );
                }
                if (line.trim()) {
                  return (
                    <div
                      key={i}
                      style={{
                        fontSize: '13px',
                        fontFamily: T2V_FONTS.body,
                        color: T2V_COLORS.dark,
                        padding: '2px 0',
                      }}
                    >
                      {line}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          onClick={clearError}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            backgroundColor: T2V_COLORS.errorBg,
            color: T2V_COLORS.errorRed,
            fontSize: '13px',
            fontFamily: T2V_FONTS.heading,
            cursor: 'pointer',
            borderLeft: `3px solid ${T2V_COLORS.errorRed}`,
          }}
        >
          <span style={{ fontWeight: 600 }}>Error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Status bar: timer (left) + tools (right) */}
      {(isLoading || registeredTools.length > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 16px',
            borderTop: `1px solid ${T2V_COLORS.lightGray}`,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontFamily: T2V_FONTS.heading,
              color: T2V_COLORS.midGray,
              visibility: isLoading ? 'visible' : 'hidden',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: T2V_COLORS.turquoise,
                animation: 't2v-blink 1.2s ease-in-out infinite',
              }}
            />
            {agentStatus?.message ?? 'Thinking'} for {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
          </span>
          {registeredTools.length > 0 && (
            <span
              style={{
                fontSize: '11px',
                fontFamily: T2V_FONTS.heading,
                color: T2V_COLORS.turquoise,
                backgroundColor: 'rgba(64, 212, 182, 0.12)',
                padding: '2px 8px',
                borderRadius: '10px',
              }}
            >
              {registeredTools.length} tools
            </span>
          )}
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
