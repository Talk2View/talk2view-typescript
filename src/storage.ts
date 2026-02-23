/**
 * Token storage with localStorage + in-memory fallback for private browsing.
 */

const PREFIX = 'talk2view_';

const memoryStorage: Record<string, string> = {};

function isLocalStorageAvailable(): boolean {
  try {
    const key = '__t2v_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const useLocalStorage = typeof window !== 'undefined' && isLocalStorageAvailable();

function get(key: string): string | null {
  if (useLocalStorage) {
    return localStorage.getItem(PREFIX + key);
  }
  return memoryStorage[PREFIX + key] ?? null;
}

function set(key: string, value: string): void {
  if (useLocalStorage) {
    localStorage.setItem(PREFIX + key, value);
  } else {
    memoryStorage[PREFIX + key] = value;
  }
}

function remove(key: string): void {
  if (useLocalStorage) {
    localStorage.removeItem(PREFIX + key);
  } else {
    delete memoryStorage[PREFIX + key];
  }
}

// ── Public API ──

export function getAccessToken(): string | null {
  return get('access_token');
}

export function setAccessToken(token: string): void {
  set('access_token', token);
}

export function getRefreshToken(): string | null {
  return get('refresh_token');
}

export function setRefreshToken(token: string): void {
  set('refresh_token', token);
}

export function getUser(): string | null {
  return get('user');
}

export function setUser(user: object): void {
  set('user', JSON.stringify(user));
}

export function getUserApiKey(): string | null {
  return get('user_api_key');
}

export function setUserApiKey(key: string): void {
  set('user_api_key', key);
}

export function clearAuth(): void {
  remove('access_token');
  remove('refresh_token');
  remove('user');
  remove('user_api_key');

  // Dispatch event for cross-component sync
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('talk2view_auth_cleared'));
  }
}

export function getUserPreferences(): string | null {
  return get('preferences');
}

export function setUserPreferences(json: string): void {
  set('preferences', json);
}

export function hasValidTokens(): boolean {
  return getAccessToken() !== null;
}
