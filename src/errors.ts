/**
 * Base error class for Talk2View SDK errors.
 *
 * `message` is always the user-safe summary (the server's structured
 * `error.message` plus the HTTP status). The server's raw `detail` (stack
 * traces, DB errors, file paths, library versions) is kept on the separate
 * `detail` property for debugging and is NEVER folded into `message`, so it
 * cannot leak to end users by default.
 */
export class T2VError extends Error {
  /**
   * The engine's id for the failed request, also sent as `X-Request-Id`.
   * Quote it when you contact support. Absent for errors raised in the SDK.
   */
  public readonly requestId?: string;
  /**
   * Seconds to wait before trying again, from the response's `Retry-After`
   * header. Set on rate limits and on some temporary outages.
   */
  public readonly retryAfter?: number;

  constructor(
    message: string,
    public readonly type: string = 'sdk_error',
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly detail?: string,
    details: T2VErrorDetails = {},
  ) {
    super(message);
    this.name = 'T2VError';
    this.requestId = details.requestId;
    this.retryAfter = details.retryAfter;
  }
}

/** What the engine said about a failed request beyond its error body. */
export interface T2VErrorDetails {
  requestId?: string;
  retryAfter?: number;
}

export class AuthenticationError extends T2VError {
  constructor(message: string, type = 'authentication_error', statusCode = 401, code?: string, detail?: string, details?: T2VErrorDetails) {
    super(message, type, statusCode, code, detail, details);
    this.name = 'AuthenticationError';
  }
}

export class PartnerKeyError extends T2VError {
  constructor(message: string, type = 'partner_key_error', statusCode = 401, code?: string, detail?: string, details?: T2VErrorDetails) {
    super(message, type, statusCode, code, detail, details);
    this.name = 'PartnerKeyError';
  }
}

export class SessionError extends T2VError {
  constructor(message: string, type = 'session_error', statusCode?: number, code?: string, detail?: string, details?: T2VErrorDetails) {
    super(message, type, statusCode, code, detail, details);
    this.name = 'SessionError';
  }
}

export class NetworkError extends T2VError {
  constructor(message: string) {
    super(message, 'network_error');
    this.name = 'NetworkError';
  }
}

/**
 * What the end-user reads when their sign-in has died under them: the refresh
 * token was revoked or has expired. One string, so the chat says the same thing
 * whether the request that found out reports it or the identity change that
 * emptied the conversation does (see the auth handler in `index.ts`).
 */
export const SESSION_EXPIRED_MESSAGE = 'Session expired. Please log in again.';

/**
 * The engine's error type for each class we publish. A failed request is thrown
 * as the matching subclass so `err instanceof AuthenticationError` works, which
 * is what the README has always promised; everything else stays a T2VError.
 */
const ERROR_CLASS_BY_TYPE: Record<string, new (
  message: string,
  type?: string,
  statusCode?: number,
  code?: string,
  detail?: string,
  details?: T2VErrorDetails,
) => T2VError> = {
  authentication_error: AuthenticationError,
  partner_key_error: PartnerKeyError,
  // The engine's dedicated SessionNotFoundError type. It is declared but not
  // raised yet: a dead chat session currently 404s with the generic
  // `not_found`, which we deliberately do NOT map, because the same type
  // covers a missing skill, attachment or partner. See `isSessionGone` in
  // index.ts — recovery keys on the type, not on this class.
  session_not_found: SessionError,
};

/** Build the most specific error class for an engine error type. */
export function errorForType(
  message: string,
  type: string | undefined,
  statusCode?: number,
  code?: string,
  detail?: string,
  details?: T2VErrorDetails,
): T2VError {
  const Cls = type ? ERROR_CLASS_BY_TYPE[type] : undefined;
  return Cls
    ? new Cls(message, type, statusCode, code, detail, details)
    : new T2VError(message, type, statusCode, code, detail, details);
}

/**
 * Seconds from a `Retry-After` header, which is either a number of seconds or
 * an HTTP date. Undefined when it is absent or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}
