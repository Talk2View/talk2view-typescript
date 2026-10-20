/**
 * This package's version, sent to the engine as `X-T2V-Client` so it can tell
 * which SDK release a request came from. A test keeps it equal to
 * package.json's, so a version bump updates both.
 */
export const SDK_VERSION = '0.22.0';

/** The `X-T2V-Client` header value. */
export const CLIENT_HEADER = `talk2view-typescript/${SDK_VERSION}`;
