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

export class T2VClient {
  private readonly baseUrl: string;
  private readonly partnerKey: string;
  private readonly requestTimeout: number;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: T2VConfig) {
    this.partnerKey = config.partnerKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.requestTimeout = config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
  }

  /**
   * Create an AbortController that auto-aborts after the configured timeout.
   */
  private makeTimeoutSignal(): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);
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
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
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
      clearAuth();
      throw new AuthenticationError('Session expired. Please log in again.');
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
  ): Promise<T> {
    const headers = this.buildHeaders(requiresAuth, {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    });
    const { signal, clear } = this.makeTimeoutSignal();
    try {
      const response = await this.fetchWithAuth(endpoint, options, headers, requiresAuth, signal);
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
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers = this.buildHeaders(true, { 'Content-Type': 'application/json' });
    const serializedBody = JSON.stringify(body);
    const { signal, clear } = this.makeTimeoutSignal();
    let response: Response;
    try {
      response = await this.fetchWithAuth(
        endpoint,
        { method: 'POST', body: serializedBody },
        headers,
        true,
        signal,
      );
    } finally {
      clear();
    }
    yield* decodeSSEStream(response);
  }

  private async tryRefreshToken(): Promise<boolean> {
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

  private async doRefreshToken(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-T2V-Partner-Key': this.partnerKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) return false;

      const data: RefreshResponse = await response.json();
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      return true;
    } catch {
      return false;
    }
  }
}
