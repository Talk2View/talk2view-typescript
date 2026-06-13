/**
 * Auth module — login, signup, refresh, logout, auth state management.
 */

import type { T2VClient } from './client';
import { AuthenticationError, T2VError } from './errors';
import {
  ACCESS_TOKEN_STORAGE_KEY,
  clearAuth,
  getAccessToken,
  getIsAnonymous,
  getUser,
  hasValidTokens,
  setAccessToken,
  setIsAnonymous,
  setUserApiKey,
  setRefreshToken,
  setUser,
} from './storage';
import type { LoginRequest, SignupRequest, TokenResponse, User } from './types';

type AuthStateCallback = (user: User | null) => void;

export class T2VAuth {
  private listeners: Set<AuthStateCallback> = new Set();

  // Bound handlers kept so they can be removed in destroy() — never leak listeners.
  private readonly onAuthCleared = (): void => {
    this.notifyListeners(null);
  };

  /**
   * Cross-tab logout sync. The native `storage` event fires in *other* tabs
   * when localStorage changes in one tab. When a sibling tab logs out (or a
   * dead-refresh-token 401 clears auth), the access-token key is removed/nulled;
   * we observe that here and flip this tab to logged-out too.
   */
  private readonly onStorage = (event: StorageEvent): void => {
    // Only react to our access-token key being cleared (removed → newValue null).
    if (event.key === ACCESS_TOKEN_STORAGE_KEY && event.newValue === null) {
      this.notifyListeners(null);
    }
  };

  constructor(private readonly client: T2VClient) {
    // Same-tab + cross-tab auth-cleared sync. Guarded for SSR/Node where
    // `window`/`localStorage` are absent.
    if (typeof window !== 'undefined') {
      // Same-tab custom event (e.g., from 401 handling via clearAuth()).
      window.addEventListener('talk2view_auth_cleared', this.onAuthCleared);
      // Cross-tab native storage event (a logout in a sibling tab).
      window.addEventListener('storage', this.onStorage);
    }
  }

  /**
   * Remove the window event listeners registered in the constructor.
   * Call when disposing of this auth instance to avoid leaking listeners.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('talk2view_auth_cleared', this.onAuthCleared);
      window.removeEventListener('storage', this.onStorage);
    }
  }

  /** Start an anonymous demo session (no account). */
  async startAnonymous(opts?: { captchaToken?: string }): Promise<User> {
    const body = opts?.captchaToken ? { captcha_token: opts.captchaToken } : {};
    const response = await this.client.request<TokenResponse>(
      '/v1/auth/anonymous',
      { method: 'POST', body: JSON.stringify(body) },
      false,
    );
    this.storeTokens(response);
    setIsAnonymous(true);
    const user = response.user;
    if (!user) throw new AuthenticationError('Anonymous sign-in returned no user');
    this.notifyListeners(user);
    return user;
  }

  /** True if the current session is an anonymous demo session. */
  isAnonymous(): boolean {
    return getIsAnonymous();
  }

  /**
   * Create a new Talk2View account.
   */
  async signup(email: string, password: string): Promise<User> {
    if (getIsAnonymous()) {
      try {
        await this.client.request<User>(
          '/v1/auth/convert',
          { method: 'POST', body: JSON.stringify({ email, password }) },
          true,
        );
      } catch (err) {
        // 409 = the email already belongs to another account; fall through
        // and log into it. Anything else is a real failure.
        if (!(err instanceof T2VError && err.statusCode === 409)) {
          throw err;
        }
      }
      // Convert links the credentials but revokes the anonymous session's
      // refresh token server-side (Supabase rotates tokens on credential
      // change), so the tokens we still hold are stale — the next refresh
      // would 401. Re-authenticate to land a fresh session (same user_id on
      // a successful convert → chat history preserved).
      return await this.login(email, password);
    }

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
    // Only hit the server when we actually hold a token to revoke. Without one
    // the endpoint just 401s (it requires a valid JWT), so skip the call and
    // clear local state directly.
    if (getAccessToken()) {
      try {
        await this.client.request<void>('/v1/auth/logout', { method: 'POST' });
      } catch {
        // Server-side logout is best-effort; we always clear locally below.
      }
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
    if (response.user_api_key) {
      setUserApiKey(response.user_api_key);
    }
    setIsAnonymous(response.is_anonymous === true);
  }

  private notifyListeners(user: User | null): void {
    for (const listener of this.listeners) {
      listener(user);
    }
  }
}
