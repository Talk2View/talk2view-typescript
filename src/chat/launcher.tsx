'use client';

/**
 * `<Talk2ViewChatLauncher>` — the floating mark in the corner of a page, and the
 * panel it opens.
 *
 * ```tsx
 * import { Talk2ViewChatLauncher } from '@talk2view/sdk/chat';
 * import '@talk2view/sdk/chat.css';
 *
 * <Talk2ViewChatLauncher partnerKey="pk_live_…" keepClearOf="#cookie-banner" />
 * ```
 *
 * Inside the panel is exactly what `<Talk2ViewChat>` renders — the same header,
 * views and thread — so everything that works in a side panel works here. What
 * this file adds is the frame: a fixed anchor that rides above whatever the
 * integrator names, a popover that stays open when the page behind it is
 * clicked, a full-screen sheet on a phone, and a panel the visitor can resize.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FC,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronDownIcon, XIcon } from 'lucide-react';
import { useAuiEvent } from '@assistant-ui/react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { TooltipIconButton } from './vendor/tooltip-icon-button.js';
import { cn } from './lib/cn.js';
import { usePortalHost } from './lib/portal-host.js';
import { ChatProvider, useChatContext, type Talk2ViewChatProps } from './provider.js';
import { ChatShell, type ChatView } from './chat.js';
import { VoiceButton, shouldShowVoice } from './voice-button.js';
import {
  DEFAULT_LAUNCHER_COLOURWAY,
  LauncherOptionsContext,
  markLauncherOpened,
  useLauncherColourway,
  useLauncherOpened,
  useLauncherOptions,
  type LauncherColourway,
  type LauncherOptions,
} from './lib/launcher-variant.js';

export interface Talk2ViewChatLauncherProps extends Talk2ViewChatProps {
  /** Words beside the mark until the visitor's first open. `''` hides them. */
  label?: string;
  /** Mark and tile colours. Default `'smoke-teal'`. */
  colourway?: LauncherColourway;
  /** Let the visitor change the colourway in Settings (remembered per device). */
  visitorColourway?: boolean;
  /**
   * A CSS selector for something pinned to the bottom of the page — a cookie
   * banner, a "your trial ends" bar. The launcher rides above it while it is up.
   */
  keepClearOf?: string;
  /** Screen width (px) at and below which the panel is a full-screen sheet. */
  sheetBelow?: number;
}

export function Talk2ViewChatLauncher(props: Talk2ViewChatLauncherProps): ReactNode {
  const {
    label = 'Ask Talk2View',
    colourway = DEFAULT_LAUNCHER_COLOURWAY,
    visitorColourway = false,
    keepClearOf,
    sheetBelow = 640,
    // Taken out of the rest so they never reach `new Talk2View()`, which is
    // handed everything the provider does not recognise.
    ...chat
  } = props;

  const options = useMemo<LauncherOptions>(
    () => ({ colourway, visitorColourway }),
    [colourway, visitorColourway],
  );

  return (
    <ChatProvider {...chat}>
      <LauncherOptionsContext.Provider value={options}>
        <LauncherFrame
          label={label}
          keepClearOf={keepClearOf}
          sheetBelow={sheetBelow}
          fontFamily={chat.fontFamily}
          className={chat.className}
          footer={chat.footer}
        />
      </LauncherOptionsContext.Provider>
    </ChatProvider>
  );
}

interface LauncherFrameProps {
  label: string;
  keepClearOf: string | undefined;
  sheetBelow: number;
  fontFamily: string | undefined;
  className: string | undefined;
  footer: ReactNode;
}

const LauncherFrame: FC<LauncherFrameProps> = ({
  label,
  keepClearOf,
  sheetBelow,
  fontFamily,
  className,
  footer,
}) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ChatView>('thread');
  // Read from a client subscription, which must not re-subscribe on every open.
  const openRef = useRef(open);
  openRef.current = open;
  const popupRef = useRef<HTMLDivElement>(null);
  const portalHost = usePortalHost();
  const sheet = useIsSheet(sheetBelow);
  const clearance = useKeepClearOf(keepClearOf);
  const opened = useLauncherOpened();
  const { size, reset, handleProps } = usePanelSize(popupRef);
  const options = useLauncherOptions();
  const colourway = useLauncherColourway(options.colourway, options.visitorColourway);
  const { client, dark, config, features } = useChatContext();

  // Every way in goes through here: the panel opens on the thread, and the
  // label has done its job.
  const openPanel = useCallback(() => {
    setView('thread');
    markLauncherOpened();
    setOpen(true);
  }, []);

  // A guest who cannot go on — the partner allows no guests, or this one has
  // used their allowance — needs to see the way in. `ChatShell` already puts the
  // Account view up by itself; what it cannot do is open a panel it does not own.
  //
  // An approval is the same shape and worse: the agent stops and waits for an
  // answer, and a visitor who closed the panel mid-run sees nothing at all —
  // not the card, not a reason for the silence. The panel is unmounted while
  // closed, so the card inside it cannot ask for itself; only this can.
  useEffect(() => {
    const offs = [
      client.on('anonymousUnavailable', openPanel),
      client.on('demoLimitReached', openPanel),
      // Fires with null when a decision is answered, too — that is not a reason
      // to reopen a panel the visitor has just closed. And only the CLOSED
      // panel needs this: an open one has a `ChatShell` in it, which brings the
      // thread back by itself and knows not to interrupt a half-typed sign-in.
      client.on('approvalChange', (approval) => {
        if (approval && !openRef.current) openPanel();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, openPanel]);

  // A run started from the host's own UI — their hero input, a toolbar button —
  // brings the panel up so the visitor can see the answer arrive.
  useAuiEvent('thread.runStart', openPanel);

  // A sheet covers the whole screen, so the page behind it must not scroll.
  useEffect(() => {
    if (!open || !sheet) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open, sheet]);

  // The host page's font unless the integrator names one; nothing is fetched.
  const font = fontFamily ? ({ ['--t2v-font']: fontFamily } as CSSProperties) : undefined;
  const anchorStyle = useMemo<CSSProperties | undefined>(
    () =>
      clearance ? ({ ...font, translate: `0 -${clearance}px` } as CSSProperties) : font,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontFamily, clearance],
  );
  // A sheet is the whole screen; a remembered size would only fight it.
  const sized = !sheet && size;
  const panelStyle = useMemo<CSSProperties | undefined>(
    () =>
      sized
        ? ({
            ...font,
            // Custom properties, not `width`/`height`: the panel's own size
            // utilities are armoured !important, which an inline declaration
            // cannot beat. chat.src.css reads these back under `[data-sized]`.
            ['--t2v-panel-width']: `${sized.width}px`,
            ['--t2v-panel-height']: `${sized.height}px`,
          } as CSSProperties)
        : font,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontFamily, sized],
  );

  const labelled = !!label && !opened && !open && !sheet;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next, details) => {
        // Clicking the page, or tabbing into it, is not a request to throw away
        // a conversation: only the launcher, the Close button and Escape close.
        if (!next && (details.reason === 'outside-press' || details.reason === 'focus-out')) {
          details.cancel();
          return;
        }
        if (next) openPanel();
        else setOpen(false);
      }}
    >
      {/* A chat root in the host's page: it carries `.t2v-chat` itself, so its
          own rules are written `:root.aui-modal-anchor` in chat.src.css and it
          takes no utility classes of its own. */}
      <div
        className={cn('t2v-chat aui-root aui-modal-anchor', className)}
        style={anchorStyle}
        data-sheet={sheet ? '' : undefined}
      >
        {/* Beside the mark, before it: the anchor is a row that ends at the
            corner, so the mark keeps the corner and voice sits to its left. */}
        {shouldShowVoice(features, config) ? (
          // Over an open sheet the tile would sit on the composer; it steps
          // aside there unless a call is live (chat.src.css).
          <VoiceButton className={open && sheet ? 't2v-voice-tucked' : undefined} />
        ) : null}
        <PopoverPrimitive.Trigger
          render={(triggerProps, state) => (
            <LauncherButton
              {...triggerProps}
              open={state.open}
              label={label}
              labelled={labelled}
              colourway={colourway}
            />
          )}
        />
      </div>
      <PopoverPrimitive.Portal container={portalHost}>
        <PopoverPrimitive.Positioner
          side="top"
          align="end"
          sideOffset={16}
          positionMethod="fixed"
          className="aui-modal-positioner isolate z-[999999]"
          data-sheet={sheet ? '' : undefined}
        >
          <PopoverPrimitive.Popup
            ref={popupRef}
            aria-label="Talk2View chat"
            data-sheet={sheet ? '' : undefined}
            data-sized={sized ? '' : undefined}
            style={panelStyle}
            className={cn(
              // `dark` again, on the panel itself: it is a `.t2v-chat` element,
              // and a `.t2v-chat` declaration on the element beats the dark
              // tokens inherited from the portal host around it. Without this
              // the tile went dark and the panel stayed white.
              't2v-chat group/modal aui-root aui-modal-content',
              dark && 'dark',
              'bg-popover text-popover-foreground ring-foreground/10 z-50 flex flex-col gap-0 overflow-clip overscroll-contain rounded-xl p-0 text-base antialiased shadow-[0_16px_48px_-24px_rgb(0_0_0/0.25)] ring-1 outline-none dark:shadow-[0_16px_48px_-24px_rgb(0_0_0/0.6)]',
              'h-[clamp(31.25rem,72dvh,47.5rem)] max-h-(--available-height) w-[clamp(25rem,30vw,30rem)] max-w-[calc(100vw-2rem)]',
              'origin-(--transform-origin) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:slide-out-to-bottom-2 transition-none ease-[cubic-bezier(0.32,0.72,0,1)] data-closed:duration-200 data-open:duration-300 motion-reduce:animate-none',
              '[&_.aui-thread-root]:bg-inherit [&_.aui-thread-viewport-footer]:bg-popover [&_[data-slot=aui\\_thread-viewport]]:[scrollbar-gutter:stable_both-edges]',
            )}
          >
            <ChatShell
              view={view}
              onViewChange={setView}
              footer={footer}
              // The sheet covers the launcher, so it needs its own way out.
              headerEnd={
                sheet ? (
                  <PopoverPrimitive.Close
                    render={
                      <TooltipIconButton
                        tooltip="Close"
                        side="bottom"
                        className="aui-modal-close text-muted-foreground hover:text-foreground size-9 rounded-md p-0"
                      />
                    }
                  >
                    <XIcon className="size-5" />
                  </PopoverPrimitive.Close>
                ) : undefined
              }
            />
            {/* Last in the DOM, absolutely positioned: the first thing focus and
                a screen reader meet on open should be the chat, not its corner. */}
            {sheet ? null : <PanelResizeHandle {...handleProps} onDoubleClick={reset} />}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};

/* ── the sheet ──────────────────────────────────────────────────────────────
   Driven from JS rather than a media query, because the width at which the
   panel becomes a sheet is the integrator's to choose. The rules it switches
   are keyed on `data-sheet` in chat.src.css. */
function useIsSheet(sheetBelow: number): boolean {
  const query = `(max-width: ${sheetBelow}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  const read = useCallback(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, read, () => false);
}

/* ── keeping clear ──────────────────────────────────────────────────────────
   A cookie banner is pinned to the bottom edge too, and its buttons sit exactly
   where the launcher does. The height is measured rather than assumed, because
   a banner stacks on a phone; the element is re-resolved on DOM changes,
   because it usually arrives after the page has settled and goes away the
   moment the visitor answers it. */
function useKeepClearOf(selector: string | undefined): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!selector || typeof document === 'undefined') return;
    let element: HTMLElement | null = null;
    let frame = 0;

    const measure = () => setHeight(element?.isConnected ? element.offsetHeight : 0);
    const observer = new ResizeObserver(measure);
    const resolve = () => {
      frame = 0;
      let found: HTMLElement | null = null;
      try {
        found = document.querySelector<HTMLElement>(selector);
      } catch {
        // A selector the host mistyped: keep clear of nothing rather than throw.
        found = null;
      }
      if (found === element) return;
      if (element) observer.unobserve(element);
      element = found;
      if (element) observer.observe(element);
      measure();
    };

    resolve();
    const mutations = new MutationObserver(() => {
      // One resolve per frame, whatever the host's own rendering is doing.
      if (!frame) frame = requestAnimationFrame(resolve);
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [selector]);

  return height;
}

/* ── the panel's size ───────────────────────────────────────────────────────
   Dragged from the top-left corner (the panel is anchored bottom-right),
   remembered per device, and always clamped to the window so a size dragged out
   on a monitor cannot put the panel off the edge of a laptop. */
type PanelSize = { readonly width: number; readonly height: number };

type ResizeDrag = {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly direction: 1 | -1;
  last: PanelSize | null;
};

const SIZE_STORAGE_KEY = 't2v-launcher-size';
const MIN_SIZE: PanelSize = { width: 320, height: 400 };
/** The launcher and its offsets sit below the panel; the height leaves room. */
const VIEWPORT_INSET: PanelSize = { width: 32, height: 96 };
const RESIZE_STEP = 16;

const clampSize = ({ width, height }: PanelSize): PanelSize => ({
  width: Math.round(Math.max(MIN_SIZE.width, Math.min(width, window.innerWidth - VIEWPORT_INSET.width))),
  height: Math.round(
    Math.max(MIN_SIZE.height, Math.min(height, window.innerHeight - VIEWPORT_INSET.height)),
  ),
});

const readStoredSize = (): PanelSize | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(SIZE_STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { width, height } = stored as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number') return null;
    return clampSize({ width, height });
  } catch {
    return null;
  }
};

const storeSize = (size: PanelSize | null) => {
  try {
    if (size) window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
    else window.localStorage.removeItem(SIZE_STORAGE_KEY);
  } catch {
    // Without storage the size lasts until the page reloads.
  }
};

const isRtl = (element: Element) => getComputedStyle(element).direction === 'rtl';

function usePanelSize(contentRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState(readStoredSize);
  const dragRef = useRef<ResizeDrag | null>(null);

  const commitSize = (next: PanelSize | null) => {
    setSize(next);
    storeSize(next);
  };

  const sizeFromPointer = (drag: ResizeDrag, event: PointerEvent<HTMLElement>) =>
    clampSize({
      width: drag.width - (event.clientX - drag.x) * drag.direction,
      height: drag.height - (event.clientY - drag.y),
    });

  const takeDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    dragRef.current = null;
    return drag;
  };

  const reset = () => {
    dragRef.current = null;
    commitSize(null);
  };

  return {
    size,
    reset,
    handleProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const content = contentRef.current;
        if (event.button !== 0 || !content) return;
        const rect = content.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          width: rect.width,
          height: rect.height,
          direction: isRtl(content) ? -1 : 1,
          last: null,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        // A click is a pointerdown, a pointermove that never moved, and a
        // pointerup: without this it would commit the size it already has.
        if (!drag.last && event.clientX === drag.x && event.clientY === drag.y) return;
        drag.last = sizeFromPointer(drag, event);
        setSize(drag.last);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const drag = takeDrag(event);
        if (!drag) return;
        if (drag.last || event.clientX !== drag.x || event.clientY !== drag.y) {
          commitSize(sizeFromPointer(drag, event));
        }
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => {
        const drag = takeDrag(event);
        if (drag?.last) commitSize(drag.last);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const content = contentRef.current;
        if (!content) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reset();
          return;
        }
        const step = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP;
        const rtl = isRtl(content);
        const changes: Record<string, readonly [number, number]> = {
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
          [rtl ? 'ArrowRight' : 'ArrowLeft']: [step, 0],
          [rtl ? 'ArrowLeft' : 'ArrowRight']: [-step, 0],
        };
        const change = changes[event.key];
        if (!change) return;
        event.preventDefault();
        const rect = content.getBoundingClientRect();
        commitSize(clampSize({ width: rect.width + change[0], height: rect.height + change[1] }));
      },
    },
  };
}

const PanelResizeHandle: FC<ComponentPropsWithoutRef<'button'>> = (props) => (
  <button
    type="button"
    aria-label="Resize the chat panel"
    className="aui-modal-resize-handle group-hover/modal:border-foreground/15 hover:border-foreground/40 focus-visible:border-ring absolute start-0 top-0 z-10 size-6 cursor-nwse-resize touch-none rounded-ss-xl border-s-2 border-t-2 border-transparent transition-colors outline-none [clip-path:polygon(0_0,100%_0,100%_6px,6px_6px,6px_100%,0_100%)] motion-reduce:transition-none rtl:cursor-nesw-resize rtl:[clip-path:polygon(0_0,100%_0,100%_100%,calc(100%_-_6px)_100%,calc(100%_-_6px)_6px,0_6px)]"
    {...props}
  />
);

/** The Talk2View V-mark — the same path as the brand's logomark. */
const Talk2ViewMark = (props: ComponentPropsWithoutRef<'svg'>) => (
  <svg viewBox="0 0 112 82" fill="none" aria-hidden="true" {...props}>
    <path
      d="M112 59H76L69 82H43L36 59H0V0H112V59ZM11 11V48H45L56 80L67 48H101V11H11Z"
      fill="currentColor"
    />
  </svg>
);

type LauncherButtonProps = Omit<
  ComponentPropsWithoutRef<typeof TooltipIconButton>,
  'tooltip' | 'label'
> & {
  open: boolean;
  label: string;
  labelled: boolean;
  colourway: LauncherColourway;
};

const LauncherButton = forwardRef<HTMLButtonElement, LauncherButtonProps>(
  ({ open, label, labelled, colourway, ...rest }, ref) => {
    const tooltip = open ? 'Close Talk2View' : 'Open Talk2View';
    return (
      <TooltipIconButton
        variant="ghost"
        tooltip={tooltip}
        side="left"
        {...rest}
        ref={ref}
        data-launcher-variant={colourway}
        data-labelled={labelled ? '' : undefined}
        className="aui-modal-button h-full w-auto gap-0 rounded-none border-0 p-0 shadow-[0_6px_20px_-8px_rgb(2_28_37/0.55)] transition-[scale] duration-150 ease-out active:scale-96 motion-reduce:transition-none"
      >
        <span className="relative flex size-16 shrink-0 items-center justify-center">
          {/* The mark is 62% of the tile width — the brand's icon ratio, 40px in
              a 64px tile. `size-auto`: ui/button.tsx shrinks any svg without a
              `size-` class of its own to 16px. */}
          <Talk2ViewMark
            data-open={open ? '' : undefined}
            data-closed={open ? undefined : ''}
            className="aui-modal-button-closed-icon absolute size-auto h-[29px] w-[40px] transition-[scale,opacity,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-closed:scale-100 data-closed:opacity-100 data-closed:blur-[0px] data-open:scale-25 data-open:opacity-0 data-open:blur-[4px] motion-reduce:transition-none"
          />
          <ChevronDownIcon
            data-open={open ? '' : undefined}
            data-closed={open ? undefined : ''}
            className="aui-modal-button-open-icon absolute size-7 transition-[scale,opacity,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-closed:scale-25 data-closed:opacity-0 data-closed:blur-[4px] data-open:scale-100 data-open:opacity-100 data-open:blur-[0px] motion-reduce:transition-none"
          />
        </span>
        {label ? (
          // 0fr → 1fr animates the width of text whose size isn't known up front.
          <span
            aria-hidden="true"
            className={cn(
              'aui-modal-button-label grid transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none',
              labelled ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]',
            )}
          >
            <span className="overflow-hidden text-lg font-medium whitespace-nowrap">
              <span className="pe-6">
                <span className="t2v-launcher-label">{label}</span>
                <span className="t2v-launcher-cursor">_</span>
              </span>
            </span>
          </span>
        ) : null}
      </TooltipIconButton>
    );
  },
);

LauncherButton.displayName = 'LauncherButton';
