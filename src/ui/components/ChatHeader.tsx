/**
 * ChatHeader — header bar for the chat panel.
 *
 * Shows the Talk2View logo + title, with a three-dot dropdown menu
 * containing Settings and Sign Out options. In settings view, shows
 * a back button instead.
 */

import React, { useState, useEffect } from 'react';
import { Settings, LogOut, LogIn, PenLine, ArrowLeft, MoreVertical } from 'lucide-react';
import { LOGOS } from '../theme';

export interface ChatHeaderProps {
  view: 'chat' | 'settings' | 'login';
  /** "Sign out" shows only for a real account (isAuthenticated && !isAnonymous);
   *  anonymous and no-session states show "Sign in" instead. */
  isAuthenticated: boolean;
  isAnonymous: boolean;
  onSettingsClick: () => void;
  onBackClick: () => void;
  onNewChat: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
}

export function ChatHeader({ view, isAuthenticated, isAnonymous, onSettingsClick, onBackClick, onNewChat, onSignOut, onSignIn }: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close dropdown on Escape key
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [menuOpen]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid var(--t2v-border)',
        flexShrink: 0,
      }}
    >
      {/* Left side: back button (in settings) or logo (in chat) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {view !== 'chat' ? (
          <>
            <HeaderButton onClick={onBackClick} aria-label="Back to chat">
              <BackIcon />
            </HeaderButton>
            {view === 'settings' && (
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  fontFamily: 'var(--t2v-font)',
                  color: 'var(--t2v-foreground)',
                }}
              >
                Settings
              </span>
            )}
          </>
        ) : (
          <>
            <img src={LOGOS.icon} alt="" style={{ width: 20, height: 20 }} />
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: 'var(--t2v-font)',
                color: 'var(--t2v-foreground)',
              }}
            >
              Talk2View
            </span>
          </>
        )}
      </div>

      {/* Right side: new chat + menu (only in chat view) */}
      {view === 'chat' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', position: 'relative' }}>
          <button
            onClick={onNewChat}
            aria-label="New chat"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: 'var(--t2v-radius-sm)',
              border: '1px solid var(--t2v-border)',
              backgroundColor: 'transparent',
              color: 'var(--t2v-foreground)',
              fontSize: '12px',
              fontFamily: 'var(--t2v-font)',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--t2v-border)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <NewChatIcon />
            Clear Chat
          </button>
          <HeaderButton onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            <EllipsisIcon />
          </HeaderButton>

          {/* Dropdown */}
          {menuOpen && (
            <>
              {/* Invisible backdrop to close menu on click-away */}
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              />
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  minWidth: '140px',
                  borderRadius: 'var(--t2v-radius-md)',
                  border: '1px solid var(--t2v-border)',
                  backgroundColor: 'var(--t2v-bg)',
                  boxShadow: '0 4px 16px rgba(1, 22, 30, 0.12)',
                  zIndex: 50,
                  overflow: 'hidden',
                  animation: 't2v-fade-in 0.15s ease-out',
                }}
              >
                <DropdownItem onClick={() => { setMenuOpen(false); onSettingsClick(); }}>
                  <SettingsIcon />
                  Settings
                </DropdownItem>
                {isAuthenticated && !isAnonymous ? (
                  <DropdownItem onClick={() => { setMenuOpen(false); onSignOut(); }} danger>
                    <SignOutIcon />
                    Sign out
                  </DropdownItem>
                ) : (
                  <DropdownItem onClick={() => { setMenuOpen(false); onSignIn(); }}>
                    <SignInIcon />
                    Sign in
                  </DropdownItem>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Small sub-components ─────────────────────────────────────── */

function HeaderButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      {...props}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        borderRadius: 'var(--t2v-radius-sm)',
        border: 'none',
        backgroundColor: hovered ? 'var(--t2v-border)' : 'transparent',
        color: 'var(--t2v-muted)',
        cursor: 'pointer',
        padding: 0,
        transition: 'background-color 0.15s ease',
      }}
    />
  );
}

function DropdownItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        backgroundColor: hovered
          ? danger ? 'rgba(220,38,38,0.06)' : 'var(--t2v-border)'
          : 'transparent',
        color: danger ? 'var(--t2v-error)' : 'var(--t2v-foreground)',
        fontSize: '13px',
        fontFamily: 'var(--t2v-font)',
        fontWeight: 500,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

/* ── Icons (Lucide React) ─────────────────────────────────────── */

function NewChatIcon() {
  return <PenLine size={14} />;
}

function BackIcon() {
  return <ArrowLeft size={16} />;
}

function EllipsisIcon() {
  return <MoreVertical size={16} />;
}

function SettingsIcon() {
  return <Settings size={14} />;
}

function SignOutIcon() {
  return <LogOut size={14} />;
}

function SignInIcon() {
  return <LogIn size={14} />;
}
