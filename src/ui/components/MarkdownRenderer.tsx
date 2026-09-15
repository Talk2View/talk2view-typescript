import React, { useMemo } from 'react';
import { renderSafeMarkdown } from '../safeMarkdown';

export interface MarkdownRendererProps {
  content: string;
}

/**
 * Renders a model reply as markdown only, never loading remote content on its
 * own (see renderSafeMarkdown and docs/adr/0009).
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => renderSafeMarkdown(content), [content]);

  return (
    <div
      className="t2v-md"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ fontSize: 'inherit', lineHeight: 1.55, wordBreak: 'break-word' }}
    />
  );
}
