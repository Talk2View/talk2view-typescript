import React, { useMemo, useState, useEffect } from 'react';
import { Marked } from 'marked';
import type DOMPurifyType from 'dompurify';

export interface MarkdownRendererProps {
  content: string;
}

// Private instance avoids mutating the global marked singleton
const parser = new Marked({ gfm: true, breaks: true });

// Module-level cache for the DOMPurify instance (browser only)
let purifyInstance: typeof DOMPurifyType | null = null;

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Track whether DOMPurify has been loaded so useMemo re-runs after load
  const [purifyReady, setPurifyReady] = useState(() => purifyInstance !== null);

  useEffect(() => {
    if (typeof window === 'undefined' || purifyInstance !== null) return;
    import('dompurify').then((mod) => {
      purifyInstance = mod.default;
      setPurifyReady(true);
    }).catch(() => {});
  }, []);

  const html = useMemo(() => {
    if (typeof window === 'undefined' || !purifyInstance) return '';
    const raw = parser.parse(content) as string;
    return purifyInstance.sanitize(raw, { ADD_ATTR: ['target'] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, purifyReady]);

  return (
    <div
      className="t2v-md"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ fontSize: 'inherit', lineHeight: 1.55, wordBreak: 'break-word' }}
    />
  );
}
