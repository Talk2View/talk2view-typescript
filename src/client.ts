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
   * Make an authenticated JSON request.
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-T2V-Partner-Key': this.partnerKey,
      ...(options.headers as Record<string, string> | undefined),
    };

    if (requiresAuth) {
      const token = getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, { ...options, headers });
    } catch (err) {
      throw new NetworkError(
        `Network request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // Handle 401 — try to refresh token
    if (response.status === 401 && requiresAuth) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${getAccessToken()}`;
        const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, { ...options, headers });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ error: { message: 'Request failed' } }));
          throw new T2VError(error?.error?.message ?? 'Request failed', error?.error?.type, retryResponse.status);
        }
        return retryResponse.json();
      } else {
        clearAuth();
        throw new AuthenticationError('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
      throw new T2VError(error?.error?.message ?? 'Request failed', error?.error?.type, response.status);
    }

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
    const headers: Record<string, string> = {
      'X-T2V-Partner-Key': this.partnerKey,
    };

    if (requiresAuth) {
      const token = getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData,
      });
    } catch (err) {
      throw new NetworkError(
        `Network request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // Handle 401 — try to refresh token
    if (response.status === 401 && requiresAuth) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${getAccessToken()}`;
        const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers,
          body: formData,
        });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ error: { message: 'Upload failed' } }));
          throw new T2VError(error?.error?.message ?? 'Upload failed', error?.error?.type, retryResponse.status);
        }
        return retryResponse.json();
      } else {
        clearAuth();
        throw new AuthenticationError('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
      throw new T2VError(error?.error?.message ?? 'Upload failed', error?.error?.type, response.status);
    }

    return response.json();
  }

  /**
   * Make an authenticated SSE streaming request.
   */
  async *streamRequest(
    endpoint: string,
    body: object,
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-T2V-Partner-Key': this.partnerKey,
    };

    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new NetworkError(
        `Stream request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    if (!response.ok) {
      if (response.status === 401) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          // Retry with new token
          headers['Authorization'] = `Bearer ${getAccessToken()}`;
          const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          if (!retryResponse.ok) {
            throw new T2VError('Stream request failed after token refresh');
          }
          yield* decodeSSEStream(retryResponse);
          return;
        }
        clearAuth();
        throw new AuthenticationError('Session expired. Please log in again.');
      }

      const error = await response.json().catch(() => ({ error: { message: 'Stream request failed' } }));
      throw new T2VError(error?.error?.message ?? 'Stream request failed', error?.error?.type, response.status);
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
