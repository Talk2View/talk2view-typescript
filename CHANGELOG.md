# Changelog

## [Unreleased]

### Fixed

- **The approval card no longer attributes the tool's own description to the assistant.** That line is `tools.getDescription(name)` — the text an integrator writes for the model — not anything the agent composed. Labelling it "The assistant says:" dressed first-party documentation up as untrusted model output, which is the more misleading direction to get it wrong in.
- **…and it no longer pushes the decision off the screen.** A tool description is written for a model, so it can run to a paragraph: in a 320px task pane an unclamped one put the destructive-tool warning and the allow/deny buttons below the fold. It is clamped to three lines now, with the full text kept in the DOM for a screen reader and in `title` for a pointer.
- **A thread's "More options" menu is styled again.** Radix portals it to `<body>`, outside the chat's scoped stylesheet, so without a container it rendered with no background, border or padding. It now portals into the chat's own portal host, like every other popup.


### Added

#### New export path: `@talk2view/sdk/chat` — the branded Talk2View chat, ready to render

Two components and one stylesheet. No Tailwind, no PostCSS, no shadcn, no copied
files: everything the chat needs is a dependency of the package.

```tsx
import { Talk2ViewChat } from '@talk2view/sdk/chat';
import '@talk2view/sdk/chat.css';

<Talk2ViewChat partnerKey="pk_live_…" tools={tools} welcome={{ suggestions: ['What can you do?'] }} />
```

- `Talk2ViewChat` — the full pane: a header of one-tap views (Account, Settings,
  earlier conversations, new chat) over a thread that never unmounts, so
  switching views keeps the conversation, the scroll position and a half-typed
  message. Streaming replies in markdown, attachments, dictation, tool approvals
  with editable arguments, and sign-in inside the chat.
- `Talk2ViewChatLauncher` — the same chat in a floating panel: a mark in the
  corner of the page, a popover on a desktop, a full-screen sheet on a phone,
  three colourways, and a size the visitor can drag.
- `injectTalk2ViewChatStyles()` — for a host that cannot import CSS (no loader,
  or a strict `style-src`): installs the same sheet through `adoptedStyleSheets`.
- `useTalk2ViewChatClient()` — the client behind the chat, for the host's own UI.

Everything renders inside `<div class="t2v-chat">`, and the stylesheet is scoped
and armoured so neither side reaches the other. Proven in CI against five
hostile host pages (`npm run test:e2e:chat-hosts`).

**Size, stated plainly:** `/chat` is 361.8 KB gzip of JavaScript, excluding
React. A page containing the chat and nothing else measures about 437 KB gzip.
A consumer who never imports `/chat` pays nothing: the core entry is 9.4 KB gzip
and reaches no assistant-ui code, pinned by a test.

Full documentation in [`docs/chat.md`](docs/chat.md); a runnable example, with no
Tailwind in the host, in [`examples/react-chat`](examples/react-chat).

- **`t2v.auth.listen()`** — the exact inverse of `t2v.auth.destroy()`, for a
  client you want listening again after disposing of it. Today `t2v.destroy()`
  does nothing but `t2v.auth.destroy()`, so it undoes that too; if the client
  ever grows more teardown, this is the auth half only. Nobody needs to call it
  in the ordinary case: a client listens from construction, exactly as before. It
  exists because React's StrictMode runs an effect as setup → cleanup → setup,
  so a component that destroys the client it owns on cleanup needs a way to
  bring it back — without one, cross-tab sign-out and `clearAuth()` silently
  stop reaching that client for the rest of the session, in development only.

### Fixed

- **A streaming chunk without `choices` no longer takes down the turn.** The
  session reader indexed `chunk.choices[0]` unguarded, so a chunk carrying only
  metadata threw "Cannot read properties of undefined" and lost the reply that
  had already streamed.

## [0.15.0] - 2026-09-18

### Added

- Google / Apple sign-in work on every website by default. On a website the partner has not registered, the end-user first sees a Talk2View screen naming the site; registering it (dashboard → Settings → Allowed websites) removes that screen. `<LoginForm>` asks the engine what is available from the current page (`t2v.auth.getPopupProviders()`, `oauthProviders` on `useT2VAuth()`), hides the buttons only where the partner allows registered websites alone, and logs one console line telling the developer what to register.

### Security

- **Model replies render as markdown only** (`docs/adr/0009-model-replies-render-as-markdown-only.md`). `<ChatPanel>` and the new `renderSafeMarkdown()` export from `@talk2view/sdk/ui` now:
  - show raw HTML in a reply as text (a bare `<br>` still breaks lines inside table cells);
  - turn images into links the end-user opens themselves, so nothing loads when the reply appears;
  - open web links in a new tab with `noopener noreferrer`;
  - drop any link destination that isn't `http(s)` or `mailto`.

  A prompt-injected reply can no longer leak conversation data through an image URL, or draw a fake password form or full-screen overlay over your app.
- **`MarkdownRenderer` renders immediately** instead of staying blank until its sanitizer loads. It also no longer adds hooks to your app's own DOMPurify.

### Changed

- **A partner can refuse anonymous sign-in.** Anonymous access is now a partner
  setting with a daily anonymous cap. When `POST /v1/auth/anonymous` refuses
  (`anonymous_access_disabled`, `anonymous_daily_cap_reached`, or a captcha the
  client didn't send), `chat()` no longer carries on into a 401: it emits
  `anonymousUnavailable` with the reason and sends nothing, and `<ChatPanel>`
  shows its sign-in form. The message is retried once the visitor signs in.
  `uploadAttachment()` throws `sign_in_required` in the same case.

### Fixed

- **The package loads in Node.** `"type": "module"` was set but the build emitted extensionless relative imports, so `import '@talk2view/sdk'` failed with `ERR_MODULE_NOT_FOUND` anywhere without a bundler — plain Node, an Electron main process, SSR. Every emitted specifier now carries its `.js` extension, and the compiler is on NodeNext resolution so a missing one is a build error rather than a partner's runtime crash.
- **`/react` and `/ui` resolve for TypeScript apps on the older `moduleResolution: "node"`.** The subpaths are declared through `exports`, which that setting ignores, so those imports failed with TS2307 ("There are types at dist/react/index.d.ts, but this result could not be resolved under your current 'moduleResolution' setting") — while the root import worked, which made it look like a broken package rather than a tsconfig mismatch. A `typesVersions` map now covers it.
- **The error classes the SDK exports are now the ones it throws.** `AuthenticationError` and `PartnerKeyError` were exported and documented, but every failed request threw a plain `T2VError`, so `catch (err) { if (err instanceof AuthenticationError) … }` never matched. The engine's `authentication_error` and `partner_key_error` now arrive as those classes, carrying the server's `type`, `statusCode`, `code` and `detail`. Everything else is still a `T2VError` — `err.type` remains the precise test. `SessionError` stays reserved: the engine reports a dead chat session as a generic `not_found`, which the SDK handles itself (`sessionRecovered`, or an `error` event with `errorType: 'session_lost'`).
- **The README's code runs.** The React quick start imported `ChatPanel` from `/react` (which doesn't export it), wrapped it in `<T2VProvider>` (which makes it throw `useTalk2View must be used within <Talk2View>`), and passed `tools`/`systemPrompt` props it doesn't have. The quick start is now the real `<Talk2View>` + `<ChatPanel>` composition from `/ui`, covered by a test that renders it. Also corrected: the dead `api.talk2view.com` host (the default is `https://engine.talk2view.com`), a `<LoginModal>` component that does not exist, the `useT2VChat`/`useT2VAuth` result shapes, `transcribe()`'s signature, and the claim that a logged-out visitor sees a login form (they get an anonymous demo session).
- **A Talk2View deploy no longer breaks an open chat that hasn't started replying.** When the engine has lost the chat session before any part of the reply has arrived, `chat()` and `sendMessage()` open a new one, re-register your tools and resend the turn with its history, instead of failing every later message with "Session not found". A new `sessionRecovered` event carries the new session id. If the session is instead lost after the reply has started, or while a tool result is being sent back — including answering an approval after the session died — the SDK doesn't resend: the tool handler may already have run, so it reports one `error` event with `errorType: 'session_lost'` instead, and clears any pending approval.
- **Anonymous → permanent conversion now re-authenticates.** `signup()` on
  an anonymous session called `/v1/auth/convert` but kept the old anonymous
  tokens. Setting a password during conversion revokes that session's
  refresh token server-side (Supabase rotates tokens on credential change),
  so the kept token was stale and the next refresh 401'd — the account
  silently broke ~an hour after signup. `signup()` now follows convert with
  a `login()` to obtain a fresh session (same `user_id` → history kept).

### Added

#### Sign in with Apple on the web
`t2v.auth.signInWithApple()`, `signInWithApple` / `oauthProvider` on `useT2VAuth()`, and a "Continue with Apple" button in `<LoginForm>` (above Google, in Apple's black style). An end-user who made their account with Apple in a native app has no password, so this is their only way into a web chat. Needs an engine that offers Apple in the popup flow.

#### New export path: `@talk2view/sdk/ui`
The chat UI, with no peer dependencies beyond React — no Tailwind, no assistant-ui. (An earlier draft of this entry listed a `T2V*` assistant-ui surface that was never shipped; these are the real exports.)

**Provider and surfaces:**
- `Talk2View` — root provider: creates the client, registers tools, injects the theme, holds chat state
- `ChatPanel` — the full chat surface (header, messages, composer, sign-in, tool approvals)
- `ChatWidget` — floating launcher + popover wrapper around `ChatPanel`

**Components:** `MessageList`, `MessageBubble`, `Composer`, `WelcomeScreen`, `LoginForm`, `ChatHeader`, `SettingsPanel`, `ApprovalCard`, `ToolDisplay`, `ToolStepGroup`, `MarkdownRenderer`, `CodeBlock`, `ThinkingBlock`, `MessageActions`, `Shimmer`

**Hooks:** `useTalk2View`, `useChat`

**Utilities:** `renderSafeMarkdown`, `groupModelsByProvider`, `providerTitle`, `UNKNOWN_PROVIDER_KEY`, `THEME_DEFAULTS`, `LOGOS`

#### New export path: `@talk2view/sdk/assistant-ui`
A runtime for [assistant-ui](https://www.assistant-ui.com), separate from `/ui`'s own chat components: `useTalk2ViewRuntime(options)` and `useTalk2ViewRuntimeForClient(t2v, options)` return an `AssistantRuntime` (built on `useExternalStoreRuntime`) so the stock `<Thread />` — installed from assistant-ui's shadcn registry, unmodified — renders Talk2View's streaming replies, client tools, tool approvals (`allow-once`/`allow-always`/`reject-once` plus a free-form reason), attachments, stop and retry. `@assistant-ui/react` (`^0.15.0`) is an optional peer dependency, loaded only by this entry point — the root, `/react` and `/ui` bundles are unchanged. This is a different, minimal integration from the `T2V*` assistant-ui wrapper surface removed below: no custom components, just the runtime seam. See `examples/react-assistant-ui` and the README's "assistant-ui" section.

#### Core SDK additions
- `useT2VChat` now accepts `model` option to override the LLM model per-session
- `Talk2View.chat()` and `T2VSession.sendMessage()` accept `model` option
- Model priority chain: user preference > partner default > provider prop > server default
- `SettingsView` accepts `hideHeader` prop for embedding in containers with their own header
- `t2v.warmUp()` — sets a new end-user up with the model proxy ahead of their first AI call, so that call no longer waits 2–5 s for it. The first-party UI and the assistant-ui runtime call it on the first keystroke and on mic tap. Needs an engine with `POST /v1/account/warm`; a no-op otherwise.
- `t2v.ensureSession()` — start the anonymous session early.
- assistant-ui dictation: `onPhaseChange` (`listening` / `transcribing` / `idle`), the partner's default voice model when none is chosen, and the microphone released as soon as recording stops.
- `AudioModel.supported_languages` / `description` on `listAudioModels()`.

### Changed

#### `@talk2view/sdk/react` is now headless hooks only
- Removed `ChatPanel`, `ChatMessage`, `ChatInput` UI components
- Removed `ApprovalCard`, `LoginModal`, `SettingsView` (moved to `@talk2view/sdk/ui`)
- Retains: `T2VProvider`, `useT2V`, `useT2VChat`, `useT2VAuth`, `useT2VTools`, `useUserPreferences`, `usePartnerConfig`, `T2V_VARS`, `theme`

#### Server config
- `T2V_PROXY_SERVER_BASE_URL` updated from `t2v4-staging.talk2view.com` to `llm.talk2view.com`

### Removed
- `ChatMessage` and `ChatInput` from `@talk2view/sdk/react` — the `/ui` components (`MessageBubble`, `Composer`) replace them.
- The assistant-ui dependency and its `T2V*` wrapper surface. `/ui` is now first-party components with no peer dependencies beyond React.

---

## Historical: modifications on top of assistant-ui

**This section describes the 0.4-era assistant-ui integration, which was removed. None of the `T2V*` names below exist in the package today** — it is kept as a record of what that layer did, for whenever the integration is revisited.

The SDK used assistant-ui as a rendering layer via `ExternalStoreRuntime`. The following customizations were made on top of the stock assistant-ui components:

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
