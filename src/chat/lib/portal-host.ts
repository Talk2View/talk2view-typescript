/**
 * Every popover, tooltip and dialog in the chat is portaled, and a portal
 * defaults to `<body>` — outside the `.t2v-chat` element the whole stylesheet is
 * scoped to, so a portaled popup would render unstyled. The provider keeps one
 * host element in `<body>` that carries the same class, and every portal points
 * at it.
 *
 * One host per document, shared by every chat on the page and removed when the
 * last one unmounts, so a page that mounts and unmounts chats does not
 * accumulate empty divs.
 */
import { createContext, useContext, useEffect, useState } from 'react';

/** The element portals inside the chat render into; null outside a chat. */
export const PortalHostContext = createContext<HTMLElement | null>(null);

/**
 * The chat's portal host. Null outside `<Talk2ViewChat>`, which is a valid
 * answer: Base UI reads `container={null}` as "use the default", `<body>`.
 */
export const usePortalHost = (): HTMLElement | null => useContext(PortalHostContext);

type Host = { el: HTMLElement; refs: number };
const hosts = new WeakMap<Document, Host>();

function ensure(doc: Document): Host {
  let host = hosts.get(doc);
  if (!host) {
    const el = doc.createElement('div');
    el.className = 't2v-chat t2v-portal-host';
    host = { el, refs: 0 };
    hosts.set(doc, host);
  }
  // Re-attached rather than recreated, so React's StrictMode double-mount (and
  // any host page that empties <body>) gets the same element back.
  if (!host.el.isConnected) doc.body.appendChild(host.el);
  return host;
}

/**
 * Create (or join) this document's portal host. Returns null while rendering on
 * a server, where there is no document and nothing portals anyway.
 */
export function useCreatePortalHost(): HTMLElement | null {
  // In the state initialiser, not an effect: a popup can be open on the very
  // first render, and a detached container renders nothing.
  const [el] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : ensure(document).el,
  );
  useEffect(() => {
    if (!el) return;
    const host = ensure(el.ownerDocument);
    host.refs += 1;
    return () => {
      host.refs -= 1;
      if (host.refs <= 0) {
        host.refs = 0;
        host.el.remove();
      }
    };
  }, [el]);
  return el;
}
