/**
 * HTTP/SSE API client with two-tier auth (partner key + user JWT).
 */

import { AuthenticationError, NetworkError, T2VError } from './errors';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './storage';
import { decodeSSEStream } from './streaming';
import type {
  ChatCompletionChunk,
  RefreshResponse,
  T2VConfig,
} from './types';

const DEFAULT_BASE_URL = 'https://engine.talk2view.com';
const DEFAULT_REQUEST_TIMEOUT = 30_000;

// "refreshed": new tokens stored. "invalid": the refresh token was genuinely
// rejected (revoked / expired) — log out. "transient": the refresh failed for a
// reason that does NOT mean the session is dead (the token was already rotated,
// a rate limit, or a network blip) — surface a retryable error, keep the session.
// A "transient" result is raised as a NetworkError; callers should retry it,
// ideally with a short backoff so a 429 isn't made worse.
type RefreshResult = 'refreshed' | 'invalid' | 'transient';

export class T2VClient {
  private readonly baseUrl: string;
  private readonly partnerKey: string;
  private readonly requestTimeout: number;
  private isRefreshing = false;
  private refreshPromise: Promise<RefreshResult> | null = null;

  constructor(config: T2VConfig) {
    this.partnerKey = config.partnerKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.requestTimeout = config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
  }

  /**
   * Create an AbortController that auto-aborts after the configured timeout.
   */
  private makeTimeoutSignal(timeout?: number): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? this.requestTimeout);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  /**
   * Execute a fetch with network-error wrapping, 401 refresh/retry, and error parsing.
   */
  private async fetchWithAuth(
    endpoint: string,
    init: RequestInit,
    headers: Record<string, string>,
    requiresAuth: boolean,
    signal?: AbortSignal,
  ): Promise<Response> {
    const fetchInit = signal ? { ...init, headers, signal } : { ...init, headers };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, fetchInit);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${this.requestTimeout}ms`);
      }
      throw new NetworkError(
        `Request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    if (response.status === 401 && requiresAuth) {
      const result = await this.tryRefreshToken();
      if (result === 'refreshed') {
        headers['Authorization'] = `Bearer ${getAccessToken()}`;
        const retryInit = signal ? { ...init, headers, signal } : { ...init, headers };
        let retryResponse: Response;
        try {
          retryResponse = await fetch(`${this.baseUrl}${endpoint}`, retryInit);
        } catch (retryErr) {
          if (retryErr instanceof DOMException && retryErr.name === 'AbortError') {
            throw new NetworkError(`Request timed out after ${this.requestTimeout}ms`);
          }
          throw new NetworkError(
            `Request failed: ${retryErr instanceof Error ? retryErr.message : 'Unknown error'}`,
          );
        }
        if (!retryResponse.ok) {
          const retryBody = await retryResponse.json().catch(() => ({}));
          const retryErr = retryBody?.detail?.error ?? retryBody?.error ?? {};
          throw new T2VError(retryErr.message ?? 'Request failed', retryErr.type, retryResponse.status, retryErr.code);
        }
        return retryResponse;
      }
      if (result === 'invalid') {
        // The refresh token is genuinely dead — this is a real logout.
        clearAuth();
        throw new AuthenticationError('Session expired. Please log in again.');
      }
      // transient: the session is still valid, we just couldn't refresh right
      // now. Surface a retryable error WITHOUT clearing auth.
      throw new NetworkError('Token refresh temporarily unavailable; please retry.');
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      // Server may wrap in { detail: { error: { ... } } } or { error: { ... } }
      const err = body?.detail?.error ?? body?.error ?? {};
      throw new T2VError(err.message ?? 'Request failed', err.type, response.status, err.code);
    }

    return response;
  }

  private buildHeaders(
    requiresAuth: boolean,
    extra?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'X-T2V-Partner-Key': this.partnerKey,
      ...extra,
    };
    if (requiresAuth) {
      const token = getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  /**
   * Make an authenticated JSON request.
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth = true,
    timeout?: number,
  ): Promise<T> {
    const headers = this.buildHeaders(requiresAuth, {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    });
    const { signal, clear } = this.makeTimeoutSignal(timeout);
    try {
      const response = await this.fetchWithAuth(endpoint, options, headers, requiresAuth, signal);
      // 204 No Content (e.g. logout, delete-session) has an empty body — don't parse it.
      if (response.status === 204) return undefined as T;
      return response.json();
    } finally {
      clear();
    }
  }

  /**
   * Make an authenticated multipart upload request (e.g. audio files).
   * Does NOT set Content-Type — the browser sets it with the correct boundary.
   */
  async uploadRequest<T>(
    endpoint: string,
    formData: FormData,
    requiresAuth = true,
  ): Promise<T> {
    const headers = this.buildHeaders(requiresAuth);
    const { signal, clear } = this.makeTimeoutSignal();
    try {
      const response = await this.fetchWithAuth(
        endpoint,
        { method: 'POST', body: formData },
        headers,
        requiresAuth,
        signal,
      );
      return response.json();
    } finally {
      clear();
    }
  }

  /**
   * Make an authenticated SSE streaming request.
   *
   * The request timeout applies only to the initial POST (connection establishment).
   * Once the SSE stream begins, no timeout is enforced — streams are long-lived by design.
   * Mid-stream re-authentication is not supported; however, in practice access tokens
   * outlive individual streams. The initial POST benefits from 401 refresh+retry.
   */
  async *streamRequest(
    endpoint: string,
    body: object,
    externalSignal?: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers = this.buildHeaders(true, { 'Content-Type': 'application/json' });
    const serializedBody = JSON.stringify(body);

    // One controller drives the fetch. It aborts on connection timeout OR when
    // the caller's external signal fires (user pressed "stop"). The timeout is
    // cleared once the response arrives, leaving the external signal to abort the
    // long-lived SSE body.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onExternalAbort);
    }

    let response: Response;
    try {
      response = await this.fetchWithAuth(
        endpoint,
        { method: 'POST', body: serializedBody },
        headers,
        true,
        controller.signal,
      );
    } catch (err) {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      throw err;
    }
    clearTimeout(timer);

    try {
      yield* decodeSSEStream(response);
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async tryRefreshToken(): Promise<RefreshResult> {
    if (this.isRefreshing) {
      return this.refreshPromise!;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<RefreshResult> {
    // Always read the freshest token — it may have been rotated elsewhere.
    const refreshToken = getRefreshToken();
    if (!refreshToken) return 'invalid';

    // Bound the refresh fetch with the same timeout as every other request.
    // Without this it is the only un-aborted fetch in the client: a hung
    // /v1/auth/refresh would never settle the shared refreshPromise, so every
    // concurrent 401 retry de-duped onto it would hang indefinitely.
    const { signal, clear } = this.makeTimeoutSignal();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-T2V-Partner-Key': this.partnerKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal,
      });
    } catch {
      // A timeout aborts as a DOMException; like any other network blip this is
      // transient — fail fast without logging the user out, and let the shared
      // refreshPromise settle so callers can retry.
      return 'transient';
    } finally {
      clear();
    }

    if (response.ok) {
      const data: RefreshResponse = await response.json();
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return 'refreshed';
    }
    // 401 = the refresh token was genuinely rejected -> real logout.
    // 409 (already rotated) and 429 (rate limited) are recoverable -> keep the
    // session and let the caller retry with the latest token.
    if (response.status === 401) return 'invalid';
    return 'transient';
  }
}
