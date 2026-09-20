import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginForm } from '../src/ui/components/LoginForm';

const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
const signInWithApple = vi.fn().mockResolvedValue(undefined);
// Mutable so individual tests can simulate different getPopupProviders() results.
let oauthProviders: Array<'google' | 'apple'> | null = ['apple', 'google'];
vi.mock('../src/react/useT2VAuth', () => ({
  useT2VAuth: () => ({
    login: vi.fn(), signup: vi.fn(), isLoading: false, error: null,
    clearError: vi.fn(), signInWithGoogle, signInWithApple, oauthLoading: false, oauthProvider: null,
    oauthProviders,
  }),
}));

describe('LoginForm Google', () => {
  beforeEach(() => {
    oauthProviders = ['apple', 'google'];
  });

  it('renders a Google button that calls signInWithGoogle', () => {
    render(<LoginForm />);
    const btn = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(btn);
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('renders an Apple button, above Google, that calls signInWithApple', () => {
    render(<LoginForm />);
    const apple = screen.getByRole('button', { name: /continue with apple/i });
    const google = screen.getByRole('button', { name: /continue with google/i });
    // Apple's guidelines: no less prominent than any other sign-in option.
    expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const googleCallsBefore = signInWithGoogle.mock.calls.length;
    fireEvent.click(apple);
    expect(signInWithApple).toHaveBeenCalledOnce();
    expect(signInWithGoogle.mock.calls.length).toBe(googleCallsBefore);
  });

  it('shows a consent line', () => {
    render(<LoginForm />);
    expect(screen.getByText(/terms/i)).toBeTruthy();
  });

  it('shows neither button, and no "or" divider, when the website is not registered', () => {
    oauthProviders = [];
    render(<LoginForm />);
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
    expect(screen.queryByText(/^or$/i)).toBeNull();
  });

  it('shows only Google against an older engine', () => {
    oauthProviders = ['google'];
    render(<LoginForm />);
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy();
  });

  it('reserves no buttons while it is still finding out', () => {
    oauthProviders = null;
    render(<LoginForm />);
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });
});
