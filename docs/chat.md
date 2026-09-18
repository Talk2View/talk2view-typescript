# The packaged chat — `@talk2view/sdk/chat`

The branded Talk2View chat, ready to render. Two components and one stylesheet.
Your app needs no Tailwind, no PostCSS, no shadcn and no copied files.

```tsx
import { Talk2ViewChat } from '@talk2view/sdk/chat';
import '@talk2view/sdk/chat.css';

<Talk2ViewChat partnerKey="pk_live_…" tools={tools} />
```

A runnable version of everything below, in a Vite app with no Tailwind, is in
[`examples/react-chat`](../examples/react-chat).

---

## Contents

- [The two components](#the-two-components)
- [Props](#props)
- [What you have to know](#what-you-have-to-know)
- [Theming](#theming)
- [Dark mode](#dark-mode)
- [The launcher in someone else's page](#the-launcher-in-someone-elses-page)
- [Content Security Policy, and hosts with no CSS loader](#content-security-policy-and-hosts-with-no-css-loader)
- [Next.js App Router](#nextjs-app-router)
- [Size](#size)
- [Errors you may see](#errors-you-may-see)
- [For contributors: the stylesheet and the vendored files](#for-contributors-the-stylesheet-and-the-vendored-files)

---

## The two components

### `<Talk2ViewChat>`

Fills whatever box you put it in — a side panel, a task pane, a page section.
The parent needs a height: the chat is `height: 100%`, so a parent with `auto`
height collapses it to its content.

```tsx
<div style={{ height: '100%' }}>
  <Talk2ViewChat
    partnerKey="pk_live_…"
    tools={tools}
    welcome={{ heading: 'How can I help?', suggestions: ['What can you do?'] }}
  />
</div>
```

A header of one-tap views sits over a thread that never unmounts, so switching
to Settings and back keeps the conversation, the scroll position and a
half-typed message.

### `<Talk2ViewChatLauncher>`

The same chat in a floating panel: a mark in the corner of the page, a popover
on a desktop, a full-screen sheet on a phone. It takes every prop
`<Talk2ViewChat>` takes, plus the launcher's own.

```tsx
<Talk2ViewChatLauncher
  partnerKey="pk_live_…"
  tools={tools}
  label="Ask Talk2View"
  colourway="smoke-teal"
  keepClearOf="#cookie-banner"
/>
```

### `useTalk2ViewChatClient()`

The client the chat is using, for your own UI — a sign-out item in your account
menu, a button that starts a conversation from somewhere else in your app. It
must be called inside the chat.

```tsx
function SignOut() {
  const t2v = useTalk2ViewChatClient();
  return <button onClick={() => t2v.auth.logout()}>Sign out</button>;
}
```

---

## Props

Both components also accept everything `T2VConfig` accepts (`baseUrl`, `model`,
`debug`, `requestTimeout`, `anonymousAutoStart`) except `partnerKey`, which they
take directly.

| Prop | Default | What it does |
|---|---|---|
| `partnerKey` | — | Your key. Give this **or** `client`. |
| `client` | — | An existing `Talk2View` instance, shared with the rest of your app. The chat will not destroy a client you passed in. |
| `tools` | none | Your client tools. They run in your app. |
| `systemPrompt` | none | Your own instructions, sent with every message. Changing it does not restart the conversation. |
| `welcome` | `{}` | `heading` and `suggestions` on the empty chat. Clicking a suggestion sends it. |
| `allowAnonymous` | `true` | Logged-out visitors chat as guests. `false` shows sign-in first — **and see the note below**. |
| `features` | all on | `{ dictation, attachments, settings, account, threadList }`. |
| `fontFamily` | inherit | Your own font stack. Default: whatever the page uses. |
| `resetPasswordUrl` | none | Where "Forgot it?" goes. Without it the link is not shown. |
| `footer` | none | A short line under the composer — your terms, a disclaimer. |
| `describeToolActivity` | none | `(name, args) => string \| null`. What a running tool is doing, in your words. |
| `isToolDestructive` | none | `(name, args) => boolean`. Warn before this call. |
| `destructiveWarning` | built-in | `(name, activity) => ReactNode`. Your own warning text. |
| `className` | none | On the chat's own element — **on the launcher, on the anchor**. |

Launcher only:

| Prop | Default | What it does |
|---|---|---|
| `label` | `'Ask Talk2View'` | The words beside the mark, until the visitor opens the chat once. `''` hides them; the mark and the tooltip stay. |
| `colourway` | `'smoke-teal'` | `'smoke-teal'`, `'teal-smoke'` or `'teal-white'`. |
| `visitorColourway` | `false` | Put a colour picker in Settings. |
| `keepClearOf` | none | A CSS selector for something pinned to the bottom of the page. |
| `sheetBelow` | `640` | Screen width in px at and below which the panel is a full-screen sheet. |

---

## What you have to know

These are the things that surprise people. None of them is a bug; all of them
have cost someone an afternoon.

### `allowAnonymous: false` also stops guest sessions

It is not only a screen. The gate is computed from whether anyone is signed in,
and the client starts a guest session on demand — listing the models for
Settings would be enough — which would sign the visitor in and open the gate
from behind. So `allowAnonymous: false` also turns off `anonymousAutoStart`.

If you want a sign-in gate **and** guest sessions (there is no sensible reason
to), pass both explicitly:

```tsx
<Talk2ViewChat partnerKey="…" allowAnonymous={false} anonymousAutoStart />
```

### A page with no font gets a serif chat

`--t2v-font` is `inherit`. That is the design: the chat looks like part of your
app, not like something bolted on. But a page that sets no font anywhere
inherits the browser's default, which is a serif — and so does the chat. Set a
font on `body`, or pass one:

```tsx
<Talk2ViewChat partnerKey="…" fontFamily='"Space Grotesk", system-ui, sans-serif' />
```

Nothing is fetched for it. The chat never loads a font, a stylesheet or a script
from a third-party host, so whatever you name has to be available to the page.

### `isToolDestructive` is your claim about your own tool

Nothing checks it. The chat shows a warning above the approval buttons when you
say a call is destructive, and shows none when you do not — a tool that deletes
the end-user's work gets no warning unless you say so. Approval itself is a
different thing and is enforced: a tool declared `permission: true` is never run
without an answer.

```tsx
<Talk2ViewChat
  partnerKey="…"
  tools={tools}
  describeToolActivity={(name, args) =>
    name === 'insert_text' ? `Inserting ${String(args?.text ?? '').length} characters` : null
  }
  isToolDestructive={(name) => name === 'insert_text' || name === 'delete_section'}
/>
```

### Your theme override loses if your CSS loads before ours

The chat's own tokens are declared at `.t2v-chat`, and the override the theming
section below shows you is `.t2v-chat` too. Identical specificity, so the
winner is whichever stylesheet the browser read **last**. Import ours first and
yours wins, which is what the usual shape does:

```ts
import '@talk2view/sdk/chat.css';   // ours
import './app.css';                 // yours, and it wins
```

Load them the other way — a global stylesheet imported at the entry and the
chat's CSS pulled in later by a lazily imported component, or a bundler that
hoists `node_modules` CSS after your own — and every override silently does
nothing. No error, no warning, just the Talk2View palette.

When you cannot control the order, name the class twice. It is the same
element, so it still matches exactly the chat, but at double the specificity,
which no source order can beat:

```css
.t2v-chat.t2v-chat {
  --primary: #4A73F0;
}
```

Never reach for `!important` on a token instead. The chat's own stylesheet is
forbidden from using it on a custom property, and an `!important` of yours would
be inherited by every surface that reads the token downstream.

### Links in the agent's answers always open in a new tab

Every link in a markdown answer is rendered with `target="_blank"` and
`rel="noopener noreferrer"`, and there is no prop to change that. The chat is
usually a panel inside your application, and the links are not yours or ours —
the model writes them, often out of a web-search result or a file the end-user
attached. A same-tab navigation would take your app down with it, unsaved state
and all.

`javascript:` URLs and raw HTML in an answer are already neutralised, by
react-markdown's default URL transform and by there being no raw-HTML plugin.

### Turning attachments off turns off two things

`features.attachments: false` removes both the attach button and the drop zone.
There is no half-off state: either the chat takes files or it does not.

---

## Theming

Everything the chat draws is inside `<div class="t2v-chat">`, and every colour,
radius and font it uses is a custom property declared on that element. Redeclare
one and the chat follows; nothing else on your page changes.

```css
.t2v-chat {
  --radius: 0.75rem;          /* square by default; this rounds everything */
  --primary: #4A73F0;         /* the send button, the accent */
  --primary-foreground: #fff;
  --composer-radius: 1rem;    /* the composer on its own */
}
```

Import `@talk2view/sdk/chat.css` **before** your own CSS, or write the selector
twice (`.t2v-chat.t2v-chat`) — see
[above](#your-theme-override-loses-if-your-css-loads-before-ours) for why.

| Token | What it paints |
|---|---|
| `--background` / `--foreground` | The chat's ground and its text |
| `--card` / `--card-foreground` | Raised blocks |
| `--popover` / `--popover-foreground` | The launcher's panel, menus, tooltips |
| `--primary` / `--primary-foreground` | Send, submit, the agreed action |
| `--secondary` / `--secondary-foreground` | Quiet buttons |
| `--muted` / `--muted-foreground` | Soft surfaces (the user's bubble) and quiet text |
| `--accent` / `--accent-foreground` | Hover surfaces |
| `--destructive` | Errors, Deny |
| `--border` / `--input` / `--ring` | Edges and the focus ring |
| `--radius` | Every corner. `--radius-sm/md/lg/xl` are computed from it |
| `--composer-radius` / `--composer-bg` / `--composer-padding` | The composer on its own |
| `--t2v-font` | The font. `inherit` by default — prefer the `fontFamily` prop |

The brand hexes are there too, if you want to reach past the semantic names:
`--t2v-teal`, `--t2v-smoke`, `--t2v-ivory`, `--t2v-mist`, `--t2v-stone`,
`--t2v-slate`, `--t2v-ash`, `--t2v-highlight`, `--t2v-harbor`, `--t2v-amber`.

**Two things do not follow your tokens**, on purpose:

- **The Apple sign-in button.** Apple's Human Interface Guidelines fix its
  colours, and an app that repaints it can be rejected.
- **The launcher's mark and tile.** Three fixed colourways, chosen with the
  `colourway` prop, each pinned in every state so a host's hover rules cannot
  half-repaint them. `visitorColourway` hands the choice to the end-user.

Everything else, the voice button included, reads the tokens above.

---

## Dark mode

Put `dark` on the chat's container — the same class shadcn uses, scoped so it
never reaches your page:

```tsx
<Talk2ViewChat partnerKey="…" className={theme === 'dark' ? 'dark' : undefined} />
```

The class travels with the chat: tooltips, dialogs and the launcher's panel
render in a host element appended to `<body>`, outside the element `className`
lands on, and the chat carries the theme out to them for you.

`dark` on your `<html>` or `<body>` does **not** darken the chat, deliberately —
your page's theme and the chat's are separate choices. Wire them together in
your own code if you want them to move as one, as the example does.

---

## The launcher in someone else's page

### Mount it outside anything with a `transform`

The launcher's corner is `position: fixed`. An ancestor with `transform`,
`filter`, `perspective`, `backdrop-filter` or `contain` becomes the containing
block for fixed descendants, and the launcher then pins to the corner of *that
element* instead of the window. There is no CSS fix from our side. Render it as
a child of `<body>`, or of a container with none of those properties:

```tsx
createPortal(<Talk2ViewChatLauncher partnerKey="…" />, document.body)
```

A host page whose own CSS shouts `position: static !important` at your
containers will do the same thing, for the same reason.

### `className` lands on the anchor

The anchor is the fixed corner in your page, so `className` is how you move the
launcher to the other side:

```css
.my-launcher { inset-inline: 1rem auto !important; }  /* bottom-left */
```

### `keepClearOf` rides above a banner

Give it a CSS selector for anything pinned to the bottom of the page — a cookie
notice, a playback bar — and the launcher rises above it while it is there and
drops back when it goes. The selector is re-resolved as the page changes, so a
banner that appears after the chat is picked up, and a mistyped selector means
"keep clear of nothing" rather than an error.

### The phone sheet

At and below `sheetBelow` (640 px by default) the panel is a full-screen sheet
with its own Close button, and the page behind it does not scroll. The launcher
stays tappable over it.

### What the visitor gets to keep

Two things are remembered **per device, in `localStorage`, not per account**:
the colourway (when `visitorColourway` is on) and the size they dragged the
panel to. A double click on the panel's top-left corner gives the default size
back. Whether they have opened the chat before is remembered too — that is what
retires the label beside the mark.

---

## Content Security Policy, and hosts with no CSS loader

The chat fetches nothing at runtime: no fonts, no CDN, no stylesheet, no script.
A `connect-src` that allows your Talk2View engine is all it needs.

`import '@talk2view/sdk/chat.css'` needs a build that can import CSS. Some hosts
cannot — an Office add-in's webpack with no CSS rule, a strict `style-src` that
blocks a `<style>` tag. For those:

```ts
import { injectTalk2ViewChatStyles } from '@talk2view/sdk/chat';

injectTalk2ViewChatStyles();   // idempotent; call it as often as you like
```

It installs the same stylesheet through `adoptedStyleSheets`, which `style-src`
does not govern, and falls back to one `<style>` tag where constructable
stylesheets are missing. Use one route or the other, not both.

---

## Next.js App Router

The chat is a client component. Import it from a file that has `'use client'`
at the top, or mark the boundary yourself:

```tsx
// app/chat/panel.tsx
'use client';
import { Talk2ViewChat } from '@talk2view/sdk/chat';
export default function Panel() {
  return <Talk2ViewChat partnerKey={process.env.NEXT_PUBLIC_T2V_KEY!} />;
}
```

The stylesheet is a side-effect import, so put it in `app/layout.tsx` (or
anywhere in the client graph) rather than inside a server component.

Both components survive `renderToString` — every store the chat subscribes to
supplies a server snapshot, and the portal host is not created without a
`document` — so neither has to be loaded with `ssr: false`. Doing so is
harmless, though, if you would rather keep the weight out of the server bundle
entirely.

---

## Size

Stated plainly, because it is large.

| | gzip |
|---|---|
| `@talk2view/sdk` (the core client) | 9.4 KB |
| `@talk2view/sdk/ui` (the previous chat panel) | 39.9 KB |
| **`@talk2view/sdk/chat`** | **361.8 KB** |
| A whole page containing the chat and React | ~437 KB |

The first three exclude React and React DOM, which your app already has. The
weight is `@assistant-ui/react`, `@base-ui/react` and the markdown stack, and
there is no code-splitting seam inside them to defer.

**If you never import `/chat`, you pay none of it.** The entry points are
separate and `sideEffects` lists only CSS, so a consumer of `@talk2view/sdk` or
`@talk2view/sdk/ui` reaches no assistant-ui code at all. That is pinned by
`tests/chat/tree-shake.test.ts`, which bundles the published `dist/` on every
test run and fails if any of these numbers grows past a fence set just above
today's reading.

---

## Errors you may see

### "Two copies of @assistant-ui/react are loaded"

Thrown in development, on mount. Your app installed its own
`@assistant-ui/react` at a version npm could not collapse with ours, so there
are two physical copies on the page. Each has its own React context: the chat
would mount, render, and then quietly do nothing — the runtime fills one
context and the components read the other.

```bash
npm ls @assistant-ui/react     # shows every copy and who asked for it
```

Fix it by aligning your version with the one `@talk2view/sdk` depends on, so npm
dedupes them, or by dropping your own copy if the packaged chat is the only
thing using it. The check does not run in production builds — it is there to
tell you now rather than leave you with a chat that does nothing.

### "`<Talk2ViewChat>` needs either a partnerKey or a client"

Exactly what it says. Pass one or the other.

### "This component must be rendered inside `<Talk2ViewChat>`"

`useTalk2ViewChatClient()` was called outside the chat. Create your own
`Talk2View` client and pass it in with the `client` prop if you need one in both
places.

---

## For contributors: the stylesheet and the vendored files

Skip this unless you are changing the chat itself.

### Two authoring traps in `chat.src.css`

**1. The root rule is written `:root`, never `.t2v-chat`.**
`scripts/chat/isolate.mjs` rewrites `:root` to `.t2v-chat` and prefixes
everything else as a descendant of it. So a rule you write as `.t2v-chat { … }`
ships as `.t2v-chat .t2v-chat { … }` and matches nothing — silently. This cost
the full-pane chat its height once: it collapsed to its content and nobody found
out until a browser rendered it.

```css
:root { height: 100%; }              /* the chat's own element */
.aui-thread-root { … }               /* anything inside it */
:root.aui-modal-anchor { … }         /* another chat root: the launcher's corner */
```

**2. Armoured utilities beat inline styles and unlayered rules.**
`isolate.mjs --armour` marks every declaration in `@layer utilities` and
`@layer components` `!important`. An important author declaration beats an
inline `style` attribute, so `style={{ width }}` on an element that also carries
`w-[…]` does nothing. It also beats any hand-written rule of yours that is not
itself `!important` **and** more specific.

This has bitten three separate pieces of work in three disguises, and the build
never says a word: the rule simply has no effect. When you write CSS that has to
win against a utility, give it `!important` and higher specificity, and check it
in a browser:

```css
.aui-modal-content[data-sized] { width: var(--t2v-panel-width) !important; }
```

Never put `!important` on a custom property — that would break retheming, and
the audit script fails the build if you do.

The other side of the same coin: armour does **not** cover hand-written rules in
the unlayered origin, which is where the launcher's anchor, phone sheet and
colourways live. A host page's `!important` can beat those.
`tests/e2e/chat-hosts/` says exactly which ones hold and which do not.

### Changing a vendored file

Files under `src/chat/vendor/` come from assistant-ui's shadcn registry and are
never hand-edited. The registry is unversioned and mutable, so every file's
sha256 is recorded in `MANIFEST.json`.

```bash
npm run chat:sync      # refetch, rewrite imports, run the codemod, apply patches
npm run chat:check     # verify the tree is exactly what sync produced
npm run build:css      # rebuild dist/chat.css (scope, namespace, audit, minify)
```

Every difference from upstream must be one of three things: a path rewrite in
`sync-registry.mjs`, the idempotent `asChild → render` codemod, or a patch file
under `scripts/chat/patches/`. To change a patch, reverse-apply the old one,
edit the pristine file, and regenerate with `diff -u` — do not hand-edit the
hunks. Then run the **online** sync to prove the patch still applies to what the
registry serves today.

Prefer a path rewrite to a patch when the change is one: a rewrite has no hunk
to reconcile when upstream edits the lines around it. Two of them are in the
script today — the app aliases (`@/components/ui/` and friends) and the
`MarkdownText` redirect, which points the thread and the reasoning block at
`src/chat/markdown.tsx` so the `a` override lives in first-party code. A rewrite
that finds nothing to do throws, because a silent no-op is how a behaviour
quietly reverts.

Anything else belongs in a wrapper, in `src/chat/ui/`, or in the stylesheet.

### Running the browser suites

```bash
npm run test:e2e:chat-hosts     # five hostile host pages (also runs in CI)
npm run test:e2e:chat-example   # the react-chat example
```
