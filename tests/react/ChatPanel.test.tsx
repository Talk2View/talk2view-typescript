import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../../src/react/ChatPanel';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/react/T2VProvider', () => ({
  useT2V: () => ({
    t2v: { config: { model: '' }, clearSession: vi.fn() },
  }),
}));

vi.mock('../../src/react/useT2VAuth', () => ({
  useT2VAuth: () => ({
    user: { id: '1', email: 'test@test.com' },
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('../../src/react/useT2VChat', () => ({
  useT2VChat: () => ({
    messages: [],
    isLoading: false,
    error: null,
    threadId: null,
    agentStatus: null,
    pendingApproval: null,
    alwaysAllowedTools: new Set(),
    sendMessage: vi.fn(),
    approveToolCall: vi.fn(),
    retryLastMessage: vi.fn(),
    clearMessages: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('../../src/react/useT2VTools', () => ({
  useT2VTools: () => ({
    registerTools: vi.fn(),
    registeredTools: [],
    isRegistered: false,
  }),
}));

vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { fontSize: 'medium' },
    updatePreferences: vi.fn(),
  }),
}));

// ── ResizeObserver stub ────────────────────────────────────────────────

let resizeCallback: ResizeObserverCallback;
let observedElement: Element | null = null;

class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallback = cb;
  }
  observe(el: Element) {
    observedElement = el;
  }
  unobserve() {}
  disconnect() {
    observedElement = null;
  }
}

beforeEach(() => {
  observedElement = null;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

/** Simulate a width change on the observed element. */
function simulateWidth(width: number) {
  act(() => {
    resizeCallback(
      [
        {
          contentBoxSize: [{ inlineSize: width, blockSize: 600 }],
          contentRect: { width, height: 600 } as DOMRectReadOnly,
          borderBoxSize: [{ inlineSize: width, blockSize: 600 }],
          devicePixelContentBoxSize: [],
          target: observedElement!,
        } as unknown as ResizeObserverEntry,
      ],
      new FakeResizeObserver(resizeCallback) as unknown as ResizeObserver,
    );
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatPanel compact mode', () => {
  it('attaches a ResizeObserver to the panel root', () => {
    render(<ChatPanel />);
    expect(observedElement).not.toBeNull();
  });

  it('uses full-size horizontal logo at wide widths', () => {
    render(<ChatPanel />);
    simulateWidth(500);

    const logos = screen.getAllByAltText('Talk2View');
    const headerLogo = logos[0];
    expect(headerLogo.getAttribute('src')).toContain('horizontal_dark');
    expect(headerLogo.getAttribute('height')).toBe('22');
  });

  it('uses smaller horizontal logo when panel is narrow', () => {
    render(<ChatPanel />);
    simulateWidth(300);

    const logos = screen.getAllByAltText('Talk2View');
    const headerLogo = logos[0];
    expect(headerLogo.getAttribute('src')).toContain('horizontal_dark');
    expect(headerLogo.getAttribute('height')).toBe('18');
  });

  it('uses compact header padding when narrow', () => {
    const { container } = render(<ChatPanel />);
    simulateWidth(300);

    // The header is the first child div inside the panel shell
    const panel = container.firstElementChild!;
    const header = panel.firstElementChild as HTMLElement;
    expect(header.style.padding).toBe('8px 12px');
  });

  it('uses normal header padding when wide', () => {
    const { container } = render(<ChatPanel />);
    simulateWidth(500);

    const panel = container.firstElementChild!;
    const header = panel.firstElementChild as HTMLElement;
    expect(header.style.padding).toBe('12px 16px');
  });

  it('uses smaller profile button when compact', () => {
    render(<ChatPanel />);
    simulateWidth(300);

    const profileBtn = screen.getByTitle('test@test.com');
    expect(profileBtn.style.width).toBe('26px');
    expect(profileBtn.style.height).toBe('26px');
  });

  it('uses normal profile button when wide', () => {
    render(<ChatPanel />);
    simulateWidth(500);

    const profileBtn = screen.getByTitle('test@test.com');
    expect(profileBtn.style.width).toBe('30px');
    expect(profileBtn.style.height).toBe('30px');
  });

  it('transitions from compact to normal when resized wider', () => {
    render(<ChatPanel />);

    simulateWidth(300);
    const logos = screen.getAllByAltText('Talk2View');
    expect(logos[0].getAttribute('height')).toBe('18');

    simulateWidth(500);
    const logosAfter = screen.getAllByAltText('Talk2View');
    expect(logosAfter[0].getAttribute('height')).toBe('22');
  });

  it('treats exactly 360px as non-compact', () => {
    render(<ChatPanel />);
    simulateWidth(360);

    const logos = screen.getAllByAltText('Talk2View');
    expect(logos[0].getAttribute('height')).toBe('22');
  });

  it('treats 359px as compact', () => {
    render(<ChatPanel />);
    simulateWidth(359);

    const logos = screen.getAllByAltText('Talk2View');
    expect(logos[0].getAttribute('height')).toBe('18');
  });
});
