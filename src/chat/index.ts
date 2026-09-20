/**
 * `@talk2view/sdk/chat` — the branded Talk2View chat, ready to render.
 *
 * ```tsx
 * import { Talk2ViewChat } from '@talk2view/sdk/chat';
 * import '@talk2view/sdk/chat.css';
 *
 * export function Panel() {
 *   return <Talk2ViewChat partnerKey="pk_live_…" />;
 * }
 * ```
 *
 * `<Talk2ViewChatLauncher>` is the same chat in a floating panel instead: a mark
 * in the corner of the page, a popover on a desktop and a full-screen sheet on a
 * phone.
 *
 * No Tailwind, no PostCSS, no copied files: one component and one stylesheet.
 * Everything renders inside `<div class="t2v-chat">`, which is also the element
 * to re-theme — the custom properties declared on it (`--radius`, the shadcn
 * colour tokens, `--t2v-font`) are the whole surface.
 *
 * A host that cannot import CSS calls {@link injectTalk2ViewChatStyles} instead.
 *
 * @packageDocumentation
 */
// `ChatShell` (the header-plus-views box without the outer `.t2v-chat` element),
// `ChatShellProps` and `ChatView` are deliberately NOT exported. The launcher
// imports them from this package; nothing outside it needs them, and a
// published export is forever. `<Talk2ViewChat>` fills whatever container it is
// given, which is what a host putting the chat in its own panel actually wants.
export { Talk2ViewChat } from './chat.js';
export {
  Talk2ViewChatLauncher,
  type Talk2ViewChatLauncherProps,
} from './launcher.js';
export type { LauncherColourway } from './lib/launcher-variant.js';
export { useTalk2ViewChatClient } from './provider.js';
export type {
  Talk2ViewChatProps,
  Talk2ViewChatFeatures,
  Talk2ViewChatWelcome,
} from './provider.js';
export { injectTalk2ViewChatStyles } from './inject-styles.js';
