/**
 * `<Talk2ViewChatLauncher>` — the floating launcher and the panel it opens.
 *
 * The whole chat is rendered inside the popup, as a partner gets it; only the
 * transport and the auth layer are scripted. The launcher's own behaviour —
 * the label that retires after the first open, the colourway, the thing it
 * keeps clear of, the phone sheet, the remembered panel size — is driven
 * through the DOM rather than asserted against internals.
 *
 * Two of its properties cannot be seen in jsdom, which loads no stylesheet:
 * that the fixed anchor is really positioned, and that each colourway really
 * paints. Those are checked against the BUILT stylesheet, in
 * `tests/chat/css-build.test.ts` — the rules live on elements that carry the
 * scope class themselves, where the scoping trap silently matches nothing, and
 * that file already owns the one CSS build the suite makes.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
    startAnonymous: vi.fn().mockResolvedValue(null),
    getPopupProviders: vi.fn().mockResolvedValue([]),
    // listen()/destroy() are an inverse pair; the chat provider calls both.
    listen: vi.fn(),
    destroy: vi.fn(),
  })),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({ T2VSkills: vi.fn().mockImplementation(() => ({})) }));

import { Talk2View } from '../../src/index';
import { Talk2ViewChatLauncher } from '../../src/chat/launcher';
import type { ChatEvent } from '../../src/types';

/** The viewport matchMedia answers about. Only `max-width` is understood. */
let viewport = 1024;

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  // jsdom has neither PointerEvent nor pointer capture, and the resize handle
  // needs both: without a real event class `button` and `clientX` never arrive.
  if (typeof (window as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};

  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return {
      get matches() {
        return max ? viewport <= Number(max[1]) : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  // Resizing the window is what makes a media query change its answer.
  (window as unknown as { setViewport: (px: number) => void }).setViewport = (px: number) => {
    viewport = px;
    for (const cb of [...listeners]) cb();
  };
});

beforeEach(() => {
  localStorage.clear();
  viewport = 1024;
});

afterEach(() => {
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
  document.querySelectorAll('[data-test-banner]').forEach((el) => el.remove());
  document.documentElement.style.overflow = '';
});

const setViewport = (px: number) =>
  (window as unknown as { setViewport: (px: number) => void }).setViewport(px);

/**
 * Render and let the chat settle. The provider fetches the partner's config as
 * it mounts; without the flush that resolution lands after the test has ended,
 * and React rightly complains about a state change outside `act`.
 */
async function mount(ui: React.ReactElement) {
  const result = render(ui);
  await act(async () => {});
  return result;
}

const anchor = () => document.querySelector<HTMLElement>('.aui-modal-anchor')!;
const trigger = () => document.querySelector<HTMLElement>('.aui-modal-button')!;
const panel = () => document.querySelector<HTMLElement>('.aui-modal-content');

async function openPanel() {
  await act(async () => {
    fireEvent.click(trigger());
  });
  await waitFor(() => expect(panel()).toBeTruthy());
}

async function closePanel() {
  await act(async () => {
    fireEvent.click(trigger());
  });
  await waitFor(() => expect(panel()).toBeNull());
}

describe('the launcher button', () => {
  it('introduces itself with a label, and drops it once the chat has been opened', async () => {
    const first = await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    expect(screen.getByText('Ask Talk2View')).toBeTruthy();
    expect(trigger().getAttribute('data-labelled')).toBe('');

    await openPanel();
    await closePanel();

    expect(trigger().getAttribute('data-labelled')).toBeNull();
    expect(localStorage.getItem('t2v-launcher-opened')).toBe('1');
    first.unmount();

    // …and it stays dropped on the visitor's next page.
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    expect(trigger().getAttribute('data-labelled')).toBeNull();
  });

  it('takes the integrator’s own label, and shows none when it is empty', async () => {
    const custom = await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" label="Ask Radiology" />);
    expect(screen.getByText('Ask Radiology')).toBeTruthy();
    custom.unmount();

    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" label="" />);
    expect(document.querySelector('.aui-modal-button-label')).toBeNull();
    expect(trigger().getAttribute('data-labelled')).toBeNull();
  });

  it('says where it goes, and says it once', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    // The label beside the mark is decorative; the button's own name is the
    // action, and a screen reader must hear it exactly once.
    expect(screen.getByRole('button', { name: 'Open Talk2View' })).toBe(trigger());
    await openPanel();
    expect(screen.getByRole('button', { name: 'Close Talk2View' })).toBe(trigger());
  });

  it('takes dark mode into the panel, which is a chat root of its own', async () => {
    // `className` lands on the anchor, in the host's page. The panel renders in
    // the portal host instead, and it carries `.t2v-chat` — which re-declares
    // the light tokens on itself and beats anything inherited. Without `dark`
    // on the panel too, the tile went dark and the panel stayed white.
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" className="dark" />);
    expect(anchor().classList.contains('dark')).toBe(true);
    await openPanel();
    expect(panel()!.classList.contains('dark')).toBe(true);
    expect(document.querySelector('.t2v-portal-host')!.classList.contains('dark')).toBe(true);
  });

  it('leaves the panel light when the integrator asks for nothing', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    expect(panel()!.classList.contains('dark')).toBe(false);
    expect(document.querySelector('.t2v-portal-host')!.classList.contains('dark')).toBe(false);
  });

  it('keeps the beam in every state — closed, labelled and open', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    // The beam is drawn by .aui-modal-button::before, so the class carrying it
    // must never be conditional on the state.
    expect(trigger().classList.contains('aui-modal-button')).toBe(true);
    await openPanel();
    expect(trigger().classList.contains('aui-modal-button')).toBe(true);
    await closePanel();
    expect(trigger().classList.contains('aui-modal-button')).toBe(true);
  });
});

describe('the colourway', () => {
  it('defaults to Smoke on Teal and takes the integrator’s choice', async () => {
    const plain = await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    expect(trigger().getAttribute('data-launcher-variant')).toBe('smoke-teal');
    plain.unmount();

    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" colourway="teal-white" />);
    expect(trigger().getAttribute('data-launcher-variant')).toBe('teal-white');
  });

  it('offers the visitor a colour only when the integrator lets them, and remembers it', async () => {
    const closed = await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });
    await waitFor(() => expect(document.querySelector('.t2v-chat-settings')).toBeTruthy());
    expect(screen.queryByLabelText(/launcher colour/i)).toBeNull();
    closed.unmount();

    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" visitorColourway />);
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });
    const picker = await screen.findByLabelText(/launcher colour/i);
    // The partner's choice is what the visitor starts from.
    expect((picker as HTMLSelectElement).value).toBe('smoke-teal');

    await act(async () => {
      fireEvent.change(picker, { target: { value: 'teal-smoke' } });
    });
    expect(trigger().getAttribute('data-launcher-variant')).toBe('teal-smoke');
    expect(localStorage.getItem('t2v-launcher-colourway')).toBe('teal-smoke');
  });

  it('ignores a remembered colour when the integrator has taken the choice away', async () => {
    localStorage.setItem('t2v-launcher-colourway', 'teal-white');
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" colourway="teal-smoke" />);
    expect(trigger().getAttribute('data-launcher-variant')).toBe('teal-smoke');
  });
});

describe('keepClearOf', () => {
  it('rides above a bar pinned to the bottom of the page, and drops back when it goes', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" keepClearOf="[data-test-banner]" />);
    expect(anchor().style.translate).toBe('');

    // Cookie banners usually arrive after the page has settled.
    const banner = document.createElement('div');
    banner.setAttribute('data-test-banner', '');
    Object.defineProperty(banner, 'offsetHeight', { value: 72, configurable: true });
    await act(async () => {
      document.body.appendChild(banner);
    });
    await waitFor(() => expect(anchor().style.translate).toBe('0 -72px'));

    await act(async () => {
      banner.remove();
    });
    await waitFor(() => expect(anchor().style.translate).toBe(''));
  });

  it('stays put when the integrator names nothing to keep clear of', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    const banner = document.createElement('div');
    banner.setAttribute('data-test-banner', '');
    Object.defineProperty(banner, 'offsetHeight', { value: 72, configurable: true });
    await act(async () => {
      document.body.appendChild(banner);
    });
    expect(anchor().style.translate).toBe('');
  });
});

describe('the phone sheet', () => {
  it('becomes a full-screen sheet with its own way out below the given width', async () => {
    setViewport(390);
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();

    expect(panel()!.hasAttribute('data-sheet')).toBe(true);
    expect(document.querySelector('.aui-modal-positioner')!.hasAttribute('data-sheet')).toBe(true);
    // The sheet covers the launcher, so it carries a Close button of its own.
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    // A full-screen sheet over a scrolling page scrolls the page behind it.
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('is a popover on a wide screen, with no Close button and no scroll lock', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    expect(panel()!.hasAttribute('data-sheet')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('follows the integrator’s own width', async () => {
    setViewport(800);
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" sheetBelow={900} />);
    await openPanel();
    expect(panel()!.hasAttribute('data-sheet')).toBe(true);
  });
});

describe('the panel size', () => {
  it('opens at its own size, and clamps a remembered one to the window', async () => {
    const fresh = await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    // Nothing remembered: the stylesheet's clamp decides, not a dragged size.
    expect(panel()!.hasAttribute('data-sized')).toBe(false);
    expect(panel()!.style.getPropertyValue('--t2v-panel-width')).toBe('');
    fresh.unmount();

    // A size remembered on a bigger screen must not push the panel off this one.
    localStorage.setItem('t2v-launcher-size', JSON.stringify({ width: 5000, height: 5000 }));
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    expect(panel()!.hasAttribute('data-sized')).toBe(true);
    expect(panel()!.style.getPropertyValue('--t2v-panel-width')).toBe(`${window.innerWidth - 32}px`);
    expect(panel()!.style.getPropertyValue('--t2v-panel-height')).toBe(`${window.innerHeight - 96}px`);
  });

  it('remembers a size the visitor drags out', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    const popup = panel()!;
    Object.defineProperty(popup, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 400, height: 500, top: 0, left: 0, right: 400, bottom: 500, x: 0, y: 0 }),
    });

    const handle = screen.getByRole('button', { name: /resize/i });
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500, clientY: 500 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 300 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300, clientY: 300 });
    });

    // Dragging up and to the left grows the panel: it is anchored bottom-right.
    expect(popup.style.getPropertyValue('--t2v-panel-width')).toBe('600px');
    expect(popup.style.getPropertyValue('--t2v-panel-height')).toBe(`${window.innerHeight - 96}px`);
    expect(JSON.parse(localStorage.getItem('t2v-launcher-size')!)).toEqual({
      width: 600,
      height: window.innerHeight - 96,
    });
  });

  it('gives the size back on a double click', async () => {
    localStorage.setItem('t2v-launcher-size', JSON.stringify({ width: 420, height: 460 }));
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    expect(panel()!.style.getPropertyValue('--t2v-panel-width')).toBe('420px');

    await act(async () => {
      fireEvent.doubleClick(screen.getByRole('button', { name: /resize/i }));
    });
    expect(panel()!.hasAttribute('data-sized')).toBe(false);
    expect(localStorage.getItem('t2v-launcher-size')).toBeNull();
  });
});

describe('the panel opening by itself', () => {
  it('opens when a run starts somewhere else in the host’s app', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    // A real answer takes a moment; the panel has to come up while it is coming.
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* (): AsyncGenerator<ChatEvent> {
        await new Promise((resolve) => setTimeout(resolve, 40));
        yield { type: 'text', content: 'Here you go.' };
        yield { type: 'done', threadId: 'th' };
      })()) as never);

    await mount(<Talk2ViewChatLauncher client={t2v} />);
    expect(panel()).toBeNull();

    // The host's own input, not the chat's: the launcher is still shut.
    let sent!: Promise<void>;
    await act(async () => {
      sent = t2v.sendMessage('hi');
    });
    await waitFor(() => expect(panel()).toBeTruthy());
    await act(async () => {
      await sent;
    });
    expect(await screen.findByText('Here you go.')).toBeTruthy();
  });

  it('opens when a guest is turned away, and shows them the way in', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    await mount(<Talk2ViewChatLauncher client={t2v} />);
    expect(panel()).toBeNull();

    await act(async () => {
      // The engine refusing a guest session, as `ensureSession` reports it.
      (
        t2v as unknown as { emitter: { emit: (e: string, p: unknown) => void } }
      ).emitter.emit('anonymousUnavailable', 'anonymous_access_disabled');
    });
    await waitFor(() => expect(panel()).toBeTruthy());
    // The shell's own gate decides the view; the launcher only opens the panel.
    await waitFor(() => expect(document.querySelector('.t2v-chat-account')).toBeTruthy());
  });

  it('opens when the agent asks for a decision, and stays shut when one is answered', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    const emit = (approval: unknown) =>
      (
        t2v as unknown as { emitter: { emit: (e: string, p: unknown) => void } }
      ).emitter.emit('approvalChange', approval);

    await mount(<Talk2ViewChatLauncher client={t2v} />);
    expect(panel()).toBeNull();

    // An agent blocked behind a closed panel is the bad case: the run stops and
    // the visitor is shown nothing at all.
    await act(async () => {
      emit({ toolName: 'insert_text', toolCallId: 'call-1', arguments: {}, prompt: 'Run it' });
    });
    await waitFor(() => expect(panel()).toBeTruthy());

    // Answering clears the gate, which emits null. A panel the visitor has
    // since closed must then stay closed rather than springing back open.
    await closePanel();
    await act(async () => {
      emit(null);
    });
    expect(panel()).toBeNull();
  });
});

describe('the panel itself', () => {
  it('carries the chat box and the integrator’s font, and portals into the host', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" fontFamily='"Space Grotesk", sans-serif' />);
    await openPanel();
    const popup = panel()!;
    expect(popup.classList.contains('t2v-chat')).toBe(true);
    expect(popup.style.getPropertyValue('--t2v-font')).toBe('"Space Grotesk", sans-serif');
    expect(document.querySelector('.t2v-portal-host')!.contains(popup)).toBe(true);
    // The anchor is a chat root too, or none of the stylesheet reaches the button.
    expect(anchor().classList.contains('t2v-chat')).toBe(true);
    expect(anchor().style.getPropertyValue('--t2v-font')).toBe('"Space Grotesk", sans-serif');
  });

  it('stays open when the page behind it is clicked', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" />);
    await openPanel();
    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);
    });
    expect(panel()).toBeTruthy();
  });

  it('shows the whole chat inside the popup', async () => {
    await mount(<Talk2ViewChatLauncher partnerKey="pk_test_x" welcome={{ heading: 'Hi there' }} />);
    await openPanel();
    expect(await screen.findByRole('heading', { name: 'Hi there' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy();
  });
});

/* The launcher's own rules are checked against the BUILT stylesheet, in
   tests/chat/css-build.test.ts: they live on elements that carry the scope class
   themselves, where the scoping trap silently matches nothing, and that file
   already owns the one build the suite makes. */
