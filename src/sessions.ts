/**
 * Sessions module — create sessions, send messages with streaming, resume after tool calls.
 */

import type { T2VClient } from './client';
import type { T2VTools } from './tools';
import type {
  ChatEvent,
  ChatMessage,
  CreateSessionResponse,
} from './types';

export class T2VSession {
  readonly id: string;
  readonly threadId: string;
  readonly model: string;

  constructor(
    data: CreateSessionResponse,
    private readonly client: T2VClient,
    private readonly tools: T2VTools,
  ) {
    this.id = data.session_id;
    this.threadId = data.thread_id;
    this.model = data.model;
  }

  /**
   * Send a message and stream the response.
   *
   * Tool calls are handled automatically if handlers are registered.
   * Yields ChatEvent objects for the caller to render.
   */
  async *sendMessage(
    content: string,
    options?: { systemPrompt?: string; history?: ChatMessage[] },
  ): AsyncGenerator<ChatEvent> {
    const messages: ChatMessage[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options?.history) {
      messages.push(...options.history);
    }
    messages.push({ role: 'user', content });

    yield* this.processStream(
      `/v1/sessions/${this.id}/messages`,
      { messages, stream: true },
    );
  }

  /**
   * Resume after a tool call (for manual tool handling).
   */
  async *resumeToolCall(
    toolCallId: string,
    result: string,
    isError = false,
  ): AsyncGenerator<ChatEvent> {
    yield* this.processStream(
      `/v1/sessions/${this.id}/resume`,
      { tool_call_id: toolCallId, result, is_error: isError },
    );
  }

  /**
   * Internal: process an SSE stream with automatic tool call handling.
   */
  private async *processStream(
    endpoint: string,
    body: object,
  ): AsyncGenerator<ChatEvent> {
    for await (const chunk of this.client.streamRequest(endpoint, body)) {
      // Agent status update (non-terminal — stream continues)
      if (chunk.status) {
        yield { type: 'status', status: chunk.status.type, message: chunk.status.message };
      }

      // Todos update (non-terminal — stream continues)
      if (chunk.todos) {
        yield { type: 'todos', todos: chunk.todos };
      }

      // Check for tool call interrupt
      if (chunk.interrupt) {
        const { tool_name, tool_call_id, arguments: args } = chunk.interrupt;

        // If we have a handler, execute automatically and resume
        if (this.tools.hasHandler(tool_name)) {
          // Emit tool_call event so the UI knows what's happening
          yield {
            type: 'tool_call',
            toolName: tool_name,
            toolCallId: tool_call_id,
            arguments: args,
          };

          // Execute the tool
          const { result, isError } = await this.tools.executeToolCall(tool_name, args);

          // Resume and continue streaming
          yield* this.processStream(
            `/v1/sessions/${this.id}/resume`,
            { tool_call_id, result, is_error: isError },
          );
          return;
        }

        // No handler — emit the event for manual handling
        yield {
          type: 'tool_call',
          toolName: tool_name,
          toolCallId: tool_call_id,
          arguments: args,
        };
        return;
      }

      // Text content
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield { type: 'text', content: delta };
      }

      // Done
      if (chunk.choices[0]?.finish_reason === 'stop') {
        yield { type: 'done', threadId: chunk.thread_id ?? this.threadId };
        return;
      }
    }
  }
}
