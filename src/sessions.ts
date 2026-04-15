/**
 * Sessions module — create sessions, send messages with streaming, resume after tool calls.
 */

import type { T2VClient } from './client';
import type { T2VTools } from './tools';
import type {
  ChatEvent,
  ChatMessage,
  CreateSessionResponse,
  HumanDecision,
  PendingApproval,
  T2VConfig,
} from './types';

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
   * Yields ChatEvent objects for the caller to render.
   */
  async *sendMessage(
    content: string,
    options?: { systemPrompt?: string; model?: string; history?: ChatMessage[] },
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
      { messages, stream: true, model: options?.model ?? this.config?.model },
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
   * Respond to a pending approval request (human-in-the-loop).
   *
   * - once: executes the tool with original args, resumes with result
   * - always: same as once (session-level memory is handled by the hook layer)
   * - deny: skips execution, resumes with corrective feedback
   */
  async *respondToApproval(
    approval: PendingApproval,
    decision: HumanDecision,
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
    yield* this.resumeToolCall(toolCallId, result, isError);
  }

  /**
   * Internal: process an SSE stream with automatic tool call handling.
   */
  private async *processStream(
    endpoint: string,
    body: object,
  ): AsyncGenerator<ChatEvent> {
    for await (const chunk of this.client.streamRequest(endpoint, body)) {
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
              yield* this.resumeToolCall(tool_call_id, result, isError);
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
