/**
 * Base error class for Talk2View SDK errors.
 */
export class T2VError extends Error {
  constructor(
    message: string,
    public readonly type: string = 'sdk_error',
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'T2VError';
  }
}

export class AuthenticationError extends T2VError {
  constructor(message: string) {
    super(message, 'authentication_error', 401);
    this.name = 'AuthenticationError';
  }
}

export class PartnerKeyError extends T2VError {
  constructor(message: string) {
    super(message, 'partner_key_error', 401);
    this.name = 'PartnerKeyError';
  }
}

export class SessionError extends T2VError {
  constructor(message: string) {
    super(message, 'session_error');
    this.name = 'SessionError';
  }
}

export class NetworkError extends T2VError {
  constructor(message: string) {
    super(message, 'network_error');
    this.name = 'NetworkError';
  }
}
