# Voice

The realtime voice agent: the end-user talks, the agent answers out loud, and
it can use your client tools while it does. It runs the **same** tools,
permission checks and approval card as the chat. A tool you registered for chat
is already a voice tool, so there is no new code to write for voice.

Voice is off until you turn it on in the dashboard's Settings → Voice. While it
is off, `/v1/config` returns `voice_agent_enabled: false` and nothing below
shows.

A voice call runs on one of two voice models, Gemini Live or ElevenLabs. Which
one is decided for each call: see [Voice models](#voice-models).

## In the launcher

`<Talk2ViewChatLauncher>` shows a microphone beside its mark when your partner
account has voice enabled. Press it to talk, and press it again to hang up. A
press while the call is still connecting cancels the call. To hide the button
even when voice is enabled:

```tsx
<Talk2ViewChatLauncher partnerKey="pk_live_…" features={{ voice: false }} />
```

Above the button, a small note shows what the call is doing: connecting,
listening, working, or why it ended. Until the end-user speaks it says "Say
hello!", or, on an ElevenLabs call, shows the greeting the agent opens with.
Errors are written for the end-user, not the developer. For example, when every
voice slot is taken, the note reads "Voice is busy right now. Try again
shortly." When a tool call needs the end-user's go-ahead or approval, its card
appears in the same place.

When the call runs on a different voice model from the one the end-user wanted,
the engine's note says so for the first few seconds. An end-user who has signed
in (an anonymous user has not) also sees a "Change voice" link there, which
opens their Profile page in a new tab. See [Voice models](#voice-models).

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
t2v.voice.on('note', (text) => { /* "Using Gemini Live — …" */ });
t2v.voice.on('callStarted', ({ voiceModel, greeting }) => { /* … */ });
await t2v.voice.stop(); // hangs up and releases the microphone
```

`on()` returns an unsubscribe function. Other events are `stateChange`
(`idle | connecting | listening | ended | error`) and `agentState`
(`working | idle`). `note` and `callStarted` are described under
[Voice models](#voice-models).

If `start()` fails, it rejects with an error whose `.type` gives the reason:
`voice_disabled`, `account_required`, `auth_expired`, `no_api_key`,
`insufficient_credit`, `credit_check_unavailable`, `voice_model_unavailable`,
`service_unavailable`, `voice_at_capacity`, `voice_ticket_invalid`,
`voice_offer_invalid`, `upstream_error`, `transport_error` or `voice_error`.
The same types arrive on the `error` event, which also reports what ends a call
without `start()` rejecting: `mic_unavailable` (the microphone was refused or is
missing; the call ends with `'error'`), `auth_expired` (the sign-in expired; the
call ends with `'auth_expired'`) and `insufficient_credit` (credit ran out; the
call ends with `'budget_exhausted'`). A deliberate `t2v.auth.logout()` hangs up
a call as `'stopped'`, with no error.

## Voice models

A voice call runs on one of two voice models:

| Voice model | Id | |
|---|---|---|
| Gemini Live | `gemini-live` | Google's realtime voice. |
| ElevenLabs | `elevenlabs` | The most natural-sounding voice. It uses more credits per minute. |

**Who chooses.** The partner chooses which voice models the app offers, and its
default voice model, on the Voice card of the dashboard's Settings page. Gemini
Live is on by default. ElevenLabs is off until the partner turns it on, and a
voice model can be marked premium, so that only end-users on a paid tier can use
it. An end-user can set a preferred voice model on the Voice section of their
Profile page; without one, and for an anonymous user, a voice call uses the
app's default voice model. The engine decides when each call starts, so a
changed preference applies from the next call.

**Change voice.** `VOICE_PREFERENCE_URL` is that Profile section:

```ts
import { VOICE_PREFERENCE_URL } from '@talk2view/sdk';
// https://dashboard.talk2view.com/enduser/profile#voice
```

`<VoiceButton>` shows a "Change voice" link to it, opening in a new tab, for a
signed-in end-user and not for an anonymous user. With your own voice UI, link
to it wherever suits you.

**Which voice model a call used.** Two events tell your UI:

```ts
t2v.voice.on('note', (text) => { /* "Using Gemini Live — ElevenLabs couldn’t connect." */ });
t2v.voice.on('callStarted', ({ voiceModel, greeting }) => { /* 'gemini-live' | 'elevenlabs' */ });
```

- `note` is the engine's word when the voice call is not running on the voice
  model the end-user wanted: the app does not offer it, it is premium and the
  end-user is not on a paid tier, it is switched off or full, or it could not
  connect. Show the text as it comes. It arrives while the call is still
  connecting, so `<VoiceButton>` keeps it up until six seconds after the call is
  live. A call that falls back (below) can send two, and the second replaces the
  first.
- `callStarted` fires once the call is up, just after `stateChange` goes to
  `listening`. `voiceModel` is the voice model it runs on. `greeting` is the
  short line an ElevenLabs agent opens the call with, in the browser's language
  (English where the engine has no greeting for it), and `null` for Gemini Live,
  which waits for the end-user to speak first.

**When ElevenLabs cannot connect.** If an ElevenLabs call fails to connect (a
Content-Security-Policy that blocks one of its hosts, a network that blocks
WebRTC, ElevenLabs being down), the SDK tells the engine, so the call's credit
hold is released, and asks for the call again without ElevenLabs. It retries
once. The call then runs on Gemini Live, with the note "Using Gemini Live —
ElevenLabs couldn’t connect." If the app offers no other voice model,
`start()` rejects with `voice_model_unavailable`.

**`voice_model_unavailable`.** No voice model the app allows can take the call.
The error's message is "Voice isn’t available right now.", and `<VoiceButton>`
shows the same words.

**Ending a call.** Both voice models end a call with the same `ended` reasons
and report the same `error` types, so code written for one runs against the
other. A call that reaches the 15-minute cap ends as `session_cap` on either.
When the end-user's budget runs out mid-call, the agent says so and the call
ends as `budget_exhausted`, with an `insufficient_credit` error.

**SDK version.** ElevenLabs needs `@talk2view/sdk` 0.23.0 or newer. Older SDKs
ask only for Gemini Live, so they always get it, whatever the preferred or the
default voice model; where an app does not offer Gemini Live they show "Voice
isn’t available right now."

## Browser requirements

- **HTTPS.** Browsers only give microphone access on a secure page (localhost
  counts as secure).
- **Microphone permission.** The browser asks on the first press. If the
  end-user refuses, the call ends with a `mic_unavailable` error. Inside an
  `<iframe>` from another origin, the iframe needs `allow="microphone"`.
- **WebRTC.** The call is a WebRTC connection. Gemini Live's goes to
  Talk2View's voice service, through the ICE servers the engine hands out for
  each call. ElevenLabs' goes to its own LiveKit service. A network that blocks
  WebRTC fails the call with `transport_error`.
- **Content-Security-Policy.** Allow what every voice call needs, and what
  each voice model your app offers adds. Your bundler puts the voice libraries
  in separate chunks that load from your own origin, on the first call that
  uses them.

  | | `connect-src`, besides your engine | `script-src` |
  |---|---|---|
  | Every voice call | `https://c.daily.co` | `'unsafe-eval'`, `blob:` |
  | Gemini Live adds | nothing | nothing |
  | ElevenLabs adds | `wss://livekit.rtc.elevenlabs.io`, `https://livekit.rtc.elevenlabs.io` | nothing |

  Every voice call needs Daily's sources, ElevenLabs included, because the SDK
  opens the microphone before the engine has chosen the voice model. Audio
  worklets are governed by `script-src`, not `worker-src`.

  **Every voice call.** The SDK opens the microphone through Daily's library
  (`@daily-co/daily-js`), the media layer of Gemini Live's WebRTC transport.
  Opening it, Daily's library downloads its call engine from
  `https://c.daily.co`, runs it through `Function()`, and starts an audio
  worklet that measures the microphone's level. Without `https://c.daily.co` in
  `connect-src` or `'unsafe-eval'` in `script-src`, no voice call starts,
  whichever the voice model, and nothing falls back. If Daily's download fails,
  its library tries to send an error report to Daily's own error tracking
  (Sentry); you can leave that blocked.

  **Gemini Live** adds nothing: the call's offer goes to the voice URL the
  engine returns, which on Talk2View's hosted engine is the engine itself.

  **ElevenLabs.** With the token the engine mints, the client connects to
  ElevenLabs' LiveKit service at `wss://livekit.rtc.elevenlabs.io`. It also
  makes plain HTTPS requests to `https://livekit.rtc.elevenlabs.io`, to find out
  what went wrong when a connection fails and to check the connection when the
  browser reports it has gone offline or come back online. Those are the only
  hosts it adds to `connect-src`: it never contacts `api.elevenlabs.io`, and it
  loads nothing from a CDN. A call that cannot connect to them is retried on
  Gemini Live (see above), so where the app offers Gemini Live a blocked
  ElevenLabs host costs the end-user the ElevenLabs voice, not the call.

  ElevenLabs adds nothing to `script-src`. The client loads one audio worklet,
  which copies the agent's audio for a callback the SDK does not use, from a
  `blob:` URL, which every voice call allows already. Where the browser refuses
  that (Safari inside an iframe), it tries a `data:` URL. If that is blocked
  too, the client logs "Failed to set up audio capture" and the call carries
  on, the agent's voice playing as usual. Add `data:` only if the chat runs
  inside an iframe that Safari end-users reach and you want that warning gone
  there too.

A chat-only integration never loads the voice libraries. The Pipecat libraries
and Daily's call engine load on the first voice call, whichever the voice model,
since the microphone opens through them, and ElevenLabs' client on the first
ElevenLabs call only.
