# Plan: Wrap assistant-ui into Talk2View SDK

## Context

The Talk2View SDK (`packages/sdk`) currently has custom-built chat UI components (ChatPanel, ChatMessage, ChatInput, ApprovalCard, LoginModal, SettingsView) that became messy to maintain. The goal is to replace these with assistant-ui — a production-grade, composable React chat component library — while keeping the SDK's core logic (auth, client, sessions, tools, streaming) untouched.

This gives partner developers a polished chat UI with minimal setup while Talk2View manages all AI infrastructure via its existing API.

---

## How assistant-ui Connects to Talk2View

assistant-ui is **frontend-only** — it does NOT connect to AI models or LangChain/LangGraph. It uses a "runtime" abstraction layer:

```
assistant-ui (renders UI)
    ↓ ExternalStoreRuntime bridge
useT2VChat hook (manages state, streaming)
    ↓ existing SDK client
Talk2View API (engine.talk2view.com)
    ↓ server-side
LangGraph agent → LiteLLM → LLM providers
```

assistant-ui is purely the rendering layer. The existing SDK core (`T2VClient`, `T2VSession`, SSE streaming) still handles all communication with the Talk2View server. The `ExternalStoreRuntime` reads message state from `useT2VChat` and feeds it to assistant-ui's components for display.

---

## Approach: ExternalStoreRuntime

**Why ExternalStoreRuntime over LocalRuntime:**

Talk2View's server uses an interrupt/resume SSE pattern — the stream pauses at tool calls, the client executes locally, then POSTs to `/resume` to continue. This doesn't map cleanly to assistant-ui's `LocalRuntime.run()` which expects tool results appended to message history in subsequent calls.

ExternalStoreRuntime lets us keep the proven `useT2VChat` hook as the state manager and use assistant-ui purely as a rendering layer. Zero disruption to the working streaming/tool/approval logic.

---

## Architecture

```
@talk2view/sdk                    (unchanged — core SDK)
@talk2view/sdk/react              (unchanged — existing React layer)
@talk2view/sdk/assistant-ui       (NEW — assistant-ui integration)
```

New files in `packages/sdk/src/assistant-ui/`:

| File | Purpose |
|------|---------|
| `index.ts` | Public exports |
| `T2VAssistantProvider.tsx` | Combined provider (T2VProvider + AssistantRuntimeProvider) |
| `useT2VRuntime.ts` | ExternalStoreRuntime bridge — feeds `useT2VChat` state to assistant-ui |
| `convertMessage.ts` | `DisplayMessage` → `ThreadMessageLike` converter |
| `T2VThread.tsx` | Pre-configured Thread with T2V auth gate + settings |
| `T2VAssistantModal.tsx` | Floating chat widget (AssistantModal variant) |
| `T2VApprovalToolUI.tsx` | `makeAssistantToolUI` wrapping existing ApprovalCard for HITL |
| `T2VLoginGate.tsx` | Shows LoginModal when unauthenticated, children when authenticated |
| `tailwind-preset.ts` | Tailwind preset for SDK consumers (includes assistant-ui plugin + T2V theme) |

---

## Developer Experience (end result)

**Inline thread:**
```tsx
import { T2VAssistantProvider, T2VThread } from '@talk2view/sdk/assistant-ui';

function App() {
  return (
    <T2VAssistantProvider partnerKey="pk_live_abc" tools={myTools}>
      <MyExistingApp />
      <T2VThread />
    </T2VAssistantProvider>
  );
}
```

**Floating chat widget:**
```tsx
import { T2VAssistantProvider, T2VAssistantModal } from '@talk2view/sdk/assistant-ui';

function App() {
  return (
    <T2VAssistantProvider partnerKey="pk_live_abc" tools={myTools}>
      <MyExistingApp />
      <T2VAssistantModal />
    </T2VAssistantProvider>
  );
}
```

**Power users** who want full control can use the runtime hook directly with their own assistant-ui components:
```tsx
import { useT2VRuntime } from '@talk2view/sdk/assistant-ui';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Thread } from '@assistant-ui/react-ui';

function CustomChat() {
  const runtime = useT2VRuntime({ systemPrompt: '...' });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

---

## Implementation Steps

### Step 1: Message Format Bridge (`convertMessage.ts`)

Convert `DisplayMessage` (from `useT2VChat`) → `ThreadMessageLike` (assistant-ui format):

- `role` maps directly
- `content` (string) → `[{ type: "text", text }]`
- `steps` (tool steps) → `tool-call` content parts with `result` and status
- `plan` → additional text content part or custom attachment
- `isStreaming` → `status: { type: "running" }` vs `{ type: "complete" }`
- When `pendingApproval` exists, project it as a `tool-call` content part with `status.type === "requires-action"` on the current assistant message

**Key files:** `src/react/useT2VChat.ts` (DisplayMessage, ToolStep types)

### Step 2: ExternalStoreRuntime Bridge (`useT2VRuntime.ts`)

Central bridge hook: `function useT2VRuntime(options?) → AssistantRuntime`

Internally:
1. Calls `useT2VChat(options)` for messages, isLoading, sendMessage, etc.
2. Calls `useExternalStoreRuntime()` with:
   - `messages`: DisplayMessage[] converted via Step 1
   - `isRunning`: `isLoading && !pendingApproval`
   - `onNew`: extracts text from AppendMessage, calls `sendMessage(text)`
   - `onReload`: calls `retryLastMessage()`
   - `onAddToolResult`: bridges approval decisions — when approval card calls `addResult()`, decode the `HumanDecision` and call `approveToolCall(decision)`

**Key files:** `src/react/useT2VChat.ts`, `@assistant-ui/react` (useExternalStoreRuntime)

### Step 3: Approval Card as Tool UI (`T2VApprovalToolUI.tsx`)

Use `makeAssistantToolUI` to render the existing `ApprovalCard` component inline when `status.type === "requires-action"`.

- Register dynamically based on current `pendingApproval` tool name
- Wire `ApprovalCard.onDecision` → `addResult()` with encoded `HumanDecision`
- Preserves the full once/always/deny + editable arguments flow

**Key files:** `src/react/ApprovalCard.tsx` (reuse directly)

### Step 4: Auth Gate (`T2VLoginGate.tsx`)

Thin wrapper: shows `LoginModal` when unauthenticated, renders children when authenticated.

```tsx
function T2VLoginGate({ children, signupUrl }) {
  const { isAuthenticated } = useT2VAuth();
  if (!isAuthenticated) return <LoginModal signupUrl={signupUrl} />;
  return <>{children}</>;
}
```

**Key files:** `src/react/LoginModal.tsx` (reuse directly), `src/react/useT2VAuth.ts`

### Step 5: Combined Provider (`T2VAssistantProvider.tsx`)

Composes:
1. `T2VProvider` (existing) — provides Talk2View client
2. Inner provider — registers tools via `useT2VTools`, creates runtime via `useT2VRuntime`
3. `AssistantRuntimeProvider` (assistant-ui) — provides runtime to assistant-ui components
4. `T2VLoginGate` — auth gate
5. Approval tool UI registration from Step 3

Props: `partnerKey`, `baseUrl?`, `model?`, `systemPrompt?`, `tools?`, `signupUrl?`, `children`

**Key files:** `src/react/T2VProvider.tsx`, `src/react/useT2VTools.ts`

### Step 6: Pre-styled Thread & Modal (`T2VThread.tsx`, `T2VAssistantModal.tsx`)

Use assistant-ui's styled `Thread` and `AssistantModal` components from `@assistant-ui/react-ui`. These require Tailwind CSS (see Tailwind section below).

`T2VThread`: Wraps `Thread` with:
- T2V-branded welcome message
- Settings button in header (opens existing `SettingsView`)
- "New chat" button wired to `clearMessages()`
- Custom markdown rendering using existing `marked + DOMPurify` setup

`T2VAssistantModal`: Wraps `AssistantModal` with same customizations + T2V-branded trigger button.

**Key files:** `src/react/SettingsView.tsx` (reuse), `src/react/theme.ts` (brand tokens)

### Step 7: Tailwind Preset (`tailwind-preset.ts`)

Provide a Tailwind preset that SDK consumers add to their `tailwind.config`:

```js
// tailwind.config.js
import { t2vPreset } from '@talk2view/sdk/assistant-ui';

export default {
  presets: [t2vPreset],
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@talk2view/sdk/dist/assistant-ui/**/*.js',
    './node_modules/@assistant-ui/react-ui/dist/**/*.js',
  ],
}
```

The preset includes:
- assistant-ui's required Tailwind plugin
- T2V brand colors mapped to assistant-ui's CSS variable theme
- Content paths for purging

### Step 8: Package Configuration

**New exports in `package.json`:**
```json
"./assistant-ui": {
  "types": "./dist/assistant-ui/index.d.ts",
  "import": "./dist/assistant-ui/index.js"
}
```

**New peer dependencies (optional):**
```json
"@assistant-ui/react": "^0.8.0",
"@assistant-ui/react-ui": "^0.1.0"
```

Both optional — only needed if using `@talk2view/sdk/assistant-ui`. Core SDK and `@talk2view/sdk/react` remain completely unaffected.

### Step 9: Update Examples

Update `examples/react-basic` (or create `examples/react-assistant-ui`) showing the new integration with both Thread and AssistantModal patterns.

---

## Tailwind CSS Requirement

assistant-ui's styled components (`@assistant-ui/react-ui`) require Tailwind. This is a deliberate trade-off:

**Why accept this:** Most modern React apps already use Tailwind. It gives us the full production-grade UI from assistant-ui (markdown rendering, auto-scroll, animations, responsive design, accessibility) without rebuilding it. The alternative — using headless primitives with inline styles — defeats the purpose of adopting assistant-ui and would be as much work as the current custom UI.

**Mitigation:** The existing `@talk2view/sdk/react` export (custom UI, no Tailwind) remains fully functional. Developers without Tailwind can keep using it. The assistant-ui integration is opt-in via a separate import path.

---

## What Stays Unchanged

- **Core SDK** (`src/index.ts`, `auth.ts`, `client.ts`, `sessions.ts`, `tools.ts`, `skills.ts`, `streaming.ts`, `types.ts`, `errors.ts`, `storage.ts`) — zero changes
- **Existing React layer** (`src/react/*`) — zero changes, remains the non-Tailwind option
- **Server** (`packages/server`) — zero changes, existing SSE API works as-is

---

## Verification

1. **Unit test** `convertMessage.ts` — verify all DisplayMessage variants map correctly
2. **Integration test** — mount `<T2VAssistantProvider>` + `<T2VThread>`, verify:
   - Login gate shows when unauthenticated
   - Messages stream and render after auth
   - Tool calls trigger approval card inline
   - Once/always/deny decisions work
   - "New chat" clears session
3. **Visual test** — run the example app, verify:
   - Thread renders with T2V branding
   - AssistantModal floating widget opens/closes
   - Markdown, code blocks, and plan steps render correctly
4. **Existing tests pass** — `npm test` in `packages/sdk` still green (no regressions)
5. **Build** — `npm run build` produces all three export paths cleanly
