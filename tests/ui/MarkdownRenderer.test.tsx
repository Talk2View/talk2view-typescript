import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MarkdownRenderer } from '../../src/ui/components/MarkdownRenderer';

function renderMarkdown(content: string) {
  return render(React.createElement(MarkdownRenderer, { content }));
}

// DOMPurify is loaded via a dynamic import inside an effect, so the sanitized
// HTML appears on a later tick. waitFor polls until the anchor is present.
async function findAnchor(container: HTMLElement): Promise<HTMLAnchorElement> {
  return waitFor(() => {
    const a = container.querySelector('a');
    if (!a) throw new Error('anchor not rendered yet');
    return a as HTMLAnchorElement;
  });
}

describe('MarkdownRenderer link hardening', () => {
  it('adds rel="noopener noreferrer" to anchors that open a new tab', async () => {
    // Raw HTML anchor with target="_blank" — the case vulnerable to reverse
    // tabnabbing / opener and referrer leakage if rel is missing.
    const { container } = renderMarkdown(
      '<a href="https://example.com" target="_blank">open</a>',
    );
    const anchor = await findAnchor(container);

    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('still neutralizes javascript: and other unsafe URLs', async () => {
    const { container } = renderMarkdown('[click](javascript:alert(1))');
    const anchor = await findAnchor(container);

    // DOMPurify strips the dangerous href; whatever remains must not execute JS.
    const href = anchor.getAttribute('href') ?? '';
    expect(href.toLowerCase().startsWith('javascript:')).toBe(false);
  });
});
