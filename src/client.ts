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

export class T2VClient {
  private readonly baseUrl: string;
  private readonly partnerKey: string;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: T2VConfig) {
    this.partnerKey = config.partnerKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Execute a fetch with network-error wrapping, 401 refresh/retry, and error parsing.
   */
  private async fetchWithAuth(
    endpoint: string,
    init: RequestInit,
    headers: Record<string, string>,
    requiresAuth: boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
    } catch (err) {
      throw new NetworkError(
        `Request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    if (response.status === 401 && requiresAuth) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${getAccessToken()}`;
        const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, { ...init, headers });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ error: { message: 'Request failed' } }));
          throw new T2VError(error?.error?.message ?? 'Request failed', error?.error?.type, retryResponse.status);
        }
        return retryResponse;
      }
      clearAuth();
      throw new AuthenticationError('Session expired. Please log in again.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
      throw new T2VError(error?.error?.message ?? 'Request failed', error?.error?.type, response.status);
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
    const response = await this.fetchWithAuth(endpoint, options, headers, requiresAuth);
    return response.json();
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
    const response = await this.fetchWithAuth(
      endpoint,
      { method: 'POST', body: formData },
      headers,
      requiresAuth,
    );
    return response.json();
  }

  /**
   * Make an authenticated SSE streaming request.
   */
  async *streamRequest(
    endpoint: string,
    body: object,
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers = this.buildHeaders(true, { 'Content-Type': 'application/json' });
    const serializedBody = JSON.stringify(body);
    const response = await this.fetchWithAuth(
      endpoint,
      { method: 'POST', body: serializedBody },
      headers,
      true,
    );
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
