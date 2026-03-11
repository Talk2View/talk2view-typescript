/**
 * Talk2View SDK — Add AI-powered natural language control to any application.
 *
 * @example
 * ```typescript
 * import { Talk2View } from '@talk2view/sdk';
 *
 * const t2v = new Talk2View({ partnerKey: 'pk_live_abc123' });
 *
 * await t2v.auth.login('user@example.com', 'password');
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

import { T2VAuth } from './auth';
import { T2VClient } from './client';
import { T2VSession } from './sessions';
import { T2VSkills } from './skills';
import { T2VTools } from './tools';
import type { AudioModelsResponse, ChatEvent, ChatMessage, HumanDecision, PartnerConfig, PendingApproval, Model, ModelsResponse, T2VConfig, TranscriptionResponse } from './types';

type SessionClearCallback = () => void;

export class Talk2View {
  readonly auth: T2VAuth;
  readonly tools: T2VTools;
  readonly skills: T2VSkills;
  private readonly client: T2VClient;
  readonly config: T2VConfig;
  private currentSession: T2VSession | null = null;
  private sessionClearListeners: Set<SessionClearCallback> = new Set();

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
    return session;
  }

  /**
   * Send a message with automatic session management and tool handling.
   *
   * Creates a session if one doesn't exist. Tool calls are handled
   * automatically if handlers are registered via `t2v.tools.handle()`.
   */
  async *chat(
    message: string,
    options?: { systemPrompt?: string; history?: ChatMessage[] },
  ): AsyncGenerator<ChatEvent> {
    if (!this.currentSession) {
      await this.createSession();
    }

    yield* this.currentSession!.sendMessage(message, options);
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
   */
  async getConfig(): Promise<PartnerConfig> {
    return this.client.request<PartnerConfig>('/v1/config');
  }

  /**
   * Send a direct completion request (e.g. MedGemma) routed through the engine.
   */
  async completions(body: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    max_tokens?: number;
    temperature?: number;
  }): Promise<unknown> {
    return this.client.request('/v1/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Respond to a pending approval request (human-in-the-loop).
   *
   * Call this after receiving an 'approval_required' ChatEvent.
   */
  async *respondToApproval(
    approval: PendingApproval,
    decision: HumanDecision,
  ): AsyncGenerator<ChatEvent> {
    if (!this.currentSession) {
      throw new Error('No active session. Start a conversation first.');
    }
    yield* this.currentSession.respondToApproval(approval, decision);
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
}

// Re-export types and classes for consumers
export { T2VAuth } from './auth';
export { T2VClient } from './client';
export { T2VSession } from './sessions';
export { T2VSkills } from './skills';
export { T2VTools } from './tools';
export { T2VError, AuthenticationError, PartnerKeyError, SessionError, NetworkError } from './errors';
export type {
  T2VConfig,
  User,
  ChatEvent,
  ChatMessage,
  ClientTool,
  ClientToolSchema,
  ToolHandler,
  TokenResponse,
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
  PartnerConfig,
  UserPreferences,
} from './types';
