/**
 * For hosts that cannot `import '@talk2view/sdk/chat.css'` — no CSS loader, or a
 * CSP without a style source for a <style> tag. Installs the same stylesheet
 * through adoptedStyleSheets, which CSP does not govern. Idempotent.
 */
import { css } from '@talk2view/sdk/chat-css';

let installed = false;

export function injectTalk2ViewChatStyles(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if ('adoptedStyleSheets' in document && typeof CSSStyleSheet !== 'undefined') {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return;
  }
  const el = document.createElement('style');
  el.setAttribute('data-talk2view-chat', '');
  el.textContent = css;
  document.head.append(el);
}
