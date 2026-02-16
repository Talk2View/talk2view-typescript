/**
 * Auth module — login, signup, refresh, logout, auth state management.
 */

import type { T2VClient } from './client';
import { AuthenticationError } from './errors';
import {
  clearAuth,
  getAccessToken,
  getUser,
  hasValidTokens,
  setAccessToken,
  setLiteLLMApiKey,
  setRefreshToken,
  setUser,
} from './storage';
import type { LoginRequest, SignupRequest, TokenResponse, User } from './types';

type AuthStateCallback = (user: User | null) => void;

export class T2VAuth {
  private listeners: Set<AuthStateCallback> = new Set();

  constructor(private readonly client: T2VClient) {
    // Listen for auth cleared events (e.g., from 401 handling)
    if (typeof window !== 'undefined') {
      window.addEventListener('talk2view_auth_cleared', () => {
        this.notifyListeners(null);
      });
    }
  }

  /**
   * Create a new Talk2View account.
   */
  async signup(email: string, password: string): Promise<User> {
    const request: SignupRequest = { email, password };
    const response = await this.client.request<TokenResponse>(
      '/v1/auth/signup',
      { method: 'POST', body: JSON.stringify(request) },
      false,
    );

    this.storeTokens(response);

    const user = response.user;
    if (!user) throw new AuthenticationError('Signup succeeded but no user returned');

    this.notifyListeners(user);
    return user;
  }

  /**
   * Authenticate with email and password.
   */
  async login(email: string, password: string): Promise<User> {
    const request: LoginRequest = { email, password };
    const response = await this.client.request<TokenResponse>(
      '/v1/auth/login',
      { method: 'POST', body: JSON.stringify(request) },
      false,
    );

    this.storeTokens(response);

    const user = response.user;
    if (!user) throw new AuthenticationError('Login succeeded but no user returned');

    this.notifyListeners(user);
    return user;
  }

  /**
   * Sign out the current user.
   */
  async logout(): Promise<void> {
    try {
      await this.client.request<void>('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Logout failures are non-critical
    }
    clearAuth();
    this.notifyListeners(null);
  }

  /**
   * Get the current user (from storage).
   */
  getUser(): User | null {
    const raw = getUser();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  /**
   * Check if a user is currently authenticated.
   */
  isAuthenticated(): boolean {
    return hasValidTokens();
  }

  /**
   * Subscribe to auth state changes.
   */
  onAuthStateChange(callback: AuthStateCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private storeTokens(response: TokenResponse): void {
    setAccessToken(response.access_token);
    setRefreshToken(response.refresh_token);
    if (response.user) {
      setUser(response.user);
    }
    if (response.litellm_api_key) {
      setLiteLLMApiKey(response.litellm_api_key);
    }
  }

  private notifyListeners(user: User | null): void {
    for (const listener of this.listeners) {
      listener(user);
    }
  }
}
