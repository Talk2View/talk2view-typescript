/**
 * Tools module — register client tools and handle tool call execution.
 */

import type { T2VClient } from './client';
import type { ClientTool, ClientToolSchema, RegisterToolsResponse, ToolHandler } from './types';

export class T2VTools {
  private handlers: Map<string, ToolHandler> = new Map();
  private schemas: ClientToolSchema[] = [];

  constructor(private readonly client: T2VClient) {}

  /**
   * Register a handler for a specific tool name.
   * When the agent calls this tool, the handler executes locally.
   */
  handle(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  /**
   * Register tool schemas with the backend and store handlers.
   *
   * Accepts either ClientToolSchema[] (with separate .handle() calls)
   * or ClientTool[] (with inline execute functions).
   */
  async register(tools: (ClientToolSchema | ClientTool)[]): Promise<RegisterToolsResponse> {
    const schemasToRegister: ClientToolSchema[] = [];

    for (const tool of tools) {
      // Extract schema (without execute)
      const schema: ClientToolSchema = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        return_direct: tool.return_direct,
      };
      schemasToRegister.push(schema);

      // If tool has an inline execute function, register as handler
      if ('execute' in tool && typeof tool.execute === 'function') {
        this.handlers.set(tool.name, tool.execute);
      }
    }

    this.schemas = schemasToRegister;

    return this.client.request<RegisterToolsResponse>('/v1/tools/register', {
      method: 'POST',
      body: JSON.stringify({ tools: schemasToRegister }),
    });
  }

  /**
   * Execute a tool call locally using the registered handler.
   * Returns the result string, or an error JSON string if the tool is unknown.
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ result: string; isError: boolean }> {
    const handler = this.handlers.get(toolName);

    if (!handler) {
      return {
        result: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
        isError: true,
      };
    }

    try {
      const raw = await handler(args);
      const result = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return { result, isError: false };
    } catch (err) {
      const message =
        err instanceof Error ? err.message :
        typeof err === 'string' ? err :
        JSON.stringify(err);
      return {
        result: JSON.stringify({ error: message }),
        isError: true,
      };
    }
  }

  /**
   * Check if a handler is registered for a tool.
   */
  hasHandler(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  /**
   * Get all registered tool schemas.
   */
  getRegistered(): ClientToolSchema[] {
    return [...this.schemas];
  }
}
