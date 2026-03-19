# SDK Architecture

## Overview

The Talk2View SDK is a TypeScript client library with three export paths:

```
@talk2view/sdk          → Core SDK (no React dependency)
@talk2view/sdk/react    → Headless React hooks (no UI, no Tailwind)
@talk2view/sdk/ui       → Full UI (assistant-ui powered, requires Tailwind)
```

## Directory Structure

```
src/
├── index.ts                    Core SDK entry — Talk2View class
├── auth.ts                     T2VAuth — login, signup, logout, token management
├── client.ts                   T2VClient — HTTP/SSE with two-tier auth, auto-refresh
├── sessions.ts                 T2VSession — chat sessions, streaming, tool interrupts
├── tools.ts                    T2VTools — tool registration, execution, permissions
├── skills.ts                   T2VSkills — knowledge document registration
├── streaming.ts                SSE stream decoder
├── storage.ts                  localStorage with in-memory fallback
├── errors.ts                   Error classes (T2VError, AuthenticationError, etc.)
├── types.ts                    Shared TypeScript type definitions
│
├── react/                      Headless React layer
│   ├── index.ts                Exports hooks + utilities only
│   ├── T2VProvider.tsx         React context provider for Talk2View client
│   ├── useT2VChat.ts           Chat state engine (messages, streaming, tool approval)
│   ├── useT2VAuth.ts           Authentication hook
│   ├── useT2VTools.ts          Tool registration hook
│   ├── useUserPreferences.ts   User preferences (model, STT, font size)
│   ├── usePartnerConfig.ts     Partner-level config defaults from /v1/config
│   └── theme.ts                Brand tokens, CSS variables, font/style injectors
│
└── ui/                         Full UI layer (assistant-ui integration)
    ├── index.ts                Public exports
    ├── runtime/                Bridge between Talk2View and assistant-ui
    │   ├── useT2VRuntime.ts    ExternalStoreRuntime hook
    │   └── convertMessage.ts   DisplayMessage → ThreadMessageLike converter
    ├── components/             React components
    │   ├── T2VAssistantProvider.tsx   Combined provider
    │   ├── T2VThread.tsx              Inline chat thread
    │   ├── T2VAssistantModal.tsx      Floating chat widget
    │   ├── T2VChatHeader.tsx          Header bar (shared)
    │   ├── T2VComposer.tsx            Composer with mic button
    │   ├── T2VToolFallback.tsx        Tool call approval + step indicators
    │   ├── T2VLoginGate.tsx           Auth gate
    │   ├── T2VDictationAdapter.ts     MediaRecorder STT adapter
    │   ├── LoginModal.tsx             Login form
    │   └── SettingsView.tsx           Settings panel
    └── themes/
        └── tailwind-preset.ts         Tailwind config for consumers
```

## Layer Architecture

```
┌─────────────────────────────────────────────────┐
│  Layer 1: @assistant-ui/react (npm dependency)  │
│  Runtime, hooks, primitives — never modified    │
│  Update: npm update                             │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│  Layer 2: src/ui/ (Talk2View integration)       │
│  Runtime bridge, custom components, theme       │
│  Never conflicts with upstream updates          │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│  Layer 3: src/react/ (headless hooks)           │
│  Chat state, auth, tools — the SDK core logic   │
│  Zero dependency on assistant-ui                │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│  Layer 4: src/ core (Talk2View client)          │
│  HTTP client, sessions, streaming, types        │
│  Zero dependency on React                       │
└─────────────────────────────────────────────────┘
```

## Data Flow

```
User types message in assistant-ui Composer
  ↓ onNew(AppendMessage)
useT2VRuntime extracts text
  ↓ chat.sendMessage(text)
useT2VChat → Talk2View.chat()
  ↓ POST /v1/sessions/{id}/messages
T2VSession.sendMessage() streams SSE
  ↓ ChatEvent stream
useT2VChat updates DisplayMessage[]
  ↓ state change
useT2VRuntime.convertMessage() maps to ThreadMessageLike[]
  ↓ ExternalStoreRuntime
assistant-ui Thread renders messages
```

### Tool Approval Flow (HITL)

```
Server sends tool_call interrupt via SSE
  ↓ ChatEvent { type: 'approval_required' }
useT2VChat sets pendingApproval state
  ↓ convertMessage maps to tool-call part with status: requires-action
T2VToolFallback renders inline approval card
  ↓ User clicks Allow Once / Always / Deny
addResult(HumanDecision)
  ↓ onAddToolResult({ result })
useT2VRuntime calls chat.approveToolCall(decision)
  ↓ POST /v1/sessions/{id}/resume
Stream resumes with tool result
```

### Voice Input Flow (STT)

```
User clicks mic button in T2VComposer
  ↓ getUserMedia()
MediaRecorder records audio
  ↓ User clicks stop
Audio blob sent to t2v.transcribe()
  ↓ POST /v1/audio/transcriptions
Transcript inserted into composer via runtime.thread.composer.setText()
  ↓ composer.send()
Message sent automatically
```

## Provider Composition

`T2VAssistantProvider` composes these providers in order:

```
T2VProvider (auth, client context)
  └── InnerProvider
        ├── injectT2VFonts() + injectT2VStyles()  — CSS animations
        ├── useT2VRuntime() — creates ExternalStoreRuntime
        ├── useT2VTools() — auto-registers tools when authenticated
        ├── useUserPreferences() — syncs model preference
        ├── usePartnerConfig() — fetches partner defaults
        └── AssistantRuntimeProvider (provides runtime to assistant-ui)
              └── children (T2VThread, T2VAssistantModal, etc.)
```

## Model Selection Priority

When sending a message, the model is resolved in this order:

1. **User preference** — `preferences.model` from `useUserPreferences` (localStorage)
2. **Partner default** — `partnerConfig.default_llm_model` from `/v1/config`
3. **Provider prop** — `model` prop on `T2VAssistantProvider` / `T2VProvider`
4. **Server default** — `T2V_DEFAULT_MODEL` env var on the server

## Key Design Decisions

### Why ExternalStoreRuntime (not LocalRuntime)
Talk2View's interrupt/resume pattern (stream pauses at tool call, client POSTs to `/resume`) doesn't fit LocalRuntime's `run()` model. ExternalStoreRuntime lets `useT2VChat` own all state while assistant-ui purely renders.

### Why not DictationAdapter for STT
The `DictationAdapter` interface is designed for streaming speech recognition (Web Speech API). Talk2View's STT is batch (record → upload → transcribe). The adapter layer added complexity without benefit. The mic button handles recording and transcription directly in-component.

### Why duplicate LoginModal / SettingsView in ui/
These components import from `../../react/theme`, `../../react/useT2VAuth`, etc. Having them in `ui/components/` with correct relative imports avoids circular dependencies. The `react/` directory no longer contains UI components.

### CSS Strategy
- assistant-ui components use `--aui-*` CSS variables (themed via `@assistant-ui/react-ui/styles/themes/default.css`)
- Talk2View components use inline styles referencing `--aui-*` variables where possible, falling back to `T2V_COLORS` constants
- The Tailwind preset (`t2vPreset`) provides brand colors for consumer apps
- Modal button styling is done via CSS overrides in the consumer's stylesheet (not in the SDK)
