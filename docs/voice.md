# Voice

The realtime voice agent: the end-user talks, the agent answers out loud, and
it can use your client tools while it does. It runs the **same** tools,
permission checks and approval card as the chat. A tool you registered for chat
is already a voice tool, so there is no new code to write for voice.

Voice is off until Talk2View turns it on for your partner account. While it is
off, `/v1/config` returns `voice_agent_enabled: false` and nothing below shows.

## In the launcher

`<Talk2ViewChatLauncher>` shows a microphone beside its mark when your partner
account has voice enabled. Press it to talk, and press it again to hang up. A
press while the call is still connecting cancels the call. To hide the button
even when voice is enabled:

```tsx
<Talk2ViewChatLauncher partnerKey="pk_live_…" features={{ voice: false }} />
```

Above the button, a small note shows what the call is doing: connecting,
listening, working, or why it ended. Errors are written for the end-user, not
the developer. For example, when every voice slot is taken, the note reads
"Voice is busy right now. Try again shortly." When a tool needs approval, its
card appears in the same place.

## Standalone

```tsx
import { VoiceButton } from '@talk2view/sdk/chat';
import '@talk2view/sdk/chat.css';

<VoiceButton client={t2v} />;
```

| Prop | Default | |
|---|---|---|
| `client` | the chat's | Required outside `<Talk2ViewChat>` / the launcher. |
| `label` | `"Talk to Talk2View"` | The button's accessible name. |
| `earcon` | `true` | A short, locally generated sound when the microphone goes live. |
| `className` | none | Put `dark` here for the dark palette. |

A standalone `<VoiceButton>` does not check `voice_agent_enabled` itself.
Render it only when `(await t2v.getConfig()).voice_agent_enabled` is true.

## Without a UI: `t2v.voice`

```ts
await t2v.voice.start(); // resolves once the microphone is live
t2v.voice.on('transcript', ({ role, text, final }) => { /* … */ });
t2v.voice.on('toolCall', ({ toolName, arguments: args }) => { /* … */ });
t2v.voice.on('approvalChange', (pending) => pending?.decide({ action: 'once' }));
t2v.voice.on('error', ({ type, message }) => { /* … */ });
t2v.voice.on('ended', (reason) => { /* 'stopped', 'idle', 'session_cap', … */ });
await t2v.voice.stop(); // hangs up and releases the microphone
```

`on()` returns an unsubscribe function. Other events are `stateChange`
(`idle | connecting | listening | ended | error`) and `agentState`
(`working | idle`).

If `start()` fails, it rejects with an error whose `.type` gives the reason:
`voice_disabled`, `account_required`, `auth_expired`, `no_api_key`,
`insufficient_credit`, `credit_check_unavailable`, `service_unavailable`,
`voice_at_capacity`, `voice_ticket_invalid`, `voice_offer_invalid`,
`upstream_error`, `transport_error` or `voice_error`. The same types arrive on
the `error` event, which also reports what ends a call without `start()`
rejecting: `mic_unavailable` (the microphone was refused or is missing; the
call ends with `'error'`), `auth_expired` (the sign-in expired; the call ends with
`'auth_expired'`) and `insufficient_credit` (credit ran out; the call ends with
`'budget_exhausted'`). A deliberate `t2v.auth.logout()` hangs up a call as
`'stopped'`, with no error.

## Browser requirements

- **HTTPS.** Browsers only give microphone access on a secure page (localhost
  counts as secure).
- **Microphone permission.** The browser asks on the first press. If the
  end-user refuses, the call ends with a `mic_unavailable` error. Inside an
  `<iframe>` from another origin, the iframe needs `allow="microphone"`.
- **WebRTC.** The call is a WebRTC connection to Talk2View's voice service,
  through the ICE servers the engine hands out for each call. A network that
  blocks WebRTC fails with `transport_error`.
- **Content-Security-Policy.** Your bundler puts the Pipecat client libraries
  in a separate chunk that loads from your own origin on the first press.
  Starting a call, Pipecat's WebRTC transport has Daily's library
  (`@daily-co/daily-js`) download its call engine from `https://c.daily.co`
  and run it through `Function()`. So voice needs `https://c.daily.co` in
  `connect-src` and `'unsafe-eval'` in `script-src`; without either, no call
  starts. The call's offer then goes to the voice URL the engine returns,
  which on Talk2View's hosted engine is the engine itself, so `connect-src`
  must allow your engine too. If Daily's download fails, its library tries to
  send an error report to Daily's own error tracking (Sentry); you can leave
  that blocked.

A chat-only integration never loads the Pipecat libraries or Daily's call
engine.
