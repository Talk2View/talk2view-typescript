/**
 * T2VChatHeader — Shared header bar for T2VThread and T2VAssistantModal.
 *
 * Shows the Talk2View logo + title, with a three-dot dropdown menu
 * containing Settings and Sign Out options. In settings view, shows
 * a back button instead.
 */

import React, { useState } from 'react';
import { T2V_COLORS, T2V_FONTS, T2VLogo } from '../../react/theme';

export interface T2VChatHeaderProps {
  view: 'chat' | 'settings';
  onSettingsClick: () => void;
  onBackClick: () => void;
  onNewChat: () => void;
  onSignOut: () => void;
}

export function T2VChatHeader({ view, onSettingsClick, onBackClick, onNewChat, onSignOut }: T2VChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: `1px solid ${T2V_COLORS.lightGray}`,
        flexShrink: 0,
      }}
    >
      {/* Left side: back button (in settings) or logo (in chat) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {view === 'settings' ? (
          <>
            <HeaderButton onClick={onBackClick} aria-label="Back to chat">
              <BackIcon />
            </HeaderButton>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: T2V_FONTS.heading,
                color: T2V_COLORS.dark,
              }}
            >
              Settings
            </span>
          </>
        ) : (
          <>
            <T2VLogo size={20} />
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: T2V_FONTS.heading,
                color: T2V_COLORS.dark,
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
              borderRadius: '6px',
              border: `1px solid ${T2V_COLORS.lightGray}`,
              backgroundColor: 'transparent',
              color: T2V_COLORS.dark,
              fontSize: '12px',
              fontFamily: T2V_FONTS.heading,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = T2V_COLORS.lightGray; }}
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
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  minWidth: '140px',
                  borderRadius: '8px',
                  border: `1px solid ${T2V_COLORS.lightGray}`,
                  backgroundColor: '#fff',
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
                <DropdownItem onClick={() => { setMenuOpen(false); onSignOut(); }} danger>
                  <SignOutIcon />
                  Sign out
                </DropdownItem>
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
        borderRadius: '6px',
        border: 'none',
        backgroundColor: hovered ? T2V_COLORS.lightGray : 'transparent',
        color: T2V_COLORS.midGray,
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
        backgroundColor: hovered ? (danger ? T2V_COLORS.errorBg : T2V_COLORS.light) : 'transparent',
        color: danger ? T2V_COLORS.errorRed : T2V_COLORS.dark,
        fontSize: '13px',
        fontFamily: T2V_FONTS.heading,
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

/* ── Inline SVG Icons ─────────────────────────────────────────── */

function NewChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

