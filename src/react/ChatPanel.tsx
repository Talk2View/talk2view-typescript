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
import { SettingsView } from './SettingsView';
import { useT2V } from './T2VProvider';
import { useT2VAuth } from './useT2VAuth';
import { useT2VChat } from './useT2VChat';
import { useT2VTools } from './useT2VTools';
import { useUserPreferences } from './useUserPreferences';
import { T2V_COLORS, T2V_FONTS, T2VLogo, injectT2VFonts, injectT2VStyles } from './theme';

const FONT_SCALE_MAP = { small: 0.9, medium: 1.0, large: 1.1 } as const;

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
  const { t2v } = useT2V();
  const { isAuthenticated, user, logout } = useT2VAuth();
  const { registerTools, registeredTools, isRegistered } = useT2VTools();
  const { messages, isLoading, error, agentStatus, todos, sendMessage, clearMessages, clearError } = useT2VChat({
    systemPrompt,
  });
  const { preferences } = useUserPreferences();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'settings'>('chat');
  const [clearHover, setClearHover] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [todosExpanded, setTodosExpanded] = useState(true);
  const profileRef = useRef<HTMLDivElement>(null);

  const fontScale = FONT_SCALE_MAP[preferences.fontSize || 'medium'];

  const handleModelChange = useCallback(() => {
    t2v.clearSession();
  }, [t2v]);

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

  // Close profile menu on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profileOpen]);

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
    height: fontScale === 1 ? '100%' : `${100 / fontScale}%`,
    width: fontScale === 1 ? '100%' : `${100 / fontScale}%`,
    backgroundColor: T2V_COLORS.light,
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(1, 22, 30, 0.10)',
    overflow: 'hidden',
    fontFamily: T2V_FONTS.body,
    transform: fontScale === 1 ? undefined : `scale(${fontScale})`,
    transformOrigin: fontScale === 1 ? undefined : 'top left',
    ...style,
  };

  if (!isAuthenticated) {
    return (
      <div className={`t2v-chat-panel ${className}`} style={panelShell}>
        <LoginModal signupUrl={signupUrl} />
      </div>
    );
  }

  if (currentView === 'settings') {
    return (
      <div className={`t2v-chat-panel ${className}`} style={panelShell}>
        <SettingsView onBack={() => setCurrentView('chat')} onModelChange={handleModelChange} />
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
          {/* Profile icon with dropdown */}
          <div ref={profileRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileOpen((v) => !v)}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: `1.5px solid ${profileOpen ? T2V_COLORS.turquoise : 'rgba(248, 250, 252, 0.3)'}`,
                backgroundColor: profileOpen ? 'rgba(64, 212, 182, 0.15)' : 'rgba(248, 250, 252, 0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                transition: 'all 0.15s ease',
              }}
              title={user?.email ?? 'Profile'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T2V_COLORS.light} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
            {profileOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  backgroundColor: T2V_COLORS.light,
                  borderRadius: '8px',
                  boxShadow: '0 4px 16px rgba(1, 22, 30, 0.15)',
                  minWidth: '180px',
                  zIndex: 100,
                  overflow: 'hidden',
                  border: `1px solid ${T2V_COLORS.lightGray}`,
                }}
              >
                {/* User email */}
                {user?.email && (
                  <div
                    style={{
                      padding: '10px 14px',
                      fontSize: '12px',
                      fontFamily: T2V_FONTS.body,
                      color: T2V_COLORS.midGray,
                      borderBottom: `1px solid ${T2V_COLORS.lightGray}`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {user.email}
                  </div>
                )}
                {/* Settings */}
                <button
                  onClick={() => { setProfileOpen(false); setCurrentView('settings'); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontFamily: T2V_FONTS.heading,
                    color: T2V_COLORS.dark,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = T2V_COLORS.lightGray; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T2V_COLORS.midGray} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </button>
                {/* Sign out */}
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    logout().catch(console.error);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '10px 14px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontFamily: T2V_FONTS.heading,
                    color: T2V_COLORS.errorRed,
                    textAlign: 'left',
                    borderTop: `1px solid ${T2V_COLORS.lightGray}`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = T2V_COLORS.errorBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T2V_COLORS.errorRed} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
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
