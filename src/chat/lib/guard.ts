/**
 * Two physical copies of `@assistant-ui/react` on one page fail silently: each
 * copy has its own React context, so the chat mounts, renders, and then does
 * nothing — the runtime provider fills one context and the components read the
 * other. It happens when a host app installs its own incompatible version
 * beside ours and npm cannot dedupe them.
 *
 * The check is a module-identity comparison, not a counter: a second copy is a
 * different module namespace object, which is exactly the thing that breaks.
 * It runs in development only, where the fix (align the versions) is made.
 */
import * as assistantUi from '@assistant-ui/react';

/** Where the first-loaded copy stamps itself. Exported so tests can stage a clash. */
export const ASSISTANT_UI_KEY = Symbol.for('talk2view.assistant-ui');

// `process` is not typed here (@types/node is not a dependency) and is absent
// in an unbundled browser build. Bundlers replace the expression textually.
declare const process: { env?: { NODE_ENV?: string } } | undefined;

const inProduction = (): boolean => {
  try {
    return typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production';
  } catch {
    return false;
  }
};

export function assertOneAssistantUi(): void {
  if (inProduction()) return;
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const first = globals[ASSISTANT_UI_KEY];
  if (first === undefined) {
    globals[ASSISTANT_UI_KEY] = assistantUi;
    return;
  }
  if (first === assistantUi) return;
  throw new Error(
    'Two copies of @assistant-ui/react are loaded. The Talk2View chat and the ' +
      'rest of your app each got their own, so messages, tools and dictation ' +
      'will not reach the UI. Install one version both can share — ' +
      '`npm ls @assistant-ui/react` shows which copies exist, and matching the ' +
      "version @talk2view/sdk depends on lets npm collapse them into one. " +
      '(This check does not run in production builds.)',
  );
}
