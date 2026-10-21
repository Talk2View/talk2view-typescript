/**
 * Sessions module — create sessions, send messages with streaming, resume after tool calls.
 */

import type { T2VClient } from './client.js';
import type { T2VTools } from './tools.js';
import type {
  Attachment,
  ChatEvent,
  ChatMessage,
  CreateSessionResponse,
  HumanDecision,
  MessageContentPart,
  PendingApproval,
  T2VConfig,
} from './types.js';

/**
 * What the engine is told about a turn beyond its messages. Each option is
 * sent only when given, on `/messages` and on every `/resume` of the turn, so
 * the model calls after a resume see the same. The chat gives none.
 */
export interface TurnOptions {
  /**
   * The client surface the turn comes from: `'keyboard'` (a panel the size of
   * the keyboard, inside another app), `'app'` (a full-screen chat) or
   * `'voice'` (a voice call: the reply is spoken, so the engine asks for short
   * plain prose).
   */
  surface?: 'keyboard' | 'app' | 'voice';
  /** The client can show approval prompts, so the engine gates flagged tools behind them. */
  supportsApproval?: boolean;
  /** The client shows platform-tool activity, so the engine streams `tool_event` chunks. */
  supportsToolEvents?: boolean;
}

/** The given turn options, under the engine's names. */
function turnFields(turn?: TurnOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (turn?.surface !== undefined) fields.surface = turn.surface;
  if (turn?.supportsApproval !== undefined) fields.supports_approval = turn.supportsApproval;
  if (turn?.supportsToolEvents !== undefined) fields.supports_tool_events = turn.supportsToolEvents;
  return fields;
}

/**
 * Build user message content — a plain string normally, structured content
 * parts when attachments are present.
 */
export function buildUserContent(
  content: string,
  attachments?: Attachment[],
): string | MessageContentPart[] {
  if (!attachments?.length) return content;
  const parts: MessageContentPart[] = [];
  if (content) parts.push({ type: 'text', text: content });
  parts.push(...attachments.map((a): MessageContentPart => ({ type: 'attachment', attachment_id: a.id })));
  return parts;
}

export class T2VSession {
  readonly id: string;
  readonly threadId: string;
  readonly model: string;

  constructor(
    data: CreateSessionResponse,
    private readonly client: T2VClient,
    private readonly tools: T2VTools,
    private readonly config?: T2VConfig,
  ) {
    this.id = data.session_id;
    this.threadId = data.thread_id;
    this.model = data.model;
  }

  /**
   * Send a message and stream the response.
   *
   * Tool calls are handled automatically if handlers are registered.
   * Yields ChatEvent objects for the caller to render. The {@link TurnOptions}
   * go with this request and every resume of the turn.
   */
  async *sendMessage(
    content: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      history?: ChatMessage[];
      signal?: AbortSignal;
      attachments?: Attachment[];
    } & TurnOptions,
  ): AsyncGenerator<ChatEvent> {
    const messages: ChatMessage[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options?.history) {
      messages.push(...options.history);
    }
    messages.push({ role: 'user', content: buildUserContent(content, options?.attachments) });

    yield* this.processStream(
      `/v1/sessions/${this.id}/messages`,
      { messages, stream: true, model: options?.model ?? this.config?.model, ...turnFields(options) },
      options?.signal,
      options,
    );
  }

  /**
   * Resume after a tool call (for manual tool handling). `turn` carries the
   * options the turn started with.
   */
  async *resumeToolCall(
    toolCallId: string,
    result: string,
    isError = false,
    signal?: AbortSignal,
    turn?: TurnOptions,
  ): AsyncGenerator<ChatEvent> {
    yield* this.processStream(
      `/v1/sessions/${this.id}/resume`,
      { tool_call_id: toolCallId, result, is_error: isError, ...turnFields(turn) },
      signal,
      turn,
    );
  }

  /**
   * Respond to a pending approval request (human-in-the-loop).
   *
   * - once: executes the tool with original args, resumes with result
   * - always: same as once (session-level memory is handled by the hook layer)
   * - deny: skips execution, resumes with corrective feedback
   *
   * `turn` carries the options the turn started with.
   */
  async *respondToApproval(
    approval: PendingApproval,
    decision: HumanDecision,
    signal?: AbortSignal,
    turn?: TurnOptions,
  ): AsyncGenerator<ChatEvent> {
    const { toolCallId, toolName } = approval;
    const execArgs = decision.updatedInput ?? approval.arguments;
    let result: string;
    let isError = false;

    switch (decision.action) {
      case 'once':
      case 'always': {
        const outcome = await this.tools.executeToolCall(toolName, execArgs);
        result = outcome.result;
        isError = outcome.isError;
        break;
      }
      case 'deny': {
        result = `User denied this action. ${decision.feedback ?? ''}`.trim();
        isError = true;
        break;
      }
    }

    yield { type: 'approval_result', toolName, decision: decision.action };
    yield* this.resumeToolCall(toolCallId, result, isError, signal, turn);
  }

  /**
   * Internal: process an SSE stream with automatic tool call handling. Its
   * resumes carry the turn's options.
   */
  private async *processStream(
    endpoint: string,
    body: object,
    signal?: AbortSignal,
    turn?: TurnOptions,
  ): AsyncGenerator<ChatEvent> {
    for await (const chunk of this.client.streamRequest(endpoint, body, signal)) {
      // Debug: log raw chunks to see what the server actually sends
      if (this.config?.debug) console.log('[T2V] raw chunk', JSON.stringify(chunk).slice(0, 500));

      // Agent status update (non-terminal — stream continues)
      if (chunk.status) {
        yield { type: 'status', status: chunk.status.type, message: chunk.status.message };
      }

      // Todos (planning scratchpad) update
      if (chunk.todos) {
        yield { type: 'todos', content: chunk.todos };
      }

      // Check for tool call interrupt
      if (chunk.interrupt) {
        const { tool_name, tool_call_id, arguments: args } = chunk.interrupt;

        // Run permission check
        const permResult = await this.tools.checkPermission(tool_name, args);

        switch (permResult.action) {
          case 'require_approval':
            // Pause for human decision (approval card)
            yield {
              type: 'approval_required',
              toolName: tool_name,
              toolCallId: tool_call_id,
              arguments: args,
              description: this.tools.getDescription(tool_name),
            };
            return;

          case 'deny':
            // Programmatic denial — resume with error
            yield* this.resumeToolCall(
              tool_call_id,
              `Permission denied: ${permResult.message ?? 'Tool not allowed'}`,
              true,
              signal,
              turn,
            );
            return;

          case 'allow': {
            const execArgs = permResult.updatedInput ?? args;

            if (this.tools.hasHandler(tool_name)) {
              yield {
                type: 'tool_call',
                toolName: tool_name,
                toolCallId: tool_call_id,
                arguments: execArgs,
              };

              const { result, isError } = await this.tools.executeToolCall(tool_name, execArgs);
              yield* this.resumeToolCall(tool_call_id, result, isError, signal, turn);
              return;
            }

            // No handler — emit for manual handling
            yield {
              type: 'tool_call',
              toolName: tool_name,
              toolCallId: tool_call_id,
              arguments: execArgs,
            };
            return;
          }
        }
      }

      // Structured error from the engine — surface as an `error` event so
      // consumers can distinguish failures from AI output instead of rendering
      // the catch-all string as assistant text.
      if (chunk.error) {
        yield {
          type: 'error',
          message: chunk.error.message,
          errorType: chunk.error.type,
          detail: chunk.error.detail,
          requestId: chunk.error.request_id,
        };
      } else {
        // Text content
        // `choices` is declared required, but a chunk that carries only
        // metadata (a status line, a keep-alive) can arrive without it. An
        // unguarded read throws and takes the whole turn down, so guard the
        // array as well as its first element.
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yield { type: 'text', content: delta };
        }
      }

      // Done
      if (chunk.choices?.[0]?.finish_reason === 'stop') {
        yield { type: 'done', threadId: chunk.thread_id ?? this.threadId };
        return;
      }
    }
  }
}
