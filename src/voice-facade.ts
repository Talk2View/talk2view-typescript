/**
 * `t2v.voice` — a thin facade over the voice controller.
 *
 * Core imports only this file. The controller (`voice.ts`) is loaded with
 * `import()` on the first `start()`, and it loads the Pipecat libraries, so a
 * chat-only partner ships neither. Listeners can be added before the load:
 * the facade owns the event emitter and forwards the controller's events.
 */

import { TypedEventEmitter } from './event-emitter.js';
import type { VoiceEventMap, VoiceState } from './types.js';
import type { T2VVoiceController, T2VVoiceDeps } from './voice.js';
import { VoiceStartError } from './voice-error.js';

/** @internal Loads the voice controller class. Exported for typing; not part of the supported surface. */
export type VoiceControllerLoader = () => Promise<new (deps: T2VVoiceDeps) => T2VVoiceController>;

/** @internal What `Talk2View` builds `t2v.voice` from. Exported for typing; construct {@link Talk2View} instead. */
export interface T2VVoiceOptions extends T2VVoiceDeps {
  /** Loads the controller class. Default: `import('./voice.js')`. Tests hand in their own. */
  loadController?: VoiceControllerLoader;
}

const loadVoiceController: VoiceControllerLoader = async () => (await import('./voice.js')).T2VVoiceController;

/** Every event the controller emits; the facade forwards each one. */
const FORWARDED = ['transcript', 'toolCall', 'agentState', 'approvalChange', 'error', 'ended'] as const;

export class T2VVoice {
  private readonly emitter = new TypedEventEmitter<VoiceEventMap>();
  private _state: VoiceState = 'idle';
  private controller: T2VVoiceController | null = null;
  private loading: Promise<T2VVoiceController> | null = null;
  /** Bumped by stop(): a start() still waiting on the load must not go on. */
  private epoch = 0;
  /** True while start() waits for the controller to load. */
  private awaitingLoad = false;

  constructor(private readonly options: T2VVoiceOptions) {}

  /** `idle` until the first call; then the controller's state. */
  get state(): VoiceState {
    return this._state;
  }

  on<K extends keyof VoiceEventMap & string>(
    event: K,
    callback: (...args: VoiceEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, callback);
  }

  off<K extends keyof VoiceEventMap & string>(event: K, callback: (...args: VoiceEventMap[K]) => void): void {
    this.emitter.off(event, callback);
  }

  /** Press the button. Loads the voice controller on first use, then starts the call. */
  async start(): Promise<void> {
    if (this.controller && !this.awaitingLoad) return this.controller.start();
    if (this.awaitingLoad) return;
    const epoch = ++this.epoch;
    this.awaitingLoad = true;
    this.setState('connecting');
    let controller: T2VVoiceController;
    try {
      controller = await this.load();
    } catch (err) {
      // Before the epoch check: a load that fails after a stop() must not stay
      // cached, or the next start() would fail without retrying the import.
      this.loading = null; // a failed chunk load can be retried
      if (epoch !== this.epoch) return;
      this.awaitingLoad = false;
      const message = 'Could not load voice. Check your connection and try again.';
      this.safeEmit('error', { type: 'voice_error', message });
      this.setState('error');
      throw new VoiceStartError('voice_error', message, { cause: err });
    }
    // Hung up while the controller was loading: stop() already reported it.
    if (epoch !== this.epoch) return;
    this.awaitingLoad = false;
    return controller.start();
  }

  /** Hang up. Safe to call in any state, including while voice is still loading. */
  async stop(): Promise<void> {
    this.epoch += 1;
    if (this.awaitingLoad) {
      this.awaitingLoad = false;
      this.setState('ended');
      this.safeEmit('ended', 'stopped');
      return;
    }
    await this.controller?.stop();
  }

  /**
   * @internal The signed-in session died (not a deliberate sign-out). Ends any
   * call, starting or live, as `auth_expired` with an `auth_expired` error.
   * `Talk2View` calls this; partners call {@link stop}.
   */
  async expire(): Promise<void> {
    this.epoch += 1;
    if (this.awaitingLoad) {
      this.awaitingLoad = false;
      this.safeEmit('error', { type: 'auth_expired', message: 'Your sign-in expired. Sign in again to keep talking.' });
      this.setState('ended');
      this.safeEmit('ended', 'auth_expired');
      return;
    }
    await this.controller?.expire();
  }

  private setState(state: VoiceState): void {
    if (this._state === state) return;
    this._state = state;
    this.safeEmit('stateChange', state);
  }

  /**
   * Emit without letting a throwing partner listener reject `start()` or
   * `stop()`. Logged by event name only, never the payload.
   */
  private safeEmit<K extends keyof VoiceEventMap & string>(event: K, ...args: VoiceEventMap[K]): void {
    try {
      this.emitter.emit(event, ...args);
    } catch {
      console.error(`[Talk2View] a voice "${event}" listener threw`);
    }
  }

  private load(): Promise<T2VVoiceController> {
    this.loading ??= (this.options.loadController ?? loadVoiceController)().then((Controller) => {
      const { loadController: _unused, ...deps } = this.options;
      const controller = new Controller(deps);
      controller.on('stateChange', (state) => this.setState(state));
      for (const event of FORWARDED) {
        controller.on(event, (...args: unknown[]) =>
          (this.safeEmit as (e: string, ...a: unknown[]) => void).call(this, event, ...args),
        );
      }
      this.controller = controller;
      return controller;
    });
    return this.loading;
  }
}
