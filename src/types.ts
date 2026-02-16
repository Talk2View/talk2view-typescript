// ── Configuration ──

export interface T2VConfig {
  partnerKey: string;
  baseUrl?: string;
  model?: string;
}

// ── Auth ──

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
}

export interface User {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User | null;
  litellm_api_key?: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// ── Sessions ──

export interface CreateSessionResponse {
  session_id: string;
  thread_id: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface SendMessageRequest {
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
}

// ── Streaming ──

export interface ChatCompletionChunkDelta {
  role?: string;
  content?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ToolCallInterrupt {
  type: 'tool_call';
  tool_name: string;
  tool_call_id: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  thread_id?: string;
  interrupt?: ToolCallInterrupt;
}

// ── Chat Events (public API) ──

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
  | { type: 'done'; threadId: string }
  | { type: 'error'; message: string };

// ── Tools ──

export interface ClientToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface ClientToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ClientToolParameter>;
    required?: string[];
    additionalProperties?: boolean;
  };
  return_direct?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ClientTool extends ClientToolSchema {
  execute: ToolHandler;
}

export interface RegisterToolsResponse {
  registered: string[];
  count: number;
}

// ── Models ──

export interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: string;
  data: Model[];
}

// ── Errors ──

export interface APIErrorBody {
  error: {
    type: string;
    message: string;
  };
}
