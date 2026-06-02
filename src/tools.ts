/**
 * Tools module — register client tools and handle tool call execution.
 */

import type { T2VClient } from './client';
import type {
  ClientTool,
  ClientToolSchema,
  PermissionCheckResult,
  RegisterToolsResponse,
  ToolHandler,
  ToolPermissionCallback,
} from './types';

/**
 * Strip null/undefined — and empty objects — from tool args.
 * LLMs frequently send null, or an empty object `{}`, for optional parameters
 * they don't intend to set. Dropping both keeps such "no value" placeholders
 * from tripping schema type validation for scalar-typed params (e.g. a model
 * passing `section: {}` to mean "no section" on an optional string field).
 */
export function stripNullArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    // An empty object is how some models signal "unset" for an optional param;
    // treat it the same as null so it doesn't fail type validation downstream.
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

export class T2VTools {
  private handlers: Map<string, ToolHandler> = new Map();
  private schemas: ClientToolSchema[] = [];
  private permissions: Map<string, boolean | ToolPermissionCallback> = new Map();

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

      // Track permission config
      if (tool.permission !== undefined && tool.permission !== false) {
        this.permissions.set(tool.name, tool.permission);
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

    const cleanArgs = stripNullArgs(args);

    const validationError = this.validateArgs(toolName, cleanArgs);
    if (validationError) {
      return {
        result: JSON.stringify({ error: validationError }),
        isError: true,
      };
    }

    try {
      const raw = await handler(cleanArgs);
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
   * Run permission check for a tool call.
   *
   * - No permission config → allow
   * - `permission: true` → require_approval (show approval card)
   * - `permission: callback` → delegate to callback
   */
  async checkPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PermissionCheckResult> {
    const perm = this.permissions.get(toolName);
    if (perm === undefined || perm === false) {
      return { action: 'allow' };
    }
    if (perm === true) {
      return { action: 'require_approval' };
    }
    // Callback — programmatic decision
    const result = await perm(toolName, args);
    if (result.type === 'allow') {
      return { action: 'allow', updatedInput: result.updatedInput };
    }
    return { action: 'deny', message: result.message };
  }

  /**
   * Get the description of a registered tool.
   */
  getDescription(toolName: string): string {
    return this.schemas.find((s) => s.name === toolName)?.description ?? '';
  }

  /**
   * Re-register existing tool schemas with the backend.
   *
   * Called automatically when a new session is created so that
   * session-scoped tools survive a clear-chat / session reset.
   * Returns null if no schemas are registered.
   */
  async reRegister(): Promise<RegisterToolsResponse | null> {
    if (this.schemas.length === 0) return null;
    return this.client.request<RegisterToolsResponse>('/v1/tools/register', {
      method: 'POST',
      body: JSON.stringify({ tools: this.schemas }),
    });
  }

  /**
   * Get all registered tool schemas.
   */
  getRegistered(): ClientToolSchema[] {
    return [...this.schemas];
  }
}
