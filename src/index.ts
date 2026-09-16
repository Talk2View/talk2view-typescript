/**
 * Talk2View SDK — Add AI-powered natural language control to any application.
 *
 * @example
 * ```typescript
 * import { Talk2View } from '@talk2view/sdk';
 *
 * const t2v = new Talk2View({ partnerKey: 'pk_live_abc123' });
 *
 * // No login needed — chat() auto-starts an anonymous demo session.
 * // After the demo limit, listen for the prompt to sign up:
 * t2v.on('demoLimitReached', () => showSignupPrompt());
 * // Convert the demo into a real account (history is preserved). The
 * // anonymous session stays live until the emailed confirmation link is
 * // clicked — check `confirmationRequired` to prompt the user to check email:
 * const { confirmationRequired } = await t2v.auth.signup('user@example.com', 'password');
 *
 * t2v.tools.handle('create_shape', async (args) => {
 *   return JSON.stringify(await myApp.createShape(args));
 * });
 *
 * await t2v.tools.register([{
 *   name: 'create_shape',
 *   description: 'Create a 3D shape',
 *   parameters: { type: 'object', properties: { ... }, required: [...] },
 * }]);
 *
 * for await (const event of t2v.chat('Make a red cylinder')) {
 *   if (event.type === 'text') console.log(event.content);
 * }
 * ```
 */

import { T2VAuth } from './auth.js';
import { T2VClient } from './client.js';
import { ATTACHMENT_TYPES_LABEL, isAllowedAttachmentType } from './constants.js';
import { T2VError } from './errors.js';
import { TypedEventEmitter } from './event-emitter.js';
import { getIsAnonymous, hasValidTokens } from './storage.js';
import { T2VSession, buildUserContent } from './sessions.js';
import { T2VSkills } from './skills.js';
import { T2VTools, stripNullArgs } from './tools.js';
import type { AgentStatus, Attachment, AudioModelsResponse, ChatEvent, ChatMessage, DisplayMessage, HumanDecision, PartnerConfig, PendingApproval, Model, ModelsResponse, T2VConfig, T2VEventMap, TranscriptionResponse } from './types.js';

/**
 * Refusals from POST /v1/auth/anonymous that only signing in — or Talk2View
 * finishing setup for the partner — can get past: the partner offers no
 * anonymous access, today's daily anonymous cap is used up, the partner
 * requires a Turnstile token this client didn't send, or Turnstile isn't
 * configured yet for a partner that requires it. `anonymous_unavailable` (the
 * claim RPC failing) is deliberately NOT here: it's a transient 503, and
 * sticking on it would flip the sign-in form on for the rest of the session
 * over a momentary blip. It falls through to the `console.warn` retry path.
 */
const ANONYMOUS_UNAVAILABLE_TYPES = new Set([
  'anonymous_access_disabled',
  'anonymous_daily_cap_reached',
  'captcha_required',
  'captcha_invalid',
  'captcha_unavailable',
]);

/**
 * The engine's "Session not found": chat sessions live in its memory, so a
 * deploy, a restart or an eviction loses them (ADR 0005 — sessions are
 * disposable and the client's chat history is authoritative). `not_found` is
 * the engine's generic catch-all error type on both `/messages` and `/resume`
 * today — the only 404 type either endpoint raises for a dead session.
 * `session_not_found` is also accepted: it's the engine's dedicated
 * `SessionNotFoundError` type, not raised there yet, but matching it too
 * means a future rename to the specific type doesn't silently stop recovery.
 */
function isSessionGone(err: unknown): boolean {
  return (
    err instanceof T2VError &&
    err.statusCode === 404 &&
    (err.type === 'not_found' || err.type === 'session_not_found')
  );
}

/**
 * Shown when the engine lost the chat session mid-turn: nothing is resent,
 * because the tool handler has already run on this side.
 */
const SESSION_LOST_MESSAGE =
  'The chat session ended before that step could be confirmed, so the assistant never got the result. It may already have been applied — check before sending your message again.';

/** Shown when the end-user denied the call, so nothing ran and there's nothing to check. */
const SESSION_LOST_AFTER_DENY_MESSAGE =
  'The chat session ended before that step could be confirmed, so the assistant never got your answer. Send your message again.';

type SessionClearCallback = () => void;
type SessionCreateCallback = (toolNames: string[]) => void;

/** Short, debug-log-safe preview of message content (string or parts). */
function previewContent(content: ChatMessage['content']): string {
  if (typeof content !== 'string') return '[multimodal content]';
  return content.slice(0, 80) + (content.length > 80 ? '...' : '');
}

export class Talk2View {
  readonly auth: T2VAuth;
  readonly tools: T2VTools;
  readonly skills: T2VSkills;
  private readonly client: T2VClient;
  readonly config: T2VConfig;
  private currentSession: T2VSession | null = null;
  /** The signed-in user id the current session belongs to, to detect identity changes. */
  private _authUserId: string | null = null;
  private sessionClearListeners: Set<SessionClearCallback> = new Set();
  private sessionCreateListeners: Set<SessionCreateCallback> = new Set();

  // ── getConfig single-flight + cache ─────────────────────────────────────
  // Partner config is auth-scoped (not session-scoped) and stable for the life
  // of a login. Many components mount usePartnerConfig and each calls
  // getConfig(), so without coalescing we fire N concurrent GET /v1/config on
  // startup. Share one in-flight request and cache its result; invalidate when
  // auth state changes (login/logout/user switch).
  private _configCache: PartnerConfig | null = null;
  private _configInFlight: Promise<PartnerConfig> | null = null;

  // ── State management ────────────────────────────────────────────────────
  private _messages: DisplayMessage[] = [];          // UI display (segmented)
  private _conversationHistory: ChatMessage[] = [];  // LLM history (clean user/assistant alternation)
  private _isLoading = false;
  private _error: string | null = null;
  private _pendingApproval: PendingApproval | null = null;
  private _agentStatus: AgentStatus | null = null;
  private _threadId: string | null = null;
  private _alwaysAllowedTools = new Set<string>();
  private _lastUserMessage: string | null = null;
  private _lastUserAttachments: Attachment[] | null = null;
  private _messageCounter = 0;
  /** Aborts the in-flight response stream when the user stops generation. */
  private _streamAbort: AbortController | null = null;
  /** True between stop() and stream teardown, so the abort isn't surfaced as an error. */
  private _stopped = false;
  private readonly emitter = new TypedEventEmitter<T2VEventMap>();

  private debug(...args: unknown[]): void {
    if (this.config.debug) console.log('[T2V]', ...args);
  }

  constructor(config: T2VConfig) {
    if (config.voiceApiUrl) {
      console.warn(
        '[Talk2View] voiceApiUrl is deprecated and has no effect. ' +
        'Voice requests now route through baseUrl. ' +
        'Remove voiceApiUrl from your T2VConfig.',
      );
    }
    this.config = config;
    this.client = new T2VClient(config);
    this.auth = new T2VAuth(this.client);
    this.tools = new T2VTools(this.client);
    this.skills = new T2VSkills(this.client);

    // Seed the tracked identity from any session already restored at construction
    // time, so an initial auth event that merely re-announces the same user does
    // not spuriously reset a healthy session (dropping its thread mid-task).
    this._authUserId = this.auth.getUser?.()?.id ?? null;

    // Auth state changes (login, logout, anonymous start, user switch) drop the
    // auth-scoped config cache so a stale partner config never leaks across users.
    // They also reset the chat session when the *identity* changes: the server
    // owns a session by user_id, so reusing an anonymous session after signing
    // into a different account would 404 ("Session not found") and lose the task.
    // Token refreshes don't fire this (only genuine identity events do), and a
    // convert keeps the same id — so the create-account flow is left untouched.
    this.auth.onAuthStateChange((user) => {
      this.invalidateConfigCache();
      const userId = user?.id ?? null;
      if (userId !== this._authUserId) {
        this._authUserId = userId;
        this.resetSessionForIdentityChange();
      }
    });
  }

  /**
   * Create a new chat session.
   */
  async createSession(): Promise<T2VSession> {
    const response = await this.client.request<{
      session_id: string;
      thread_id: string;
      model: string;
    }>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ model: this.config.model }),
    });

    const session = new T2VSession(response, this.client, this.tools, this.config);
    this.currentSession = session;

    // Re-register tools on the new session (tools are session-scoped on the server).
    // Failure is non-fatal — the session is still usable; the provider-level effect
    // will retry registration on the next render cycle.
    try {
      const result = await this.tools.reRegister();
      if (result) {
        for (const listener of this.sessionCreateListeners) {
          listener(result.registered);
        }
      }
    } catch (err) {
      console.warn('[Talk2View] Failed to re-register tools on new session:', err);
    }

    return session;
  }

  /** Whether `session` is still the live session — false if clearSession() or an identity change replaced it since. */
  private isCurrentSession(session: T2VSession): boolean {
    return this.currentSession?.id === session.id;
  }

  /**
   * Start an anonymous session when nothing is signed in and auto-start is on.
   * Returns false when the server refused anonymous sign-in for a reason only
   * signing in can fix: `anonymousUnavailable` is emitted, and the caller must
   * not send anything.
   */
  private async autoStartAnonymous(): Promise<boolean> {
    if (hasValidTokens() || this.config.anonymousAutoStart === false) return true;
    try {
      await this.auth.startAnonymous();
    } catch (err) {
      if (err instanceof T2VError && ANONYMOUS_UNAVAILABLE_TYPES.has(err.type)) {
        this.emitter.emit('anonymousUnavailable', err.type);
        return false;
      }
      console.warn('[Talk2View] Anonymous auto-start failed:', err);
    }
    return true;
  }

  /**
   * Send a message with automatic session management and tool handling.
   *
   * Creates a session if one doesn't exist. Tool calls are handled
   * automatically if handlers are registered via `t2v.tools.handle()`.
   */
  async *chat(
    message: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      history?: ChatMessage[];
      signal?: AbortSignal;
      attachments?: Attachment[];
    },
  ): AsyncGenerator<ChatEvent> {
    // Auto-start an anonymous session if nothing is authenticated yet.
    if (!(await this.autoStartAnonymous())) return;

    if (!this.currentSession) {
      await this.createSession();
    }

    yield* this.sendWithSessionRecovery(this.currentSession!, message, options);
  }

  /**
   * Send a turn, and recover once if the engine has lost the chat session.
   *
   * A deploy or an eviction leaves the id dead, and every later turn on it
   * fails. A new session rebuilds the conversation from the history this turn
   * replays, so resending is safe — but only before any event has been yielded:
   * once the reply has started, a failure mid-stream may have had side effects.
   */
  private async *sendWithSessionRecovery(
    session: T2VSession,
    message: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      history?: ChatMessage[];
      signal?: AbortSignal;
      attachments?: Attachment[];
    },
  ): AsyncGenerator<ChatEvent> {
    let started = false;
    try {
      for await (const event of session.sendMessage(message, options)) {
        started = true;
        yield event;
      }
      return;
    } catch (err) {
      if (!isSessionGone(err)) throw err;
      if (started) {
        // The reply (or a tool resume within it) had already begun, so a
        // handler on the client side may already have run — resending the
        // turn risks running it twice. Report the loss instead.
        this.currentSession = null;
        yield { type: 'error', message: SESSION_LOST_MESSAGE, errorType: 'session_lost' };
        return;
      }
      // The end-user pressed stop between the 404 and here — don't recover
      // into a turn nobody wants anymore.
      if (options?.signal?.aborted) throw err;
      this.debug('chat session gone; creating a new one and resending the turn');
    }

    this.currentSession = null;
    const newSession = await this.createSession();
    // createSession() awaits tool re-registration before returning, and
    // during that window clearSession() or an identity change may have run —
    // possibly after already being clobbered back to a session object by
    // createSession()'s own assignment. Only resend if this recovery's session
    // is still the one in play; otherwise the turn belongs to a chat that's
    // gone, and resending it would land in the wrong (or no) chat.
    if (!this.isCurrentSession(newSession)) return;
    this.emitter.emit('sessionRecovered', newSession.id);
    yield* newSession.sendMessage(message, options);
  }

  /**
   * Stop the in-flight response stream. The partial response received so far is
   * kept. No-op when nothing is generating.
   */
  stop(): void {
    if (!this._isLoading || !this._streamAbort) return;
    this._stopped = true;
    this._streamAbort.abort();
  }

  /**
   * List available LLM models.
   */
  async listModels(): Promise<ModelsResponse> {
    return this.client.request<ModelsResponse>('/v1/models');
  }

  /**
   * Transcribe audio via the engine's /v1/audio/transcriptions endpoint.
   */
  async transcribe(formData: FormData): Promise<TranscriptionResponse> {
    return this.client.uploadRequest<TranscriptionResponse>('/v1/audio/transcriptions', formData);
  }

  /**
   * Upload a file to attach to chat messages.
   *
   * Accepts images (png/jpeg/webp/gif) and PDFs up to the server's size limit.
   * Pass the returned attachment via `sendMessage(content, { attachments })`.
   *
   * @throws {T2VError} `unsupported_attachment_type` if `file.type` is not an
   *   accepted attachment MIME type — rejected client-side (before any upload)
   *   so every caller, including partners with their own composer, is guarded.
   */
  async uploadAttachment(file: File | Blob, filename?: string): Promise<Attachment> {
    // Reject unsupported types up front — the native file dialog lets users
    // bypass the `accept` hint, and this guards headless callers too, avoiding a
    // wasted round-trip and a bare server 415.
    if (!isAllowedAttachmentType(file.type)) {
      throw new T2VError(
        `Unsupported attachment type${file.type ? ` "${file.type}"` : ''}. ` +
          `Talk2View supports ${ATTACHMENT_TYPES_LABEL}.`,
        'unsupported_attachment_type',
      );
    }
    // Uploads require auth — mirror chat()'s anonymous auto-start.
    if (!(await this.autoStartAnonymous())) {
      throw new T2VError('Sign in to upload files.', 'sign_in_required');
    }
    const formData = new FormData();
    const name = filename ?? (file instanceof File ? file.name : 'file');
    formData.append('file', file, name);
    return this.client.uploadRequest<Attachment>('/v1/attachments', formData);
  }

  /**
   * List available speech-to-text models.
   */
  async listAudioModels(): Promise<AudioModelsResponse> {
    return this.client.request<AudioModelsResponse>('/v1/audio/models');
  }

  /**
   * Fetch partner-level configuration defaults.
   *
   * Returns the partner's configured default LLM model, STT model, and system prompt.
   * Values are `null` when no partner override is set (global platform defaults apply).
   *
   * Single-flighted and cached: concurrent callers (e.g. several mounted
   * `usePartnerConfig` hooks) share one GET /v1/config, and later callers reuse
   * the cached value. The cache is invalidated on auth state changes, so a fresh
   * login/logout/user switch refetches.
   */
  async getConfig(): Promise<PartnerConfig> {
    if (this._configCache !== null) return this._configCache;
    if (this._configInFlight !== null) return this._configInFlight;

    const inFlight = this.client
      .request<PartnerConfig>('/v1/config')
      .then((config) => {
        this._configCache = config;
        return config;
      })
      .finally(() => {
        this._configInFlight = null;
      });
    this._configInFlight = inFlight;
    return inFlight;
  }

  /**
   * Drop the cached partner config so the next {@link getConfig} refetches.
   * Called on auth state changes (config is auth-scoped, not session-scoped).
   */
  private invalidateConfigCache(): void {
    this._configCache = null;
    this._configInFlight = null;
  }

  /**
   * Send a direct completion request (e.g. MedGemma) routed through the engine.
   */
  async completions(
    body: {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      max_tokens?: number;
      temperature?: number;
    },
    options?: { timeout?: number },
  ): Promise<unknown> {
    return this.client.request(
      '/v1/completions',
      { method: 'POST', body: JSON.stringify(body) },
      true,
      options?.timeout,
    );
  }

  /**
   * Respond to a pending approval request (human-in-the-loop).
   *
   * Call this after receiving an 'approval_required' ChatEvent.
   */
  async *respondToApproval(
    approval: PendingApproval,
    decision: HumanDecision,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    if (!this.currentSession) {
      throw new Error('No active session. Start a conversation first.');
    }
    const session = this.currentSession;
    try {
      yield* session.respondToApproval(approval, decision, signal);
    } catch (err) {
      if (!isSessionGone(err)) throw err;
      // The engine lost the chat session between the approval and the resume.
      // For an allowed tool the client has already run it, so resending the turn
      // could run it twice: drop the session and let the end-user decide.
      this.currentSession = null;
      this.setPendingApproval(null);
      yield {
        type: 'error',
        message: decision.action === 'deny' ? SESSION_LOST_AFTER_DENY_MESSAGE : SESSION_LOST_MESSAGE,
        errorType: 'session_lost',
      };
    }
  }

  /**
   * Get the current session (if any).
   */
  getSession(): T2VSession | null {
    return this.currentSession;
  }

  /**
   * Clear the current session so the next chat() creates a new one.
   * Also deletes the session on the server so conversation history is reset.
   */
  clearSession(): void {
    if (this.currentSession) {
      const sessionId = this.currentSession.id;
      // Fire-and-forget — don't block the UI on server cleanup
      this.client.request(`/v1/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    this.currentSession = null;
    for (const listener of this.sessionClearListeners) {
      listener();
    }
  }

  /**
   * Drop the cached session when the signed-in identity changes, so the next
   * chat() opens a fresh session owned by the new user. Unlike {@link clearSession}
   * this does NOT delete the old session on the server: it belongs to the previous
   * identity (we no longer hold its token), and the retention sweep reclaims it.
   * Messages/history are kept so the UI isn't wiped and an interrupted task can be
   * resumed in the new session.
   */
  private resetSessionForIdentityChange(): void {
    const hadSession = this.currentSession !== null;
    this.currentSession = null;
    this.setThreadId(null);
    if (hadSession) {
      for (const listener of this.sessionClearListeners) {
        listener();
      }
    }
  }

  /**
   * Subscribe to session clear events.
   *
   * Listeners are called when {@link clearSession} runs. This allows hooks
   * like `useT2VTools` to reset client-side state (e.g. tool registration)
   * so that tools are re-registered on the next session.
   *
   * @returns An unsubscribe function.
   */
  onSessionClear(callback: SessionClearCallback): () => void {
    this.sessionClearListeners.add(callback);
    return () => {
      this.sessionClearListeners.delete(callback);
    };
  }

  /**
   * Subscribe to session create events.
   *
   * Listeners are called after {@link createSession} completes and tools
   * have been re-registered on the new session. This allows hooks like
   * `useT2VTools` to sync client-side registration state.
   *
   * @returns An unsubscribe function.
   */
  onSessionCreate(callback: SessionCreateCallback): () => void {
    this.sessionCreateListeners.add(callback);
    return () => {
      this.sessionCreateListeners.delete(callback);
    };
  }

  // ── Public state getters ──────────────────────────────────────────────────

  get messages(): DisplayMessage[] { return this._messages; }
  get isLoading(): boolean { return this._isLoading; }
  get error(): string | null { return this._error; }
  get pendingApproval(): PendingApproval | null { return this._pendingApproval; }
  get agentStatus(): AgentStatus | null { return this._agentStatus; }
  get threadId(): string | null { return this._threadId; }
  get alwaysAllowedTools(): ReadonlySet<string> { return this._alwaysAllowedTools; }

  // ── Event subscription ────────────────────────────────────────────────────

  on<K extends keyof T2VEventMap>(event: K, callback: (...args: T2VEventMap[K]) => void): () => void {
    return this.emitter.on(event, callback);
  }

  // ── Private state helpers ─────────────────────────────────────────────────

  private setMessages(msgs: DisplayMessage[]): void {
    this._messages = msgs;
    this.emitter.emit('messagesChange', this._messages);
  }

  private setLoading(loading: boolean): void {
    this._isLoading = loading;
    this.emitter.emit('loadingChange', loading);
  }

  private setError(error: string | null): void {
    this._error = error;
    this.emitter.emit('errorChange', error);
  }

  private setPendingApproval(approval: PendingApproval | null): void {
    this._pendingApproval = approval;
    this.emitter.emit('approvalChange', approval);
  }

  private setAgentStatus(status: AgentStatus | null): void {
    this._agentStatus = status;
    this.emitter.emit('statusChange', status);
  }

  private setThreadId(threadId: string | null): void {
    this._threadId = threadId;
    this.emitter.emit('threadIdChange', threadId);
  }

  private setAlwaysAllowed(tools: Set<string>): void {
    this._alwaysAllowedTools = tools;
    this.emitter.emit('alwaysAllowedChange', this._alwaysAllowedTools);
  }

  private nextMessageId(): string {
    return `msg_${++this._messageCounter}_${Date.now()}`;
  }

  private updateAssistantMessage(id: string, updater: (msg: DisplayMessage) => DisplayMessage): void {
    this._messages = this._messages.map((m) => (m.id === id ? updater(m) : m));
    this.emitter.emit('messagesChange', this._messages);
  }

  // ── Stream processing ─────────────────────────────────────────────────────

  /**
   * Process events from a chat stream, updating state as events arrive.
   * Returns whether the stream paused for approval and any auto-approval info.
   */
  /**
   * Create a new streaming assistant message and append it to the message list.
   * Returns the new message's ID.
   */
  private startNewAssistantMessage(): string {
    const msg: DisplayMessage = {
      id: this.nextMessageId(), role: 'assistant', content: '',
      timestamp: new Date(), isStreaming: true,
    };
    this._messages = [...this._messages, msg];
    this.emitter.emit('messagesChange', this._messages);
    return msg.id;
  }

  private async consumeStream(
    stream: AsyncGenerator<ChatEvent>,
    assistantId: string,
  ): Promise<{ paused: boolean; pendingAutoApproval: PendingApproval | null; currentAssistantId: string }> {
    let pendingAutoApproval: PendingApproval | null = null;
    let currentId = assistantId;
    let hadToolSinceLastText = false;

    try {
      for await (const event of stream) {
        if (event.type !== 'text') this.debug('event', event.type, 'toolName' in event ? (event as { toolName: string }).toolName : '');
        switch (event.type) {
          case 'text':
            // After tool calls, finalize current message and start a new one
            if (hadToolSinceLastText) {
              this.updateAssistantMessage(currentId, (m) => ({ ...m, isStreaming: false }));
              currentId = this.startNewAssistantMessage();
              hadToolSinceLastText = false;
            }
            this.updateAssistantMessage(currentId, (m) => ({
              ...m, content: m.content + event.content,
            }));
            break;
          case 'status':
            this.setAgentStatus({ type: event.status, message: event.message });
            break;
          case 'todos':
            this.updateAssistantMessage(currentId, (m) => ({ ...m, plan: event.content }));
            break;
          case 'tool_call':
            this.updateAssistantMessage(currentId, (m) => ({
              ...m, steps: [...(m.steps ?? []), { name: event.toolName, status: 'used' as const, args: stripNullArgs(event.arguments) }],
            }));
            hadToolSinceLastText = true;
            break;
          case 'approval_required': {
            const cleanedArgs = stripNullArgs(event.arguments);
            const approval: PendingApproval = {
              toolCallId: event.toolCallId, toolName: event.toolName,
              arguments: cleanedArgs, description: event.description,
            };
            this.updateAssistantMessage(currentId, (m) => ({
              ...m, steps: [...(m.steps ?? []), { name: event.toolName, status: 'running' as const, args: cleanedArgs }],
            }));
            if (this._alwaysAllowedTools.has(event.toolName)) {
              pendingAutoApproval = approval;
              return { paused: true, pendingAutoApproval, currentAssistantId: currentId };
            }
            this.setPendingApproval(approval);
            return { paused: true, pendingAutoApproval: null, currentAssistantId: currentId };
          }
          case 'approval_result':
            this.updateAssistantMessage(currentId, (m) => ({
              ...m, steps: (m.steps ?? []).map((s) =>
                s.name === event.toolName ? { ...s, status: event.decision === 'deny' ? ('denied' as const) : ('used' as const) } : s),
            }));
            hadToolSinceLastText = true;
            break;
          case 'done':
            this.setThreadId(event.threadId);
            break;
          case 'error':
            // Anonymous demo budget exhaustion arrives as an SSE error chunk
            // tagged budget_exceeded — gate the signup prompt rather than
            // surfacing a raw error to the end user.
            if (event.errorType === 'budget_exceeded' && getIsAnonymous()) {
              this.emitter.emit('demoLimitReached');
            } else {
              this.setError(event.message);
            }
            break;
        }
      }
    } catch (err) {
      // A user-initiated stop aborts the fetch; don't surface that as an error.
      if (!this._stopped) {
        this.setError(err instanceof Error ? err.message : String(err));
      }
    }
    return { paused: false, pendingAutoApproval: null, currentAssistantId: currentId };
  }

  /**
   * Loop consumeStream, auto-approving always-allowed tools until the stream completes.
   */
  private async drainStream(stream: AsyncGenerator<ChatEvent>, assistantId: string): Promise<void> {
    let currentStream = stream;
    let currentId = assistantId;
    while (true) {
      const { paused, pendingAutoApproval, currentAssistantId } = await this.consumeStream(currentStream, currentId);
      currentId = currentAssistantId;
      if (!paused) break;
      if (!pendingAutoApproval) {
        // Manual approval needed — keep isStreaming true so ApprovalCard renders
        this.setLoading(false);
        return;
      }
      this.setAgentStatus({ type: 'auto-approved', message: `Auto-approved ${pendingAutoApproval.toolName}` });
      currentStream = this.respondToApproval(pendingAutoApproval, { action: 'once' }, this._streamAbort?.signal);
    }
    this.finalizeStream(currentId);
  }

  private finalizeStream(assistantId: string): void {
    this.updateAssistantMessage(assistantId, (m) => ({ ...m, isStreaming: false }));
    // Clean up empty trailing messages (tools-only messages with no text are fine, but
    // empty messages created right before 'done' should be removed)
    const last = this._messages[this._messages.length - 1];
    if (last && last.role === 'assistant' && !last.content && !last.steps?.length && !last.plan) {
      this._messages = this._messages.slice(0, -1);
      this.emitter.emit('messagesChange', this._messages);
    }

    // Record the complete assistant turn in conversation history.
    // Collect all text from the segmented display messages that form this turn
    // (consecutive assistant messages after the last user message).
    const parts: string[] = [];
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const m = this._messages[i]!;
      if (m.role !== 'assistant') break;
      if (m.content) parts.unshift(m.content);
    }
    if (parts.length > 0) {
      const merged = parts.join('\n\n');
      this._conversationHistory.push({ role: 'assistant', content: merged });
      this.debug('finalize — assistant turn recorded', { segments: parts.length, contentLength: merged.length });
    } else if (this._error) {
      // Stream errored without producing any assistant text. Roll back the
      // trailing user turn so the next sendMessage doesn't send [..., user, user].
      const lastHist = this._conversationHistory[this._conversationHistory.length - 1];
      if (lastHist?.role === 'user') {
        this._conversationHistory.pop();
        this.debug('finalize — rolled back orphan user turn after error');
      }
    }

    this.setAgentStatus(null);
    this.setLoading(false);
    this._streamAbort = null;
    this._stopped = false;
  }

  // ── Public chat methods ───────────────────────────────────────────────────

  /**
   * Send a message with full state management.
   *
   * Adds user/assistant messages, starts streaming, and updates all state
   * (loading, error, status, etc.) as events arrive.
   */
  async sendMessage(
    content: string,
    options?: { systemPrompt?: string; model?: string; attachments?: Attachment[] },
  ): Promise<void> {
    const attachments = options?.attachments;
    const userMsg: DisplayMessage = {
      id: this.nextMessageId(), role: 'user', content, timestamp: new Date(),
      ...(attachments?.length ? { attachments } : {}),
    };
    const assistantMsg: DisplayMessage = { id: this.nextMessageId(), role: 'assistant', content: '', timestamp: new Date(), isStreaming: true };
    this._messages = [...this._messages, userMsg, assistantMsg];
    this.emitter.emit('messagesChange', this._messages);
    this._lastUserMessage = content;
    this._lastUserAttachments = attachments ?? null;
    this.setLoading(true);
    this.setError(null);

    // Build history from prior turns (exclude current message — T2VSession.sendMessage appends it)
    const historySnapshot = [...this._conversationHistory];
    // Record user turn in conversation history. With attachments the entry is
    // structured content parts, so later turns replay the references and the
    // model keeps seeing the files.
    this._conversationHistory.push({ role: 'user', content: buildUserContent(content, attachments) });
    this.debug('sendMessage', { content, attachments: attachments?.length ?? 0, historyLength: this._conversationHistory.length });
    this.debug('history →', JSON.stringify(this._conversationHistory.map((m) => ({ role: m.role, content: previewContent(m.content) }))));

    const systemPrompt = options?.systemPrompt;
    const model = options?.model ?? this.config.model;
    this._streamAbort = new AbortController();
    this._stopped = false;
    const stream = this.chat(content, { systemPrompt, model, history: historySnapshot, signal: this._streamAbort.signal, attachments });
    await this.drainStream(stream, assistantMsg.id);
  }

  /**
   * Respond to a pending tool approval (human-in-the-loop).
   *
   * If `decision.action` is `'always'`, the tool is remembered and auto-approved
   * for all subsequent calls in this session.
   */
  async approveToolCall(decision: HumanDecision): Promise<void> {
    const approval = this._pendingApproval;
    if (!approval) return;
    if (decision.action === 'always') {
      const updated = new Set(this._alwaysAllowedTools);
      updated.add(approval.toolName);
      this.setAlwaysAllowed(updated);
    }
    this.setPendingApproval(null);
    this.setLoading(true);
    // Find the latest streaming assistant message (the one with the pending tool step)
    let assistantMsg: DisplayMessage | undefined;
    for (let i = this._messages.length - 1; i >= 0; i--) {
      if (this._messages[i]!.role === 'assistant') { assistantMsg = this._messages[i]; break; }
    }
    if (!assistantMsg) return;
    this._streamAbort = new AbortController();
    this._stopped = false;
    const stream = this.respondToApproval(approval, decision, this._streamAbort.signal);
    await this.drainStream(stream, assistantMsg.id);
  }

  /**
   * Retry the last user message. Removes the failed user+assistant pair and resends.
   */
  async retryLastMessage(): Promise<void> {
    if (!this._lastUserMessage) return;
    const content = this._lastUserMessage;
    const attachments = this._lastUserAttachments ?? undefined;
    const msgs = [...this._messages];
    while (msgs.length > 0 && msgs[msgs.length - 1]!.role === 'assistant') msgs.pop();
    while (msgs.length > 0 && msgs[msgs.length - 1]!.role === 'user') msgs.pop();
    this.setMessages(msgs);
    // Remove the last user+assistant pair from conversation history too
    while (this._conversationHistory.length > 0 && this._conversationHistory[this._conversationHistory.length - 1]!.role === 'assistant') this._conversationHistory.pop();
    while (this._conversationHistory.length > 0 && this._conversationHistory[this._conversationHistory.length - 1]!.role === 'user') this._conversationHistory.pop();
    this.setError(null);
    await this.sendMessage(content, attachments?.length ? { attachments } : undefined);
  }

  /**
   * Clear all messages and reset conversation state.
   */
  clearMessages(): void {
    this.setMessages([]);
    this._conversationHistory = [];
    this.setLoading(false);
    this.setError(null);
    this.setPendingApproval(null);
    this.setAgentStatus(null);
    this.setThreadId(null);
    this._lastUserMessage = null;
    this._lastUserAttachments = null;
    this._alwaysAllowedTools = new Set();
    this.emitter.emit('alwaysAllowedChange', this._alwaysAllowedTools);
    this.clearSession();
  }

  /**
   * Clear the current error.
   */
  clearError(): void {
    this.setError(null);
  }

  /**
   * Dispose of this client. Removes the global (window) auth event listeners
   * registered by the auth module. Call this whenever you permanently discard a
   * Talk2View instance — e.g. on app teardown, or when re-creating the client —
   * so the cross-tab `storage`/`talk2view_auth_cleared` listeners don't leak.
   */
  destroy(): void {
    this.auth.destroy();
  }
}

// Re-export types and classes for consumers
export { T2VAuth } from './auth.js';
export { T2VClient } from './client.js';
export { T2VSession } from './sessions.js';
export { T2VSkills } from './skills.js';
export { T2VTools } from './tools.js';
export { TypedEventEmitter } from './event-emitter.js';
export { T2VError, AuthenticationError, PartnerKeyError, SessionError, NetworkError } from './errors.js';
export type {
  T2VEventMap,
  T2VConfig,
  User,
  Attachment,
  AttachmentContentPart,
  MessageContentPart,
  TextContentPart,
  ChatEvent,
  ChatMessage,
  ClientTool,
  ClientToolSchema,
  ToolHandler,
  TokenResponse,
  SignupOutcome,
  ToolCallInterrupt,
  AgentStatus,
  ChatCompletionChunk,
  RegisterToolsResponse,
  RegisterSkillsResponse,
  UserSkill,
  HumanDecision,
  PendingApproval,
  PermissionResult,
  PermissionCheckResult,
  ToolPermissionCallback,
  Model,
  ModelsResponse,
  TranscriptionResponse,
  AudioModelsResponse,
  GeneratedImageDisplay,
  ImageFailureDisplay,
  ImageToolDisplay,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageData,
  ImagesResponse,
  ImageModel,
  ImageModelsResponse,
  PartnerConfig,
  UserPreferences,
  DisplayMessage,
  ToolStep,
} from './types.js';
