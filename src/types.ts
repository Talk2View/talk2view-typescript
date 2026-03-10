// ── Configuration ──

export interface T2VConfig {
  partnerKey: string;
  baseUrl?: string;
  /** @deprecated Voice requests now route through baseUrl. This option will be removed in a future version. */
  voiceApiUrl?: string;
  model?: string;
  /** Timeout in milliseconds for HTTP requests. Defaults to 30000 (30s). Does not apply to SSE streams after connection. */
  requestTimeout?: number;
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
  user_api_key?: string;
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
  model?: string;
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

export interface AgentStatus {
  type: string;
  message: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  thread_id?: string;
  interrupt?: ToolCallInterrupt;
  status?: AgentStatus;
  todos?: string;
}

// ── Chat Events (public API) ──

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolName: string; toolCallId: string; arguments: Record<string, unknown> }
  | { type: 'done'; threadId: string }
  | { type: 'error'; message: string }
  | { type: 'status'; status: string; message: string }
  | { type: 'todos'; todos: string };

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

// ── Skills ──

export interface UserSkill {
  name: string;
  description: string;
  content: string;
}

export interface RegisterSkillsResponse {
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

// ── Audio ──

export interface TranscriptionResponse {
  text: string;
}

export type AudioModelsResponse = ModelsResponse;

// ── User Preferences ──

export interface UserPreferences {
  model?: string;
  sttModel?: string;
  sttLanguage?: string;
  fontSize?: 'small' | 'medium' | 'large';
}

// ── Errors ──

export interface APIErrorBody {
  error: {
    type: string;
    message: string;
    code?: string;
  };
}
