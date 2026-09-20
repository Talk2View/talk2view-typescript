import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHeader } from '../../src/ui/components/ChatHeader';

function openMenu(overrides: Record<string, unknown> = {}) {
  const props = {
    view: 'chat' as const,
    isAuthenticated: false,
    isAnonymous: false,
    onSettingsClick: vi.fn(),
    onBackClick: vi.fn(),
    onNewChat: vi.fn(),
    onSignOut: vi.fn(),
    onSignIn: vi.fn(),
    ...overrides,
  };
  render(React.createElement(ChatHeader, props));
  fireEvent.click(screen.getByLabelText('Menu')); // open the dropdown
  return props;
}

describe('ChatHeader auth menu item', () => {
  it('shows "Sign in" (not "Sign out") for an anonymous session, and calls onSignIn', () => {
    const props = openMenu({ isAuthenticated: true, isAnonymous: true });

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /sign in/i }));
    expect(props.onSignIn).toHaveBeenCalledTimes(1);
    expect(props.onSignOut).not.toHaveBeenCalled();
  });

  it('shows "Sign in" before any session exists (no real account yet)', () => {
    openMenu({ isAuthenticated: false, isAnonymous: false });

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /sign in/i })).toBeTruthy();
  });

  it('shows "Sign out" only for a real authenticated account, and calls onSignOut', () => {
    const props = openMenu({ isAuthenticated: true, isAnonymous: false });

    expect(screen.queryByRole('menuitem', { name: /sign in/i })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    expect(props.onSignIn).not.toHaveBeenCalled();
  });
});
