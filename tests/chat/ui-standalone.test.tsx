/**
 * The chat's tooltip and dialog used on their own, with no <Talk2ViewChat>
 * around them — which is how `src/chat/ui` reads to anyone who opens it, and
 * what the comments in those files promise.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, beforeAll } from 'vitest';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../../src/chat/ui/tooltip';

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: false, media: '', onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('the chat ui primitives outside a chat', () => {
  it('opens a tooltip when there is no portal host to render into', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<button type="button">trigger</button>} />
          <TooltipContent>the tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'trigger' });
    await act(async () => {
      fireEvent.focus(trigger);
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(document.body.textContent).toContain('the tip');
  });
});
