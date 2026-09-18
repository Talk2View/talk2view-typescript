/**
 * `dist/chat-css.js` is written by `npm run build:css`, and tsconfig's `paths`
 * points at the declaration beside it. This ambient declaration is the same
 * shape, so `npm run typecheck` works on a clean checkout where dist/ (which is
 * gitignored) does not exist yet.
 */
declare module '@talk2view/sdk/chat-css' {
  export const css: string;
}
