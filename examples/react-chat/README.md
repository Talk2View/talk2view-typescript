# react-chat — the packaged chat, with no Tailwind in the host

A plain Vite + React app. No Tailwind, no PostCSS, no `components.json`, no
copied component files: that is the point. The chat arrives as one component and
one stylesheet.

```tsx
import { Talk2ViewChat } from '@talk2view/sdk/chat';
import '@talk2view/sdk/chat.css';

<Talk2ViewChat partnerKey="pk_live_…" />
```

## Run it

```bash
npm install
npm run dev
```

Then open:

| URL | What it shows |
|---|---|
| `http://localhost:5175/?mock=1` | `<Talk2ViewChat>` filling a panel beside the host's own page |
| `http://localhost:5175/launcher?mock=1` | `<Talk2ViewChatLauncher>` floating over the same page |

`?mock=1` answers every engine call in the page, so the example runs with no
account and no network. Drop it and the app talks to whatever `vite.config.ts`
proxies `/api` to (`http://localhost:8100` by default, or set `T2V_ENGINE`), with
the partner key in `src/App.tsx`.

## What to look at

- **The dark toggle.** `dark` goes on the chat's own container, scoped to
  `.t2v-chat`, so the host page's theme and the chat's are separate things.
- **The launcher.** A mark in the corner on a desktop, a full-screen sheet on a
  phone. Narrow the window past 640 px to see it change.
- **Settings.** Model, voice model and spoken language, plus the launcher colour
  when `visitorColourway` is on.
- **A tool.** Ask it to "highlight the nodule". The agent asks first — the
  approval card is part of the packaged chat — and the handler in `src/App.tsx`
  runs in this app and paints the passage in the report behind the chat.
- **The page's font.** `src/styles.css` sets one on `body`, and the chat
  inherits it. A page that sets no font at all gets a serif chat.

## Smoke test

```bash
cd ../..            # packages/sdk
npm run test:e2e:chat-example
```
