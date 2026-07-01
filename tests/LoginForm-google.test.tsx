import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginForm } from '../src/ui/components/LoginForm';

const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/react/useT2VAuth', () => ({
  useT2VAuth: () => ({
    login: vi.fn(), signup: vi.fn(), isLoading: false, error: null,
    clearError: vi.fn(), signInWithGoogle, oauthLoading: false,
  }),
}));

describe('LoginForm Google', () => {
  it('renders a Google button that calls signInWithGoogle', () => {
    render(<LoginForm />);
    const btn = screen.getByRole('button', { name: /continue with google/i });
    fireEvent.click(btn);
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('shows a consent line', () => {
    render(<LoginForm />);
    expect(screen.getByText(/terms/i)).toBeTruthy();
  });
});
