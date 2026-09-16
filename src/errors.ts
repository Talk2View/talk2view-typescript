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
  constructor(
    message: string,
    public readonly type: string = 'sdk_error',
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'T2VError';
  }
}

export class AuthenticationError extends T2VError {
  constructor(message: string, type = 'authentication_error', statusCode = 401, code?: string, detail?: string) {
    super(message, type, statusCode, code, detail);
    this.name = 'AuthenticationError';
  }
}

export class PartnerKeyError extends T2VError {
  constructor(message: string, type = 'partner_key_error', statusCode = 401, code?: string, detail?: string) {
    super(message, type, statusCode, code, detail);
    this.name = 'PartnerKeyError';
  }
}

export class SessionError extends T2VError {
  constructor(message: string, type = 'session_error', statusCode?: number, code?: string, detail?: string) {
    super(message, type, statusCode, code, detail);
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
): T2VError {
  const Cls = type ? ERROR_CLASS_BY_TYPE[type] : undefined;
  return Cls
    ? new Cls(message, type, statusCode, code, detail)
    : new T2VError(message, type, statusCode, code, detail);
}
