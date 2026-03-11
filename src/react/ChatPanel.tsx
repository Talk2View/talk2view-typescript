/**
 * ChatPanel — self-contained, embeddable chat panel with tool support.
 *
 * Drop-in chat UI that handles authentication, tool registration,
 * streaming, and the full interrupt/resume cycle.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientTool } from '../types';
import { ChatInput } from './ChatInput';

import { ApprovalCard } from './ApprovalCard';
import { ChatMessage } from './ChatMessage';
import { LoginModal } from './LoginModal';
import { SettingsView } from './SettingsView';
import { useT2V } from './T2VProvider';
import { useT2VAuth } from './useT2VAuth';
import { useT2VChat } from './useT2VChat';
import { useT2VTools } from './useT2VTools';
import { useUserPreferences } from './useUserPreferences';
import { T2V_ALPHA, T2V_COLORS, T2V_FONTS, T2V_SHADOWS, T2VLogo, injectT2VFonts, injectT2VStyles } from './theme';

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
  const { messages, isLoading, error, agentStatus, pendingApproval, sendMessage, approveToolCall, retryLastMessage, clearMessages, clearError } = useT2VChat({
    systemPrompt,
  });
  const { preferences } = useUserPreferences();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [compact, setCompact] = useState(false);
  const roRef = useRef<ResizeObserver | null>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'settings'>('chat');
  const [clearHover, setClearHover] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);

  const fontScale = FONT_SCALE_MAP[preferences.fontSize || 'medium'];

  // Callback ref: (re-)attaches ResizeObserver whenever the root element changes
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setCompact(w > 0 && w < 360);
      }
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

  // Disconnect ResizeObserver on unmount
  useEffect(() => () => { roRef.current?.disconnect(); }, []);

  // Restore saved model preference on mount
  useEffect(() => {
    if (preferences.model) {
      t2v.config.model = preferences.model;
    }
  }, [t2v, preferences.model]);

  const handleModelChange = useCallback((model: string) => {
    t2v.config.model = model;
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

  // Close tools popover on outside click
  useEffect(() => {
    if (!toolsOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [toolsOpen]);

  // Scroll tracking — detect if user scrolled up
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    autoScrollRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    autoScrollRef.current = true;
    setShowScrollBtn(false);
  }, []);

  // Smart auto-scroll — only if user hasn't scrolled up
  useEffect(() => {
    if (autoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, pendingApproval, isLoading]);

  // Escape key to close dropdowns
  useEffect(() => {
    if (!profileOpen && !toolsOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileOpen(false);
        setToolsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [profileOpen, toolsOpen]);

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
    boxShadow: T2V_SHADOWS.panel,
    overflow: 'hidden',
    fontFamily: T2V_FONTS.body,
    transform: fontScale === 1 ? undefined : `scale(${fontScale})`,
    transformOrigin: fontScale === 1 ? undefined : 'top left',
    ...style,
  };

  if (!isAuthenticated) {
    return (
      <div ref={panelRef} className={`t2v-chat-panel ${className}`} style={panelShell}>
        <LoginModal signupUrl={signupUrl} />
      </div>
    );
  }

  if (currentView === 'settings') {
    return (
      <div ref={panelRef} className={`t2v-chat-panel ${className}`} style={panelShell}>
        <SettingsView onBack={() => setCurrentView('chat')} onModelChange={handleModelChange} />
      </div>
    );
  }

  return (
    <div ref={panelRef} className={`t2v-chat-panel ${className}`} style={panelShell}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: compact ? '8px 12px' : '12px 16px',
          backgroundColor: T2V_COLORS.dark,
          color: T2V_COLORS.light,
        }}
      >
        <div style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
          <T2VLogo size={compact ? 18 : 22} variant="horizontalDark" />
        </div>
        <div style={{ display: 'flex', gap: compact ? '6px' : '10px', alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={clearMessages}
            onMouseEnter={() => setClearHover(true)}
            onMouseLeave={() => setClearHover(false)}
            aria-label="Clear chat"
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${clearHover ? T2V_COLORS.turquoise : T2V_ALPHA.light20}`,
              backgroundColor: clearHover ? T2V_ALPHA.turquoise10 : 'transparent',
              fontSize: compact ? '11px' : '12px',
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
                width: compact ? '26px' : '30px',
                height: compact ? '26px' : '30px',
                borderRadius: '50%',
                border: `1.5px solid ${profileOpen ? T2V_COLORS.turquoise : T2V_ALPHA.light30}`,
                backgroundColor: profileOpen ? T2V_ALPHA.turquoise15 : T2V_ALPHA.light10,
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
                  boxShadow: T2V_SHADOWS.dropdown,
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

      {/* Messages wrapper — relative container for scroll button overlay */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          style={{
            height: '100%',
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

          {messages
            .filter((msg) => msg.role === 'user' || msg.content || msg.isStreaming)
            .map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

          {pendingApproval && (
            <div style={{ padding: '0 0 8px' }}>
              <ApprovalCard
                approval={pendingApproval}
                onDecision={approveToolCall}
              />
            </div>
          )}

          {isLoading && !pendingApproval && messages[messages.length - 1]?.content === '' && (
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

        {/* Scroll-to-bottom button — positioned over the scroll container */}
        {showScrollBtn && (
          <button
            className="t2v-scroll-btn"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Error with retry */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            backgroundColor: T2V_COLORS.errorBg,
            color: T2V_COLORS.errorRed,
            fontSize: '13px',
            fontFamily: T2V_FONTS.heading,
            borderLeft: `3px solid ${T2V_COLORS.errorRed}`,
          }}
          role="alert"
        >
          <span style={{ fontWeight: 600 }}>Error</span>
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => { retryLastMessage().catch(console.error); }}
            style={{
              padding: '3px 10px',
              borderRadius: '4px',
              border: `1px solid ${T2V_COLORS.errorRed}`,
              backgroundColor: 'transparent',
              color: T2V_COLORS.errorRed,
              fontSize: '11px',
              fontFamily: T2V_FONTS.heading,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            aria-label="Retry last message"
          >
            Retry
          </button>
          <button
            onClick={clearError}
            style={{
              padding: '3px 8px',
              border: 'none',
              backgroundColor: 'transparent',
              color: T2V_COLORS.errorRed,
              fontSize: '16px',
              cursor: 'pointer',
              opacity: 0.6,
            }}
            aria-label="Dismiss error"
          >
            &times;
          </button>
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
              visibility: isLoading && !pendingApproval ? 'visible' : 'hidden',
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
            <div ref={toolsRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setToolsOpen((v) => !v)}
                style={{
                  fontSize: '11px',
                  fontFamily: T2V_FONTS.heading,
                  color: T2V_COLORS.turquoise,
                  backgroundColor: toolsOpen ? T2V_ALPHA.turquoise20 : T2V_ALPHA.turquoise12,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                {registeredTools.length} tools
              </button>
              {toolsOpen && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    right: 0,
                    marginBottom: '6px',
                    backgroundColor: T2V_COLORS.light,
                    borderRadius: '8px',
                    boxShadow: T2V_SHADOWS.dropdown,
                    border: `1px solid ${T2V_COLORS.lightGray}`,
                    minWidth: '220px',
                    maxWidth: '300px',
                    maxHeight: '240px',
                    overflowY: 'auto',
                    zIndex: 100,
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: '11px',
                      fontFamily: T2V_FONTS.heading,
                      fontWeight: 600,
                      color: T2V_COLORS.turquoise,
                      borderBottom: `1px solid ${T2V_COLORS.lightGray}`,
                    }}
                  >
                    Registered Tools
                  </div>
                  {tools.filter((t) => registeredTools.includes(t.name)).map((tool) => (
                    <div
                      key={tool.name}
                      style={{
                        padding: '8px 12px',
                        borderBottom: `1px solid ${T2V_COLORS.lightGray}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          fontFamily: T2V_FONTS.heading,
                          fontWeight: 600,
                          color: T2V_COLORS.dark,
                        }}
                      >
                        {tool.name}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontFamily: T2V_FONTS.body,
                          color: T2V_COLORS.midGray,
                          marginTop: '2px',
                          lineHeight: '1.4',
                        }}
                      >
                        {tool.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isLoading} compact={compact} />
    </div>
  );
}
