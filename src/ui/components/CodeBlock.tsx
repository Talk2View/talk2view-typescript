import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CodeBlockProps {
  code: string;
  language?: string;
}

let highlighterPromise: Promise<unknown> | null = null;

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/web').then((mod) =>
      mod.createHighlighter({
        themes: ['github-light'],
        langs: ['typescript', 'javascript', 'python', 'bash', 'json', 'html', 'css', 'sql', 'markdown', 'yaml', 'xml', 'java', 'go', 'rust', 'c', 'cpp'],
      }),
    );
  }
  return highlighterPromise;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear timeout on unmount to prevent memory leak
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((highlighter: unknown) => {
        if (cancelled) return;
        const h = highlighter as { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string; getLoadedLanguages: () => string[] };
        const lang = language?.toLowerCase() ?? 'text';
        const loaded = h.getLoadedLanguages();
        const safeLang = loaded.includes(lang) ? lang : 'text';
        const html = h.codeToHtml(code, { lang: safeLang, theme: 'github-light' });
        setHighlightedHtml(html);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for insecure contexts (HTTP)
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        clearTimeout(timerRef.current);
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    });
  };

  return (
    <div style={{
      borderRadius: 'calc(var(--t2v-radius) * 0.5px)',
      border: '1px solid var(--t2v-border)',
      overflow: 'hidden', margin: '0.5em 0', fontSize: '13px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', background: 'var(--t2v-surface)',
        fontFamily: 'var(--t2v-font)', fontSize: '11px', color: 'var(--t2v-muted)',
        borderBottom: '1px solid var(--t2v-border)',
      }}>
        <span style={{ fontWeight: 500, textTransform: 'lowercase' }}>{language ?? 'code'}</span>
        <button onClick={handleCopy} className="t2v-btn-ghost" style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          padding: '2px 8px', borderRadius: '4px',
          fontFamily: 'var(--t2v-font)', fontSize: '11px',
          color: copied ? 'var(--t2v-accent)' : 'var(--t2v-muted)',
          transition: 'color 0.15s',
        }}>
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      {highlightedHtml ? (
        <div dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          style={{ overflowX: 'auto', fontSize: '13px', lineHeight: 1.6 }} />
      ) : (
        <pre style={{ margin: 0, background: 'var(--t2v-surface)' }}>
          <code style={{
            display: 'block', padding: '12px 14px', overflowX: 'auto',
            fontFamily: 'var(--t2v-font-mono)', fontSize: '13px', lineHeight: 1.6,
          }}>{code}</code>
        </pre>
      )}
    </div>
  );
}
