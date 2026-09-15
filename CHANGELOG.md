# Changelog

## [Unreleased] — assistant-ui Integration

### Changed

- **A partner can refuse anonymous sign-in.** Anonymous access is now a partner
  setting with a daily anonymous cap. When `POST /v1/auth/anonymous` refuses
  (`anonymous_access_disabled`, `anonymous_daily_cap_reached`, or a captcha the
  client didn't send), `chat()` no longer carries on into a 401: it emits
  `anonymousUnavailable` with the reason and sends nothing, and `<ChatPanel>`
  shows its sign-in form. The message is retried once the visitor signs in.
  `uploadAttachment()` throws `sign_in_required` in the same case.

### Fixed

- **Anonymous → permanent conversion now re-authenticates.** `signup()` on
  an anonymous session called `/v1/auth/convert` but kept the old anonymous
  tokens. Setting a password during conversion revokes that session's
  refresh token server-side (Supabase rotates tokens on credential change),
  so the kept token was stale and the next refresh 401'd — the account
  silently broke ~an hour after signup. `signup()` now follows convert with
  a `login()` to obtain a fresh session (same `user_id` → history kept).

### Added

#### New export path: `@talk2view/sdk/ui`
Pre-styled chat UI powered by [assistant-ui](https://github.com/assistant-ui/assistant-ui). Requires Tailwind CSS + assistant-ui peer dependencies.

**Components:**
- `T2VAssistantProvider` — Combined provider (auth + client + tools + runtime + AssistantRuntimeProvider)
- `T2VThread` — Inline chat thread with header, settings, login gate, and font scaling
- `T2VAssistantModal` — Floating chat widget (bottom-right trigger button + popover)
- `T2VLoginGate` — Shows login form when unauthenticated, renders children when authenticated
- `T2VToolFallback` — Inline tool call UI: approval card (requires-action) + step indicators (completed)
- `T2VComposer` — Custom Composer with mic button for speech-to-text via Talk2View's STT endpoint
- `T2VChatHeader` — Shared header bar with logo, settings dropdown, and sign-out

**Hooks:**
- `useT2VRuntime` — ExternalStoreRuntime bridge between `useT2VChat` and assistant-ui

**Adapters:**
- `T2VDictationAdapter` — MediaRecorder-based adapter implementing assistant-ui's DictationAdapter interface

**Utilities:**
- `convertDisplayMessage` — Converts `DisplayMessage` → `ThreadMessageLike` (assistant-ui format)
- `t2vPreset` — Tailwind CSS preset with Talk2View brand colors and fonts

#### New peer dependencies (all optional)
- `@assistant-ui/react@^0.12.19`
- `@assistant-ui/react-ui@^0.2.1`
- `@assistant-ui/react-markdown@^0.12.6`

#### Core SDK additions
- `useT2VChat` now accepts `model` option to override the LLM model per-session
- `Talk2View.chat()` and `T2VSession.sendMessage()` accept `model` option
- Model priority chain: user preference > partner default > provider prop > server default
- `SettingsView` accepts `hideHeader` prop for embedding in containers with their own header

### Changed

#### `@talk2view/sdk/react` is now headless hooks only
- Removed `ChatPanel`, `ChatMessage`, `ChatInput` UI components
- Removed `ApprovalCard`, `LoginModal`, `SettingsView` (moved to `@talk2view/sdk/ui`)
- Retains: `T2VProvider`, `useT2V`, `useT2VChat`, `useT2VAuth`, `useT2VTools`, `useUserPreferences`, `usePartnerConfig`, `T2V_VARS`, `theme`

#### Server config
- `T2V_PROXY_SERVER_BASE_URL` updated from `t2v4-staging.talk2view.com` to `llm.talk2view.com`

### Removed
- `ChatPanel` — replaced by `T2VThread` / `T2VAssistantModal`
- `ChatMessage` — assistant-ui handles message rendering
- `ChatInput` — assistant-ui Composer handles input
- `ApprovalCard` (standalone) — functionality inlined into `T2VToolFallback`

---

## Modifications on top of assistant-ui

The SDK uses assistant-ui as a rendering layer via `ExternalStoreRuntime`. The following customizations were made on top of the stock assistant-ui components:

### Runtime bridge (`useT2VRuntime`)
- Uses `useExternalStoreRuntime()` to feed `useT2VChat` state into assistant-ui
- `convertMessage` maps `DisplayMessage` → `ThreadMessageLike` (text, plan, tool steps, pending approvals, errors)
- `onNew` extracts text from `AppendMessage` and calls `sendMessage()`
- `onReload` calls `retryLastMessage()`
- `onAddToolResult` decodes `HumanDecision` and calls `approveToolCall()`
- `adapters.dictation` wired to `T2VDictationAdapter` for STT

### Custom Composer (`T2VComposer`)
- Wraps assistant-ui's `Composer.Root`, `Composer.Input`, `Composer.Action` (no CSS overrides)
- Adds a mic button between Input and Action
- Mic button records audio via `MediaRecorder`, sends to `/v1/audio/transcriptions`, inserts transcript and auto-sends
- Shows spinner during transcription
- Uses Talk2View brand color (`#40D4B6`) for the mic button background

### Tool call rendering (`T2VToolFallback`)
- Registered as `assistantMessage.components.ToolFallback` on Thread config
- `requires-action` status → inline approval card with Allow Once / Allow Always / Deny + editable JSON args
- `complete` status → compact step indicator with check/x circle icon
- Styled with `--aui-*` CSS variables to match assistant-ui's theme

### Modal trigger (`T2VAssistantModal`)
- Uses `AssistantModal.Trigger` with custom children (T2V logo + chevron)
- Logo/chevron toggle via CSS descendant selectors on parent `data-state`
- Transparent background when closed, dark circle when open
- Responsive sizing via `clamp(3.5rem, 5vw, 5rem)`

### Thread wrapper (`T2VThread` / `T2VAssistantModal`)
- Adds `T2VChatHeader` above the Thread (logo, settings dropdown, sign out)
- Shows `LoginModal` when unauthenticated
- Shows `SettingsView` when settings is opened (hides Thread)
- Applies font scale from user preferences
- Syncs model selection: user pref > partner default > provider prop

### CSS overrides (in example app's `app.css`, not in SDK)
- `.aui-modal-anchor` — responsive button size
- `.aui-modal-button[data-state]` — transparent bg when closed
- `.t2v-modal-logo` / `.t2v-modal-chevron` — show/hide transitions
- `.aui-modal-content` — 70vh height
