// ── Configuration ──

export interface T2VConfig {
  partnerKey: string;
  baseUrl?: string;
  /** @deprecated Voice requests now route through baseUrl. This option will be removed in a future version. */
  voiceApiUrl?: string;
  model?: string;
  /** Timeout in milliseconds for HTTP requests. Defaults to 30000 (30s). Does not apply to SSE streams after connection. */
  requestTimeout?: number;
  /** Enable debug logging to console. Logs streaming events, tool calls, history, and state changes. */
  debug?: boolean;
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
  | { type: 'approval_required'; toolName: string; toolCallId: string; arguments: Record<string, unknown>; description: string }
  | { type: 'approval_result'; toolName: string; decision: HumanDecision['action'] }
  | { type: 'todos'; content: string }
  | { type: 'done'; threadId: string }
  | { type: 'error'; message: string }
  | { type: 'status'; status: string; message: string };

// ── Human-in-the-Loop ──

/**
 * Permission result from a ToolPermissionCallback.
 * Mirrors Claude Agent SDK's PermissionResultAllow / PermissionResultDeny.
 */
export type PermissionResult =
  | { type: 'allow'; updatedInput?: Record<string, unknown> }
  | { type: 'deny'; message?: string };

/**
 * Async callback for programmatic per-call tool permission decisions.
 * Equivalent to Claude Agent SDK's `can_use_tool` callback.
 */
export type ToolPermissionCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<PermissionResult>;

/**
 * Internal result from T2VTools.checkPermission().
 */
export type PermissionCheckResult =
  | { action: 'allow'; updatedInput?: Record<string, unknown> }
  | { action: 'require_approval' }
  | { action: 'deny'; message?: string };

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
}

export interface HumanDecision {
  action: 'once' | 'always' | 'deny';
  /** Optional corrective feedback (typically for 'deny'). */
  feedback?: string;
  /** Optional updated arguments (for 'once' or 'always'). */
  updatedInput?: Record<string, unknown>;
}

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
  /**
   * Permission check before tool execution.
   * - `true`: always requires human approval (shows approval card)
   * - `false` / omitted: auto-execute
   * - callback: programmatic per-call decision (like Claude Agent SDK's can_use_tool)
   */
  permission?: boolean | ToolPermissionCallback;
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

// ── Partner Config ──

export interface PartnerConfig {
  default_llm_model: string | null;
  default_stt_model: string | null;
  system_prompt: string | null;
}

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

// ── Display / UI ──

export interface ToolStep {
  name: string;
  status: 'used' | 'denied' | 'running';
  args?: Record<string, unknown>;
  result?: string;
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  /** Markdown checklist from the agent's planning tool (write_todos). */
  plan?: string;
  /** Completed tool call steps (rendered as collapsible inline steps). */
  steps?: ToolStep[];
}

export interface T2VEventMap {
  [key: string]: unknown[];
  messagesChange: [DisplayMessage[]];
  loadingChange: [boolean];
  errorChange: [string | null];
  approvalChange: [PendingApproval | null];
  statusChange: [AgentStatus | null];
  threadIdChange: [string | null];
  alwaysAllowedChange: [ReadonlySet<string>];
}

// ── Theme ──

export interface Talk2ViewTheme {
  accent?: string;
  accentForeground?: string;
  bg?: string;
  foreground?: string;
  muted?: string;
  border?: string;
  userBubble?: string;
  userForeground?: string;
  error?: string;
  radius?: number;
  font?: string;
  fontMono?: string;
  surface?: string;
  surfaceHover?: string;
}
