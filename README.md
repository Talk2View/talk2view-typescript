# @talk2view/sdk

Add AI-powered natural language control to any application. Talk2View's SDK handles authentication, tool registration, streaming chat, and the interrupt/resume cycle for client-side tool execution.

## Installation

```bash
npm install @talk2view/sdk
```

## Quick Start

### React (recommended)

```tsx
import { T2VProvider, ChatPanel } from '@talk2view/sdk/react';
import type { ClientTool } from '@talk2view/sdk';

const tools: ClientTool[] = [
  {
    name: 'set_color',
    description: 'Set the background color of the canvas',
    parameters: {
      type: 'object',
      properties: {
        color: { type: 'string', description: 'CSS color value' },
      },
      required: ['color'],
    },
    execute: async (args) => {
      document.body.style.backgroundColor = args.color as string;
      return JSON.stringify({ success: true, color: args.color });
    },
  },
];

function App() {
  return (
    <T2VProvider partnerKey="pk_live_..." baseUrl="https://api.talk2view.com">
      <ChatPanel tools={tools} systemPrompt="You control a canvas." />
    </T2VProvider>
  );
}
```

That's it. The `ChatPanel` handles login, tool registration, streaming chat, and tool execution automatically.

### Vanilla JavaScript

```typescript
import { Talk2View } from '@talk2view/sdk';

const t2v = new Talk2View({ partnerKey: 'pk_live_...' });

// 1. Authenticate
await t2v.auth.login('user@example.com', 'password');

// 2. Register tools with handlers
t2v.tools.handle('get_time', async () => {
  return new Date().toISOString();
});

await t2v.tools.register([
  {
    name: 'get_time',
    description: 'Get the current time',
    parameters: { type: 'object', properties: {} },
  },
]);

// 3. Chat — tool calls are handled automatically
for await (const event of t2v.chat('What time is it?')) {
  if (event.type === 'text') process.stdout.write(event.content);
  if (event.type === 'done') console.log('\n');
}
```

---

## Concepts

### Partner Keys

Every request requires a partner API key (`X-T2V-Partner-Key` header). Keys are scoped to your application:

- `pk_test_...` — test keys for development
- `pk_live_...` — production keys

The SDK attaches this header automatically.

**Partner keys are public identifiers**, not secrets. They identify your application but do not grant access to user data — every data-accessing request also requires a user JWT. It is safe to include partner keys in client-side bundles.

Best practices:
- Inject keys via environment variables at build time (e.g. `VITE_T2V_PARTNER_KEY`)
- Use separate `pk_test_` and `pk_live_` keys for development and production
- To rotate a key, generate a new key in the Talk2View dashboard, update your app, then deactivate the old key

### Two-Tier Authentication

Talk2View uses two layers of auth on every request:

1. **Partner key** — identifies your application
2. **User JWT** — identifies the end-user (obtained via `auth.login()`)

The SDK manages token storage, refresh, and retry automatically.

### Client Tools

Tools are functions that run **in your application**, not on the server. When the AI decides to call a tool:

1. The server pauses the AI agent
2. The server sends a `tool_call` event to your app via SSE
3. Your app executes the tool locally using the registered handler
4. Your app sends the result back to the server (via `/resume`)
5. The server resumes the AI agent with the result

The SDK handles steps 2-5 automatically when you provide an `execute` function on your tools.

### `return_direct`

Tools with `return_direct: true` skip the AI's post-processing step. The tool result is returned directly to the user without the AI rephrasing it. Use this for tools that return UI updates or structured data that doesn't need summarization.

---

## React API

### `<T2VProvider>`

Context provider that initializes the Talk2View client. Wrap your app (or the section that uses Talk2View) with this.

```tsx
<T2VProvider
  partnerKey="pk_live_..."   // Required
  baseUrl="https://api.talk2view.com"  // Optional, defaults to localhost:8100
  model="gpt-4.1-mini"      // Optional, uses server default
>
  {children}
</T2VProvider>
```

### `<ChatPanel>`

Self-contained chat UI with built-in login, tool registration, message list, and input. Drop this in and it works.

```tsx
<ChatPanel
  tools={myTools}            // ClientTool[] — tools with execute handlers
  systemPrompt="You are..."  // Optional system prompt
  signupUrl="https://..."    // Optional, link shown on login form
  className="my-chat"        // Optional CSS class
  style={{ height: '100%' }} // Optional inline styles
/>
```

If the user isn't logged in, `ChatPanel` shows a login form automatically. After login, it registers the provided tools and enables the chat input.

### `<LoginModal>`

Standalone login form. Use this if you want to control placement separately from the chat UI.

```tsx
<LoginModal
  signupUrl="https://talk2view.com/auth?signup"  // Optional
  onSuccess={() => console.log('Logged in!')}     // Optional callback
  className="my-login"                             // Optional CSS class
/>
```

Returns `null` if the user is already authenticated.

### `useT2V()`

Access the Talk2View client instance and auth state.

```tsx
const { t2v, user, isAuthenticated } = useT2V();
```

### `useT2VAuth()`

Authentication state and actions.

```tsx
const {
  user,              // User | null
  isAuthenticated,   // boolean
  isLoading,         // boolean
  error,             // string | null
  login,             // (email: string, password: string) => Promise<void>
  signup,            // (email: string, password: string) => Promise<void>
  logout,            // () => Promise<void>
  clearError,        // () => void
} = useT2VAuth();
```

### `useT2VChat()`

Chat state and message sending.

```tsx
const {
  messages,          // DisplayMessage[]
  isLoading,         // boolean — true while streaming
  error,             // string | null
  threadId,          // string | null
  agentStatus,       // { type: string; message: string } | null — real-time agent status
  todos,             // string — agent's current todo/plan text
  sendMessage,       // (content: string) => Promise<void>
  clearMessages,     // () => void
  clearError,        // () => void
} = useT2VChat({ systemPrompt: 'You are a helpful assistant.' });
```

`DisplayMessage` shape:
```typescript
{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean  // true while the assistant is still generating
}
```

### `useT2VTools()`

Tool registration.

```tsx
const {
  registerTools,     // (tools: ClientTool[]) => Promise<RegisterToolsResponse>
  registeredTools,   // string[] — names of registered tools
  isRegistered,      // boolean
} = useT2VTools();
```

---

## Core API (framework-agnostic)

### `Talk2View`

Main entry point. Use this directly for vanilla JS or non-React frameworks.

```typescript
const t2v = new Talk2View({
  partnerKey: 'pk_live_...',          // Required
  baseUrl: 'https://api.talk2view.com', // Optional
  model: 'gpt-4.1-mini',             // Optional
});
```

#### `t2v.auth`

```typescript
await t2v.auth.login(email, password)    // Returns User
await t2v.auth.signup(email, password)   // Returns User
await t2v.auth.logout()
t2v.auth.getUser()                       // Returns User | null
t2v.auth.isAuthenticated()               // Returns boolean

// Subscribe to auth state changes
const unsubscribe = t2v.auth.onAuthStateChange((user) => {
  console.log(user ? 'Logged in' : 'Logged out');
});
unsubscribe(); // stop listening
```

#### `t2v.tools`

Register tool schemas with the server and provide local execution handlers.

```typescript
// Option A: inline execute function
await t2v.tools.register([
  {
    name: 'zoom_in',
    description: 'Zoom the viewport in',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      myApp.zoomIn();
      return JSON.stringify({ success: true });
    },
  },
]);

// Option B: separate handler registration
t2v.tools.handle('zoom_in', async () => {
  myApp.zoomIn();
  return JSON.stringify({ success: true });
});

await t2v.tools.register([
  {
    name: 'zoom_in',
    description: 'Zoom the viewport in',
    parameters: { type: 'object', properties: {} },
  },
]);

// Check state
t2v.tools.getRegistered()     // ClientToolSchema[]
t2v.tools.hasHandler('zoom_in') // boolean
```

#### `t2v.chat()`

Send a message and stream the response. Tool calls are executed automatically if handlers are registered.

```typescript
for await (const event of t2v.chat('Zoom in please')) {
  switch (event.type) {
    case 'text':
      // Incremental text chunk from the AI
      console.log(event.content);
      break;
    case 'tool_call':
      // A tool was called (already executed automatically)
      console.log(`Called ${event.toolName} with`, event.arguments);
      break;
    case 'done':
      // Stream complete
      console.log('Thread:', event.threadId);
      break;
    case 'error':
      console.error(event.message);
      break;
  }
}
```

#### `t2v.clearSession()`

Reset the current session. Clears the thread ID so the next `chat()` call starts a fresh conversation.

```typescript
t2v.clearSession();
```

#### `t2v.listModels()` / `t2v.listAudioModels()`

List available models:

```typescript
const models = await t2v.listModels();         // Chat/completion models
const audioModels = await t2v.listAudioModels(); // Speech-to-text models
```

#### `t2v.transcribe()`

Transcribe an audio file using the server's speech-to-text service:

```typescript
const result = await t2v.transcribe(audioBlob, 'whisper-1', 'en');
console.log(result.text);
```

#### `t2v.completions()`

Send a raw completions request (non-streaming):

```typescript
const response = await t2v.completions({
  messages: [{ role: 'user', content: 'Hello' }],
  model: 'gpt-4.1-mini',
});
```

#### `t2v.createSession()` / `t2v.getSession()`

For advanced use cases where you need direct session control:

```typescript
const session = await t2v.createSession();

// Send message and handle events manually
for await (const event of session.sendMessage('Hello')) {
  // ...
}

// Manual tool result submission
for await (const event of session.resumeToolCall(toolCallId, result)) {
  // ...
}
```

---

## Defining Tools

A tool needs a **schema** (so the AI knows when and how to call it) and an **execute function** (so your app can run it locally).

```typescript
import type { ClientTool } from '@talk2view/sdk';

const myTool: ClientTool = {
  name: 'set_window_level',
  description: 'Set the brightness and contrast of the medical image viewer',
  parameters: {
    type: 'object',
    properties: {
      windowWidth: {
        type: 'number',
        description: 'Contrast range (window width)',
      },
      windowCenter: {
        type: 'number',
        description: 'Brightness level (window center)',
      },
    },
    required: ['windowWidth', 'windowCenter'],
  },
  return_direct: false,  // Let the AI summarize the result (default)
  execute: async (args) => {
    viewer.setWindowLevel(args.windowWidth as number, args.windowCenter as number);
    return JSON.stringify({
      success: true,
      windowWidth: args.windowWidth,
      windowCenter: args.windowCenter,
    });
  },
};
```

### Tool Schema Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique tool identifier |
| `description` | `string` | Yes | What the tool does (the AI reads this) |
| `parameters` | `object` | Yes | JSON Schema for the tool's arguments |
| `parameters.properties` | `Record<string, { type, description }>` | Yes | Argument definitions |
| `parameters.required` | `string[]` | No | Required argument names |
| `return_direct` | `boolean` | No | Skip AI post-processing (default: `false`) |
| `execute` | `(args) => Promise<string>` | Yes* | Local execution handler |

*`execute` is required on `ClientTool`. If using `ClientToolSchema` with `t2v.tools.handle()`, provide the handler separately.

### Parameter Types

Supported `type` values in `parameters.properties`:

| Type | Maps to |
|------|---------|
| `'string'` | `string` |
| `'number'` | `number` |
| `'integer'` | `number` |
| `'boolean'` | `boolean` |
| `'array'` | `unknown[]` |
| `'object'` | `Record<string, unknown>` |

Use `enum` to restrict string values:
```typescript
{
  type: 'string',
  description: 'Image orientation',
  enum: ['axial', 'sagittal', 'coronal'],
}
```

### Execute Function

The `execute` function receives the AI's arguments as a `Record<string, unknown>` and must return a `Promise<string>`. The returned string is sent back to the AI as the tool's result.

- Return `JSON.stringify(...)` for structured results
- Throw an error or return an error string if the tool fails — the SDK catches errors and sends them back to the AI as `{ result: "Error: ...", is_error: true }`

---

## Token Storage

The SDK stores auth tokens in `localStorage` (keys prefixed with `talk2view_`). In private browsing or environments without `localStorage`, it falls back to in-memory storage automatically.

Stored keys:
- `talk2view_access_token`
- `talk2view_refresh_token`
- `talk2view_user`
- `talk2view_user_api_key`

On logout, all keys are cleared and a `talk2view_auth_cleared` event is dispatched on `window` for cross-component synchronization.

### Security Considerations

The SDK stores tokens in `localStorage` for persistence across page reloads. This is a deliberate trade-off — `localStorage` is accessible to any JavaScript running on the same origin, which means XSS vulnerabilities could expose tokens.

To mitigate this:

- **Use a Content Security Policy (CSP)** that restricts script sources to trusted origins
- **Keep token lifetimes short** — the SDK automatically refreshes tokens, so short-lived access tokens limit the window of exposure
- **Always serve your application over HTTPS**
- **Sanitize user-generated content** to prevent XSS injection

**CSRF protection:** The SDK sends a custom `X-T2V-Partner-Key` header on every request. Browsers block cross-origin requests with custom headers unless the server explicitly allows the origin via CORS. This makes CSRF attacks infeasible — a forged request from a malicious site would be blocked by the browser's preflight check.

---

## Error Handling

The SDK throws typed errors:

| Error Class | When |
|-------------|------|
| `AuthenticationError` | Invalid credentials, expired token |
| `PartnerKeyError` | Invalid or inactive partner API key |
| `SessionError` | Session not found or creation failed |
| `NetworkError` | Network failure, server unreachable |
| `T2VError` | Base class for all SDK errors |

All errors extend `T2VError`, which exposes `message`, `type`, `statusCode`, and `code`:

```typescript
import { T2VError, AuthenticationError, NetworkError, SessionError } from '@talk2view/sdk';

try {
  await t2v.auth.login(email, password);
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.log('Bad credentials');
  } else if (err instanceof NetworkError) {
    console.log('Server unreachable');
  } else if (err instanceof SessionError) {
    console.log('Session issue:', err.message);
  } else if (err instanceof T2VError) {
    // Access the error code for programmatic handling
    console.log(`Error [${err.code}]: ${err.message} (HTTP ${err.statusCode})`);
  }
}
```

**Rate limiting:** The server may return HTTP 429 when rate limits are exceeded. This surfaces as a `T2VError` with `statusCode: 429`. Rate limiting is enforced server-side; implement app-level retry logic if needed.

In React, the hooks catch errors internally and expose them via the `error` state:

```tsx
const { error, clearError } = useT2VAuth();
const { error: chatError } = useT2VChat({ systemPrompt: '...' });
// error is a string message, not a thrown exception
```

---

## Configuration

### `T2VConfig`

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `partnerKey` | `string` | Yes | — | Your partner API key |
| `baseUrl` | `string` | No | `'http://localhost:8100'` | Talk2View API server URL |
| `model` | `string` | No | Server default | LLM model to use |
| `requestTimeout` | `number` | No | `30000` | HTTP request timeout in ms. Does not apply to SSE streams after connection. |

---

## System Prompts

System prompts set the AI's behavior and context for your application. Pass them to `ChatPanel` or `useT2VChat`:

```tsx
<ChatPanel systemPrompt="You are a medical imaging assistant. Use the provided tools to control the DICOM viewer." />
```

Best practices:
- **Keep prompts concise** — every token in the system prompt is sent with every request and adds to cost
- **Focus on tools and context** — describe what tools are available and when to use them, rather than general personality traits
- **Be specific about your domain** — mention the application type and expected user intents
- **Avoid conflicting instructions** — the system prompt should complement, not contradict, tool descriptions

---

## Full Integration Example

Here's a complete example integrating Talk2View into a hypothetical drawing app:

```tsx
import React, { useRef, useMemo } from 'react';
import { T2VProvider, ChatPanel } from '@talk2view/sdk/react';
import type { ClientTool } from '@talk2view/sdk';
import { Canvas } from './Canvas';

function App() {
  const canvasRef = useRef<CanvasAPI>(null);

  const tools: ClientTool[] = useMemo(() => [
    {
      name: 'draw_circle',
      description: 'Draw a circle on the canvas',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
          radius: { type: 'number', description: 'Radius in pixels' },
          color: { type: 'string', description: 'Fill color' },
        },
        required: ['x', 'y', 'radius', 'color'],
      },
      execute: async (args) => {
        canvasRef.current!.drawCircle(
          args.x as number,
          args.y as number,
          args.radius as number,
          args.color as string,
        );
        return JSON.stringify({ success: true });
      },
    },
    {
      name: 'clear_canvas',
      description: 'Clear all drawings from the canvas',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        canvasRef.current!.clear();
        return JSON.stringify({ success: true });
      },
    },
    {
      name: 'get_canvas_info',
      description: 'Get the current canvas dimensions and number of shapes',
      parameters: { type: 'object', properties: {} },
      return_direct: true,
      execute: async () => {
        const info = canvasRef.current!.getInfo();
        return JSON.stringify(info);
      },
    },
  ], []);

  return (
    <T2VProvider partnerKey="pk_live_..." baseUrl="https://api.talk2view.com">
      <div style={{ display: 'flex', height: '100vh' }}>
        <Canvas ref={canvasRef} style={{ flex: 1 }} />
        <ChatPanel
          tools={tools}
          systemPrompt="You control a drawing canvas. Use the tools to draw shapes and manage the canvas."
          style={{ width: 360 }}
        />
      </div>
    </T2VProvider>
  );
}
```

---

## TypeScript

The SDK is written in TypeScript with strict mode. All types are exported:

```typescript
// Core types
import type {
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
} from '@talk2view/sdk';

// React types
import type {
  T2VProviderProps,
  UseT2VAuthResult,
  UseT2VChatResult,
  UseT2VToolsResult,
  DisplayMessage,
  ChatPanelProps,
  LoginModalProps,
} from '@talk2view/sdk/react';
```

## Publishing

The SDK is published to npm via the **Publish SDK** GitHub Actions workflow (`Actions → Publish SDK → Run workflow`).

### Prerequisites

- An `NPM_TOKEN` repository secret with publish access to `@talk2view/sdk` (Settings → Secrets → Actions)
- The workflow uses npm provenance signing (`--provenance`), which requires the `id-token: write` permission (already configured)

### Production Release

Use this when shipping a stable version to partners.

1. Go to **Actions → Publish SDK → Run workflow**
2. Set **Version bump type** to `patch`, `minor`, or `major`
3. Click **Run workflow**

What happens:
- Builds and typechecks the SDK
- Bumps `package.json` version (e.g. `0.2.0` → `0.2.1` for patch)
- Publishes to npm as `latest` tag
- Commits the version bump and creates a git tag `sdk-v0.2.1`
- Pushes the commit and tag to `main`

Partners running `npm install @talk2view/sdk` will get this version.

### Dev / Testing Release

Use this to publish a prerelease version for testing before a stable release.

1. Go to **Actions → Publish SDK → Run workflow**
2. Set **Version bump type** to `prerelease`
3. Set **Prerelease identifier** to `dev` (default), `beta`, or `rc`
4. Click **Run workflow**

What happens:
- Builds and typechecks the SDK
- Bumps version with preid (e.g. `0.2.0` → `0.2.1-dev.0`, or `0.2.1-dev.0` → `0.2.1-dev.1`)
- Publishes to npm with the preid as dist-tag (e.g. `--tag dev`)
- Does **not** commit, tag, or push to git (prerelease versions are ephemeral)

To install a dev release:
```bash
npm install @talk2view/sdk@dev
```

To install a specific prerelease version:
```bash
npm install @talk2view/sdk@0.2.1-dev.0
```

### Version Lifecycle Example

```
0.1.0 (current latest)
  ↓ prerelease (preid=dev)
0.1.1-dev.0 (tagged as "dev" on npm)
  ↓ prerelease (preid=dev)
0.1.1-dev.1
  ↓ prerelease (preid=beta)
0.1.1-beta.0 (tagged as "beta" on npm)
  ↓ minor (production release)
0.2.0 (tagged as "latest" on npm, git tagged sdk-v0.2.0)
```

### Manual Publishing (escape hatch)

If CI is down or you need to publish from your machine:

```bash
cd packages/sdk
npm run build
npm run typecheck
npm version prerelease --preid=dev --no-git-tag-version
npm publish --access public --tag dev
```

For a production release from local (not recommended):
```bash
npm version patch --no-git-tag-version
npm publish --access public
git add package.json
git commit -m "Release @talk2view/sdk v$(node -p "require('./package.json').version")"
git tag "sdk-v$(node -p "require('./package.json').version")"
git push origin main --tags
```

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
