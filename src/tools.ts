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
   * Validate tool arguments against the registered schema.
   * Returns an error message string, or null if valid.
   */
  private validateArgs(toolName: string, args: Record<string, unknown>): string | null {
    const schema = this.schemas.find((s) => s.name === toolName);
    if (!schema) return null; // no schema to validate against

    const { properties, required } = schema.parameters;

    // Check required fields
    if (required) {
      for (const field of required) {
        if (!(field in args) || args[field] === undefined) {
          return `Missing required argument: ${field}`;
        }
      }
    }

    // Type-check provided fields
    for (const [key, value] of Object.entries(args)) {
      const propSchema = properties[key];
      if (!propSchema) continue; // allow extra properties

      const expectedType = propSchema.type;
      if (expectedType && !this.checkType(value, expectedType)) {
        return `Argument "${key}" expected type "${expectedType}", got ${typeof value}`;
      }

      // Enum constraint
      if (propSchema.enum && !propSchema.enum.includes(String(value))) {
        return `Argument "${key}" must be one of: ${propSchema.enum.join(', ')}`;
      }
    }

    return null;
  }

  private checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true;
    }
  }

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

    const validationError = this.validateArgs(toolName, args);
    if (validationError) {
      return {
        result: JSON.stringify({ error: validationError }),
        isError: true,
      };
    }

    try {
      const raw = await handler(args);
      const result = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '';
      return { result, isError: false };
    } catch (err) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'string') {
        message = err;
      } else {
        try {
          message = JSON.stringify(err);
        } catch {
          message = String(err);
        }
      }
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
