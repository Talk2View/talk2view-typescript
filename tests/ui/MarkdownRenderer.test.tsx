import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/components/MarkdownRenderer';

/**
 * Render the MarkdownRenderer and wait for its lazily-imported DOMPurify
 * instance to load and produce sanitized HTML. The component starts with empty
 * HTML and re-renders once `import('dompurify')` resolves, so we must wait for
 * the `.t2v-md` container to become non-empty before asserting.
 */
async function renderMarkdown(content: string): Promise<HTMLElement> {
  const { container } = render(React.createElement(MarkdownRenderer, { content }));
  const root = container.querySelector('.t2v-md') as HTMLElement;
  // Wait until DOMPurify has loaded and emitted sanitized output.
  await waitFor(() => {
    expect(root.innerHTML.length).toBeGreaterThan(0);
  });
  return root;
}

describe('MarkdownRenderer — XSS sanitization (model output is untrusted)', () => {
  it('strips <script> tags from rendered output', async () => {
    const root = await renderMarkdown(
      'Hello <script>window.__pwned = true;</script> world',
    );

    expect(root.querySelector('script')).toBeNull();
    expect(root.innerHTML.toLowerCase()).not.toContain('<script');
    // The benign text around it should survive.
    expect(root.textContent).toContain('Hello');
    expect(root.textContent).toContain('world');
  });

  it('removes onerror handlers from <img> tags', async () => {
    const root = await renderMarkdown(
      '<img src="x" onerror="window.__pwned = true">',
    );

    const img = root.querySelector('img');
    // The img element may survive, but the event handler must not.
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(root.innerHTML.toLowerCase()).not.toContain('onerror');
  });

  it('neutralizes javascript: URLs in links', async () => {
    const root = await renderMarkdown('[click me](javascript:alert(1))');

    const link = root.querySelector('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href.toLowerCase()).not.toContain('javascript:');
  });

  it('strips inline event-handler attributes from arbitrary elements', async () => {
    const root = await renderMarkdown(
      '<a href="https://example.com" onclick="window.__pwned = true">link</a>',
    );

    const link = root.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('onclick')).toBeNull();
    expect(root.innerHTML.toLowerCase()).not.toContain('onclick');
  });

  it('drops <iframe> elements injected via raw HTML', async () => {
    const root = await renderMarkdown(
      'text <iframe src="https://evil.example/"></iframe> more',
    );

    expect(root.querySelector('iframe')).toBeNull();
    expect(root.innerHTML.toLowerCase()).not.toContain('<iframe');
  });

  it('removes svg/onload vector payloads', async () => {
    const root = await renderMarkdown(
      '<svg><animate onbegin="window.__pwned = true" attributeName="x" /></svg>',
    );

    expect(root.innerHTML.toLowerCase()).not.toContain('onbegin');
  });
});

describe('MarkdownRenderer — safe markdown still renders', () => {
  it('renders emphasis as <em>/<strong>', async () => {
    const root = await renderMarkdown('This is *italic* and **bold** text.');

    expect(root.querySelector('em')?.textContent).toBe('italic');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders safe http(s) links and preserves the href', async () => {
    const root = await renderMarkdown('[Talk2View](https://talk2view.com)');

    const link = root.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://talk2view.com');
    expect(link?.textContent).toBe('Talk2View');
  });

  it('renders inline code and fenced code blocks', async () => {
    const root = await renderMarkdown('Use `const x = 1` here.\n\n```\nblock code\n```');

    const codes = root.querySelectorAll('code');
    expect(codes.length).toBeGreaterThan(0);
    expect(root.textContent).toContain('const x = 1');
    expect(root.textContent).toContain('block code');
  });

  it('renders lists', async () => {
    const root = await renderMarkdown('- one\n- two\n- three');

    const items = root.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(Array.from(items).map((li) => li.textContent)).toEqual(['one', 'two', 'three']);
  });
});

describe('MarkdownRenderer — link hardening (rel on new-tab anchors)', () => {
  it('adds rel="noopener noreferrer" to anchors that open a new tab', async () => {
    // Raw HTML anchor with target="_blank" — vulnerable to reverse tabnabbing and
    // opener/referrer leakage if rel is missing.
    const root = await renderMarkdown('<a href="https://example.com" target="_blank">open</a>');
    const anchor = root.querySelector('a') as HTMLAnchorElement | null;

    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
