import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../../src/ui/components/MarkdownRenderer';
import * as ui from '../../src/ui';

function renderMarkdown(content: string): HTMLElement {
  const { container } = render(React.createElement(MarkdownRenderer, { content }));
  return container.querySelector('.t2v-md') as HTMLElement;
}

describe('MarkdownRenderer', () => {
  it('renders the first reply immediately, with no blank frame while a sanitizer loads', () => {
    const root = renderMarkdown('This is **bold**.');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders through renderSafeMarkdown: raw HTML is text and images are links', () => {
    const root = renderMarkdown(
      '<script>window.__pwned = true</script>\n\n![chart](https://attacker.example/c.png)',
    );

    expect(root.querySelector('script, img')).toBeNull();
    expect(root.textContent).toContain('<script>');
    expect(root.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });

  it('re-renders as streamed content grows', () => {
    const { container, rerender } = render(React.createElement(MarkdownRenderer, { content: 'Hel' }));
    rerender(React.createElement(MarkdownRenderer, { content: 'Hello **world**' }));

    expect(container.querySelector('.t2v-md strong')?.textContent).toBe('world');
  });
});

describe('@talk2view/sdk/ui exports', () => {
  it('exports renderSafeMarkdown for partners with their own chat UI', () => {
    expect(typeof ui.renderSafeMarkdown).toBe('function');
  });
});
