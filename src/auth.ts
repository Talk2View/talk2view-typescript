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

  // Aborts the in-flight OAuth poll loop, if any. A new attempt cancels the
  // previous one so its loop can't linger as a "zombie" and reject a later
  // attempt with a stale "expired"/"window closed" error.
  private oauthAbort?: AbortController;

  /** Sign in with Google via a popup (engine-mediated OAuth). */
  async signInWithGoogle(): Promise<User> {
    return this.signInWithOAuth('google');
  }

  async signInWithOAuth(provider: string): Promise<User> {
    if (typeof window === 'undefined') {
      throw new T2VError('OAuth sign-in requires a browser environment');
    }
    // Cancel any still-running attempt before starting a new one.
    this.oauthAbort?.abort();
    const abort = new AbortController();
    this.oauthAbort = abort;

    const bytes = new Uint8Array(32); // 256-bit nonce
    window.crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const startUrl = this.client.oauthStartUrl(provider, {
      origin: window.location.origin,
      nonce,
    });
    // Unique window name per attempt. A fixed name makes a rapid re-click reuse
    // (navigate) the SAME popup, stranding the previous attempt's poll loop.
    const popup = window.open(startUrl, `t2v-oauth-${nonce.slice(0, 12)}`, 'width=480,height=720');
    if (!popup) {
      throw new T2VError('Popup blocked. Please allow popups and try again.');
    }
    try {
      const tokens = await this.pollOAuthExchange(nonce, abort.signal);
      this.storeTokens(tokens);
      const user = tokens.user;
      if (!user) throw new AuthenticationError('OAuth sign-in returned no user');
      this.notifyListeners(user);
      return user;
    } finally {
      if (!popup.closed) popup.close();
      if (this.oauthAbort === abort) this.oauthAbort = undefined;
    }
  }

  private async pollOAuthExchange(
    nonce: string,
    signal: AbortSignal,
  ): Promise<TokenResponse> {
    const deadlineMs = Date.now() + 180_000;
    let delay = 600;
    // Has the txn ever been observed server-side? Distinguishes a benign early
    // 410 ("/start hasn't created the row yet" — the first poll can beat the
    // popup's redirect) from a real one ("the row existed and then expired").
    //
    // We deliberately do NOT gate on `popup.closed`. The popup navigates through
    // pages that send Cross-Origin-Opener-Policy (the engine `/start` redirect,
    // Supabase, and Google), which severs the opener↔popup link and makes
    // `popup.closed` report `true` mid-flow — a false positive that would abort
    // a perfectly live sign-in. The flow is poll-based (the session comes from
    // the server, not the popup), so the handle isn't needed for correctness:
    // we poll until ready, the txn expires (→ 410 after it was seen), or the
    // 180s deadline (which matches the server-side txn TTL).
    let sawTxn = false;
    while (Date.now() < deadlineMs) {
      if (signal.aborted) throw new AuthenticationError('Sign-in was cancelled.');

      let ready: TokenResponse | null = null;
      let missing = false;
      try {
        const body = await this.client.request<TokenResponse | { status: string }>(
          '/v1/auth/oauth/exchange',
          { method: 'POST', body: JSON.stringify({ nonce }) },
          false,
        );
        if ((body as TokenResponse).access_token) {
          ready = body as TokenResponse;
        } else {
          sawTxn = true; // 202 pending → the txn exists; keep waiting for it
        }
      } catch (err) {
        if (err instanceof T2VError && err.statusCode === 410) {
          // 410 after we've seen the txn = genuinely expired/consumed → terminal.
          // 410 before that = the row isn't created yet (race) → keep polling.
          if (sawTxn) throw new AuthenticationError('Sign-in expired. Please try again.');
          missing = true;
        } else {
          throw err;
        }
      }
      if (ready) return ready;

      await this.sleep(missing ? 400 : delay, signal);
      if (!missing) delay = Math.min(delay * 1.5, 4000);
    }
    throw new AuthenticationError('Google sign-in timed out.');
  }

  /** Abortable delay used by the OAuth poll loop. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new AuthenticationError('Sign-in was cancelled.'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new AuthenticationError('Sign-in was cancelled.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
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
