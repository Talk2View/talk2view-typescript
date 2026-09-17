# @talk2view/sdk

Add AI-powered natural language control to any application. Talk2View's SDK handles authentication, tool registration, streaming chat, and the interrupt/resume cycle for client-side tool execution.

## Installation

```bash
npm install @talk2view/sdk
```

## Quick Start

### React (recommended)

```tsx
import { Talk2View, ChatPanel } from '@talk2view/sdk/ui';
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
    <Talk2View partnerKey="pk_live_..." tools={tools} systemPrompt="You control a canvas.">
      <ChatPanel />
    </Talk2View>
  );
}
```

That's it. `<Talk2View>` registers your tools and holds the chat state; `<ChatPanel>` is the UI — sign-in, streaming replies, tool calls and approvals. Both come from `@talk2view/sdk/ui`, and `<ChatPanel>` must be inside `<Talk2View>`.

A logged-out visitor gets an anonymous demo session automatically, so there is nothing to wire up before the first reply. Pass `allowAnonymous={false}` to `<ChatPanel>` to ask people to sign in first.

### Vanilla JavaScript

The package root exports a `Talk2View` **class** — the framework-agnostic client. It shares a name with the `<Talk2View>` provider component from `/ui` above; if you need both in one file, alias one of them.

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
let reply = '';
for await (const event of t2v.chat('What time is it?')) {
  if (event.type === 'text') reply += event.content;
  if (event.type === 'done') console.log(reply);
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

There are three React entry points, and they do different jobs:

- **`@talk2view/sdk/ui`** — the chat UI: `<Talk2View>`, `<ChatPanel>`, `<ChatWidget>` and the components they are built from. Start here.
- **`@talk2view/sdk/react`** — headless: `<T2VProvider>` and hooks, for building your own UI.
- **`@talk2view/sdk/assistant-ui`** — a runtime for [assistant-ui](https://www.assistant-ui.com): render the stock `<Thread />` on Talk2View. See [assistant-ui](#assistant-ui) below.

### `<Talk2View>` (from `/ui`)

The root provider for the UI components. It creates the client, registers your tools, injects the theme, and holds the chat state every `/ui` component reads.

```tsx
<Talk2View
  partnerKey="pk_live_..."          // Required
  tools={myTools}                    // Optional — ClientTool[] (with execute) or schemas
  systemPrompt="You are..."          // Optional — sent with every message
  baseUrl="https://engine.talk2view.com"  // Optional, this is the default
  model="gpt-4.1-mini"               // Optional, falls back to your partner default
  theme={{ accent: '#26C8B8' }}      // Optional
  debug={false}                      // Optional — log to the browser console
>
  {children}
</Talk2View>
```

### `<ChatPanel>` (from `/ui`)

The full chat surface: header, message list, composer, sign-in, tool approvals. It takes its client and state from `<Talk2View>`, so it must be rendered inside one — on its own it throws `useTalk2View must be used within <Talk2View>`. Note that `tools` and `systemPrompt` belong on `<Talk2View>`, not here.

```tsx
<ChatPanel
  welcome={{ heading: 'Ask about this document', suggestions: ['Summarise it'] }}
  allowAnonymous={true}          // Default. false = require sign-in before chatting
  signupUrl="https://..."        // Link shown on the sign-in form
  resetPasswordUrl="https://..." // Adds a "Forgot password?" link
  resetPasswordTarget="_blank"   // Default. '_self' opens in your own app
  describeToolActivity={(name, args) => (name === 'set_color' ? 'Recolouring' : null)}
  isToolDestructive={(name) => name.startsWith('delete_')}
  groupAssistantMessages={false}
/>
```

By default a logged-out visitor is signed into an anonymous demo session rather than being shown a login form. The sign-in form appears when `allowAnonymous` is `false`, when your partner account has anonymous access switched off or its daily cap is spent, or when the demo budget for that visitor runs out.

### `<LoginForm>` (from `/ui`)

The sign-in form on its own, if you want to place it yourself. It renders unconditionally — you decide when to show it (check `isAuthenticated` from `useTalk2View()`, the `/ui` hook).

```tsx
<LoginForm
  heading="Sign in"
  subheading="to keep your chat history"
  defaultMode="login"            // or 'signup'
  signupUrl="https://talk2view.com/auth?signup"
  resetPasswordUrl="https://..."
  termsUrl="https://..."
  privacyUrl="https://..."
/>
```

### `<T2VProvider>` (from `/react`)

The headless provider. Use it when you are building your own UI on the hooks below; `<Talk2View>` already includes it, so you never need both.

```tsx
<T2VProvider
  partnerKey="pk_live_..."   // Required
  baseUrl="https://engine.talk2view.com"  // Optional, this is the default
  model="gpt-4.1-mini"      // Optional, uses your partner default
>
  {children}
</T2VProvider>
```

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
  signup,            // (email, password) => Promise<{ user, confirmationRequired }>
  logout,            // () => Promise<void>
  clearError,        // () => void
  signInWithGoogle,  // () => Promise<void> — opens the Google sign-in popup
  signInWithApple,   // () => Promise<void> — opens the Apple sign-in popup
  oauthLoading,      // boolean — true while either popup is open
  oauthProvider,     // 'google' | 'apple' | null — which one
  oauthProviders,    // ('google' | 'apple')[] | null — popup sign-ins available on this website; null while loading
} = useT2VAuth();
```

`signup()` resolves to a `SignupOutcome`: `{ user: User | null; confirmationRequired: boolean }`. When your project has email confirmation switched on, `confirmationRequired` is `true` and `user` is `null` until the person clicks the link in their inbox.

Google and Apple sign-in open a popup and work on any `https://` website, with nothing to configure — your users have Talk2View accounts, and the sign-in form is the same in every app. Your publishable key is public, though, so on a website you have **not** registered your users first see a Talk2View screen naming the site that is asking, and press Continue. Add your site under **Settings → Allowed websites** in the dashboard (the exact `https://` address, nothing after the domain) and that screen goes away; the SDK logs one line to the console when it applies. If your account is set to allow only registered websites, `<LoginForm>` hides the two buttons elsewhere. Popup sign-in never runs on `localhost`; use email and password while developing.

### `useT2VChat()`

Chat state and message sending.

```tsx
const {
  messages,            // DisplayMessage[]
  isLoading,           // boolean — true while streaming
  error,               // string | null
  threadId,            // string | null
  agentStatus,         // { status: string; message: string } | null
  pendingApproval,     // PendingApproval | null — a tool call awaiting a decision
  alwaysAllowedTools,  // ReadonlySet<string> — approved for the rest of the session
  sendMessage,         // (content, { attachments? }) => Promise<void>
  approveToolCall,     // (decision: HumanDecision) => Promise<void>
  retryLastMessage,    // () => Promise<void> — only meaningful while error is set
  stop,                // () => void — ends the reply, keeps the text so far
  clearMessages,       // () => void
  clearError,          // () => void
} = useT2VChat({ systemPrompt: 'You are a helpful assistant.' });
```

When a tool is registered with `permission: true`, the agent pauses and `pendingApproval` fills in. Show it, then call `approveToolCall({ action: 'once' | 'always' | 'deny' })` — `'always'` adds the tool to `alwaysAllowedTools` for the rest of the session. `<ChatPanel>` already does all of this; you only need it when building your own UI.

`DisplayMessage` shape:
```typescript
{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean   // true while the assistant is still generating
  attachments?: Attachment[]  // files sent with a user message
  plan?: string           // markdown checklist from the agent's planning tool
  steps?: ToolStep[]      // completed tool calls, rendered as inline steps
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

## assistant-ui

assistant-ui already has a seam other backends plug into at the runtime level — `@assistant-ui/react-ai-sdk` for the Vercel AI SDK is the well-known example. `useTalk2ViewRuntime` is Talk2View's equivalent: it hands assistant-ui an `AssistantRuntime`, built on `useExternalStoreRuntime`, so the stock `<Thread />` (or the primitives) render Talk2View's messages, client tools, approvals and streaming — with no Talk2View-specific component in the tree.

This is a separate entry point from `/ui` and `/react`: `@assistant-ui/react` is an optional peer dependency, loaded only when you import `@talk2view/sdk/assistant-ui`. It never affects the root, `/react` or `/ui` bundles.

### Install

```bash
npm install @assistant-ui/react
npx shadcn@latest init --yes --defaults
npx shadcn@latest add @assistant-ui/thread --yes
```

The `shadcn` commands generate the Thread's source into your own `src/components/` — they're your files, not a Talk2View package, so you can restyle or extend them freely. See `examples/react-assistant-ui` for a full app built this way, including the exact generated output.

One known wrinkle in the registry output at the time of writing: `tooltip-icon-button.tsx` passes `delayDuration={0}` to a `TooltipProvider` whose prop is `delay`. It is inert at runtime, but it fails `tsc`, so if your build type-checks (most Vite templates run `tsc -b && vite build`) change it to `delay={0}` — the example does.

### `useTalk2ViewRuntime`

```tsx
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useTalk2ViewRuntime } from '@talk2view/sdk/assistant-ui';

function Chat() {
  const runtime = useTalk2ViewRuntime({ partnerKey: 'pk_live_...', tools });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

`useTalk2ViewRuntime(options)` takes the same connection options as `<T2VProvider>` (`partnerKey`, `baseUrl`, `model`, `debug`, `anonymousAutoStart`) plus `tools` and `systemPrompt`, and creates its own `Talk2View` client — a new one only when `partnerKey`, `baseUrl`, `debug` or `anonymousAutoStart` changes (`requestTimeout` is read once, at creation). `model` is sent with each message rather than baked into the client, so an end-user can switch models from a settings screen without losing the chat. `tools` are registered with the engine when their schemas change, compared by value, so an inline array is fine.

### `useTalk2ViewRuntimeForClient`

For an app that already has a `Talk2View` client — for example from `<T2VProvider>`, so auth and chat state stay shared with the rest of the app — pass it in instead of creating a second one:

```tsx
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useT2V } from '@talk2view/sdk/react';
import { useTalk2ViewRuntimeForClient } from '@talk2view/sdk/assistant-ui';

function Chat() {
  const { t2v } = useT2V(); // from <T2VProvider>
  const runtime = useTalk2ViewRuntimeForClient(t2v, { tools });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

### What maps to what

| assistant-ui | Talk2View SDK |
| --- | --- |
| Streaming replies | `DisplayMessage`s from `t2v.messages`, converted per-message by `toThreadMessage()` |
| Client tools | `tools` registers schemas via `t2v.tools.register()` and handlers via `t2v.tools.handle()` — same as `<Talk2View tools>` |
| Tool approvals | A `PendingApproval` becomes assistant-ui's own approval card (`allow-once` / `allow-always` / `reject-once`, plus a free-form reason); the decision is sent through `t2v.approveToolCall()` |
| Attachments | assistant-ui's `AttachmentAdapter` uploads through `t2v.uploadAttachment()` |
| Stop | assistant-ui's cancel action calls `t2v.stop()` — or, while a tool call is waiting for a decision, denies it with the reason "Cancelled by the user" |
| Retry | assistant-ui's reload action on the **latest turn** — its reply, or the error card when it failed — calls `t2v.retryLastMessage()`; on an older reply it does nothing, because the SDK can only regenerate the last turn |

Four things do not map, on purpose:

- **Editing tool arguments before approval.** The SDK supports it (`HumanDecision.updatedInput`, used by `<ApprovalCard>` in `/ui`), but the stock assistant-ui approval card has no edit-and-resubmit affordance to drive it from — it can only approve, deny, or attach a free-form reason.
- **Sign-in UI.** `useTalk2ViewRuntime` only creates a client and a runtime; there is no `<LoginForm>` equivalent. A logged-out visitor gets an anonymous demo session automatically (same default as `<ChatPanel>`), and building your own sign-in UI, or gating the app before it mounts, is on the partner.
- **The agent's plan.** The planning checklist `<ChatPanel>` shows arrives as a `data` part named `plan` (`{ markdown }`). The stock Thread has no renderer for it, so it is silently not shown; register one to see it: `<MessagePrimitive.Parts components={{ data: { by_name: { plan: PlanView } } }} />`.
- **Editing and deleting sent messages.** The runtime supplies no `onEdit`/`onDelete`, so the stock Thread's pencil on user messages stays disabled. Remove it from your copy of the Thread if you'd rather not show it.

### Bundle size

`<Thread />` and its dependencies are the partner's own assistant-ui bundle, sized however assistant-ui and its registry components size it; `@talk2view/sdk/assistant-ui` itself adds about 1.9 KB gzipped on top (`dist/assistant-ui/{index,convert}.js`, bundled and minified with esbuild, `react`, `react-dom`, `@assistant-ui/react` and the SDK's own `Talk2View` client marked external since a partner already has them).

---

## Core API (framework-agnostic)

### `Talk2View`

Main entry point. Use this directly for vanilla JS or non-React frameworks.

```typescript
const t2v = new Talk2View({
  partnerKey: 'pk_live_...',          // Required
  baseUrl: 'https://engine.talk2view.com', // Optional, this is the default
  model: 'gpt-4.1-mini',             // Optional
});
```

#### `t2v.auth`

```typescript
await t2v.auth.login(email, password)    // Returns User
await t2v.auth.signup(email, password)   // Returns { user, confirmationRequired }
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

#### `t2v.skills`

Register user-defined skills — knowledge documents the AI agent can discover and load for specialised expertise. Skills are stored client-side and sent to the server per-session.

```typescript
// Add skills locally
t2v.skills.add({
  name: 'radiology-workflow',
  description: 'Step-by-step radiology reading workflow',
  content: '## Radiology Reading Workflow\n1. Check study metadata\n2. Apply window/level\n...',
});

// Persist to localStorage
t2v.skills.save();

// Register with server (call after session is created)
await t2v.skills.register(t2v.skills.getAll());

// On next page load, restore from localStorage
t2v.skills.load();

// Manage skills
t2v.skills.remove('radiology-workflow');
t2v.skills.getAll();   // UserSkill[]
t2v.skills.clear();    // Remove all
```

Skills merge with partner-defined and built-in skills. User skills take highest priority. See [Skills documentation](../../docs/skills.md) for details.

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

#### `t2v.warmUp()`

A new end-user's first AI call is slower than the rest: the engine sets up their
account with the model proxy on first use, which takes a few seconds. Call
`warmUp()` at the first sign they are going to use the chat — their first
keystroke, a tap on the mic — and that setup happens while they are still typing.

```ts
input.addEventListener('input', () => t2v.warmUp(), { once: true });
```

It is safe to call repeatedly (one request per signed-in end-user), never
throws, and is a no-op against an engine that predates it. Don't call it when
the chat merely opens: for a logged-out visitor it starts an anonymous session,
which counts toward your daily anonymous cap.

`<ChatWidget>`, `<ChatPanel>` and the assistant-ui runtime already do this.

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

Takes a `FormData`, with the fields the engine's `/v1/audio/transcriptions` endpoint accepts (`file`, `model`, and optionally `language`, `translate_to`, `translation_guidance`):

```typescript
const form = new FormData();
form.append('file', audioBlob, 'recording.webm');
form.append('model', 'faster-whisper-large-turbo-gcp'); // one of listAudioModels()
form.append('language', 'en');        // optional

const result = await t2v.transcribe(form);
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
- Throw an error or return an error string if the tool fails — the SDK catches it and sends the message back to the AI as `{ result: '{"error":"..."}', is_error: true }`, so the agent can explain or try something else

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

## Rendering model replies

Treat every model reply as untrusted. Prompt injection through web search, documents, email or tool results can make the model write anything. `<ChatPanel>` renders replies as markdown only, and never loads remote content on its own:

- **Raw HTML** in a reply is shown as text, apart from a bare `<br>`, which is kept so a GFM table cell can break a line (a cell can't hold a literal newline).
- **Images** become links (`Image: <alt> (<host>)`) that the end-user can choose to open.
- **Links** open in a new tab with `noopener noreferrer`, and only `http(s)` and `mailto` link destinations are kept.

If you build your own chat UI, render replies the same way:

```tsx
import { renderSafeMarkdown } from '@talk2view/sdk/ui';

<div dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(reply) }} />
```

Never pass model output to `innerHTML` or a markdown library's raw HTML output without it.

Call it in the browser (client components): without a DOM it returns the reply as escaped plain text.

## Chat sessions and deploys

A chat session lives in the engine's memory, so a Talk2View deploy, a restart, or eviction under load can end it. The SDK handles most of that for you:

- **Sending a message:** if the session is gone before the reply has started, the SDK opens a new one, re-registers your tools and resends the turn with the conversation so far — nothing from that turn is lost. It emits `sessionRecovered` with the new session id, which you can log.
- **Answering an approval:** the SDK can't safely resend the tool result, because your handler has already run. It emits one `error` event with `errorType: 'session_lost'` and clears the pending approval, so the end-user can send their message again.
- **Mid-reply or mid-tool-resume:** if the chat session is lost after the reply has started, or while a tool result is being sent back, the SDK reports `session_lost` and doesn't resend, because the tool handler may already have run.

```ts
t2v.on('sessionRecovered', (sessionId) => console.info('reconnected', sessionId));
```

This is why `sendMessage()` and `chat()` take the conversation history: the engine works out which messages are new, so a fresh session continues where the old one stopped.

## Error Handling

The SDK throws typed errors:

| Error Class | When | `err.type` |
|-------------|------|------------|
| `AuthenticationError` | Bad credentials, expired or rejected token | `authentication_error` |
| `PartnerKeyError` | Unknown or inactive partner key | `partner_key_error` |
| `NetworkError` | Network failure, server unreachable, request timed out | `network_error` |
| `T2VError` | Base class — and what everything else arrives as | the engine's own type |
| `SessionError` | Reserved — see below | `session_not_found` |

Every error carries the engine's machine-readable `type`, so `err.type` is the precise test; the classes above are a convenience for the common cases. Types worth knowing that arrive as a plain `T2VError`: `origin_not_allowed` (403 — the request's Origin isn't on your key's allow-list), `not_found` (404), and `rate_limit_exceeded` (429).

Some failures never reach a `catch` at all, because they arrive inside the chat stream rather than as a rejected request: a spent anonymous demo budget comes through as an `error` event with `errorType: 'budget_exceeded'`, which the SDK turns into a `demoLimitReached` event rather than an error state. Listen for that instead of trying to catch it.

**On lost chat sessions:** `SessionError` is reserved for a dedicated engine type that isn't in use yet — today a chat session that no longer exists comes back as a `T2VError` with `type: 'not_found'` and `statusCode: 404`. You shouldn't need to catch it: the SDK recovers the session itself where that is safe, and otherwise reports an `error` event with `errorType: 'session_lost'`. See [Chat sessions and deploys](#chat-sessions-and-deploys).

All errors extend `T2VError`, which exposes `message`, `type`, `statusCode`, `code`, and `detail` (the server's raw diagnostic text, kept out of `message` so it never reaches an end-user by accident):

```typescript
import { T2VError, AuthenticationError, NetworkError, PartnerKeyError } from '@talk2view/sdk';

try {
  await t2v.auth.login(email, password);
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.log('Bad credentials');
  } else if (err instanceof NetworkError) {
    console.log('Server unreachable');
  } else if (err instanceof PartnerKeyError) {
    console.log('Check your partner key:', err.message);
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
| `baseUrl` | `string` | No | `'https://engine.talk2view.com'` | Talk2View engine URL |
| `model` | `string` | No | Server default | LLM model to use |
| `requestTimeout` | `number` | No | `30000` | HTTP request timeout in ms. Does not apply to SSE streams after connection. |
| `anonymousAutoStart` | `boolean` | No | `true` | Start an anonymous demo session on the first `chat()` when nobody is signed in. Set `false` to require sign-in. |
| `debug` | `boolean` | No | `false` | Log streaming events, tool calls, history and state changes to the console. |

---

## System Prompts

System prompts set the AI's behavior and context for your application. Pass one to `<Talk2View>` (the UI components) or to `useT2VChat` (the hooks):

```tsx
<Talk2View
  partnerKey="pk_live_..."
  systemPrompt="You are a medical imaging assistant. Use the provided tools to control the DICOM viewer."
>
  <ChatPanel />
</Talk2View>
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
import { Talk2View, ChatPanel } from '@talk2view/sdk/ui';
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
    <Talk2View
      partnerKey="pk_live_..."
      tools={tools}
      systemPrompt="You control a drawing canvas. Use the tools to draw shapes and manage the canvas."
    >
      <div style={{ display: 'flex', height: '100vh' }}>
        <Canvas ref={canvasRef} style={{ flex: 1 }} />
        <div style={{ width: 360 }}>
          <ChatPanel welcome={{ heading: 'What should I draw?' }} />
        </div>
      </div>
    </Talk2View>
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
  UserSkill,
  RegisterSkillsResponse,
} from '@talk2view/sdk';

// Headless React types
import type {
  T2VProviderProps,
  UseT2VAuthResult,
  UseT2VChatResult,
  UseT2VToolsResult,
  UsePartnerConfigResult,
  UseUserPreferencesResult,
  DisplayMessage,
  ToolStep,
  PendingApproval,
} from '@talk2view/sdk/react';

// UI component types
import type {
  Talk2ViewProps,
  ChatPanelProps,
  ChatWidgetProps,
} from '@talk2view/sdk/ui';

// assistant-ui runtime
import { useTalk2ViewRuntime, useTalk2ViewRuntimeForClient } from '@talk2view/sdk/assistant-ui';
import type {
  UseTalk2ViewRuntimeOptions, // useTalk2ViewRuntime(options)
  Talk2ViewRuntimeOptions,    // useTalk2ViewRuntimeForClient(t2v, options)
} from '@talk2view/sdk/assistant-ui';
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
