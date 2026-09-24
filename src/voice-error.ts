/** A voice call that could not start. `type` is the machine-readable reason (see `VoiceError`). */
export class VoiceStartError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VoiceStartError';
  }
}
