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
import { T2VTools } from './tools';
import type { ChatEvent, ChatMessage, T2VConfig } from './types';

export class Talk2View {
  readonly auth: T2VAuth;
  readonly tools: T2VTools;
  private readonly client: T2VClient;
  readonly config: T2VConfig;
  private currentSession: T2VSession | null = null;

  constructor(config: T2VConfig) {
    this.config = config;
    this.client = new T2VClient(config);
    this.auth = new T2VAuth(this.client);
    this.tools = new T2VTools(this.client);
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

    const session = new T2VSession(response, this.client, this.tools);
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
   * Get the current session (if any).
   */
  getSession(): T2VSession | null {
    return this.currentSession;
  }
}

// Re-export types and classes for consumers
export { T2VAuth } from './auth';
export { T2VClient } from './client';
export { T2VSession } from './sessions';
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
  ChatCompletionChunk,
  RegisterToolsResponse,
  Model,
  ModelsResponse,
} from './types';
