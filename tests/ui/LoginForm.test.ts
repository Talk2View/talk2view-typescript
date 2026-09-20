import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { vi, expect, test, beforeEach } from 'vitest';
import { LoginForm } from '../../src/ui/components/LoginForm';

const login = vi.fn(() => Promise.resolve());
const signup = vi.fn(() => Promise.resolve());

vi.mock('../../src/react/useT2VAuth', () => ({
  useT2VAuth: () => ({
    login,
    signup,
    isLoading: false,
    error: null,
    clearError: () => {},
  }),
}));

vi.mock('../../src/ui/theme', () => ({
  LOGOS: { icon: 'icon.svg' },
}));

beforeEach(() => {
  login.mockClear();
  signup.mockClear();
});

function fillAndSubmit(container: HTMLElement) {
  const email = container.querySelector('#t2v-email') as HTMLInputElement;
  const password = container.querySelector('#t2v-password') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'a@b.com' } });
  fireEvent.change(password, { target: { value: 'secret' } });
  const form = container.querySelector('form') as HTMLFormElement;
  fireEvent.submit(form);
}

test('signup mode submits via signup()', () => {
  const { container } = render(React.createElement(LoginForm, { defaultMode: 'signup' }));
  fillAndSubmit(container);
  expect(signup).toHaveBeenCalledWith('a@b.com', 'secret');
  expect(login).not.toHaveBeenCalled();
});

test('login mode submits via login()', () => {
  const { container } = render(React.createElement(LoginForm, { defaultMode: 'login' }));
  fillAndSubmit(container);
  expect(login).toHaveBeenCalledWith('a@b.com', 'secret');
  expect(signup).not.toHaveBeenCalled();
});

test('default mode is login when defaultMode omitted', () => {
  const { container } = render(React.createElement(LoginForm, {}));
  fillAndSubmit(container);
  expect(login).toHaveBeenCalledWith('a@b.com', 'secret');
});
