/**
 * Refs reaching the interface primitives in `src/chat/ui/` — on React 18.
 *
 * The package supports `react: ^18.0.0 || ^19.0.0`, and the two versions differ
 * on how a ref gets to a component. React 19 made `ref` an ordinary prop, so a
 * plain function component can pull it out of `...props` and hand it on. React
 * 18 does not: `createElement` lifts `ref` off the props object into the
 * element, a plain function component never sees it, and React logs
 *
 *     Warning: Function components cannot be given refs.
 *     Did you mean to use React.forwardRef()?
 *
 * and drops it. Base UI gives every trigger and popup a ref — `TooltipTrigger`
 * hands one to whatever it renders, which for us is `Button` — so on React 18
 * the chat's icon buttons lost the ref their tooltip needed for positioning and
 * focus, with nothing broken enough to throw.
 *
 * WHY THIS FILE ASSERTS SHAPE AND NOT BEHAVIOUR.
 *
 * The obvious test — render one of these with a ref and check the ref filled in
 * — cannot catch the bug here, because this suite runs on React 19 (see
 * `devDependencies`), where reading `ref` from props works. That test passes on
 * a plain function component and on a `forwardRef` one alike, so it would have
 * gone green throughout the whole defect and guards nothing.
 *
 * What is version-independent is the SHAPE React 18 requires: only an object
 * tagged `react.forward_ref` (or a class) can be given a ref at all. Asserting
 * that tag is asserting the precondition directly, which is why the first
 * describe block below reads as an implementation check. It fails on every one
 * of these components as they were written before, and it keeps failing for any
 * new file added to `src/chat/ui/` in the React 19 style.
 *
 * The second block then renders, because `forwardRef` alone is not enough: a
 * wrapper can take the ref and forget to pass it down, or pass it to the wrong
 * node. That test is version-independent too — it is checking our own wiring,
 * not React's ref plumbing — and it doubles as the proof that each
 * `forwardRef<E, …>` names the element the component actually mounts.
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import * as avatarModule from '../../src/chat/ui/avatar';
import * as buttonModule from '../../src/chat/ui/button';
import * as collapsibleModule from '../../src/chat/ui/collapsible';
import * as dialogModule from '../../src/chat/ui/dialog';
import * as inputModule from '../../src/chat/ui/input';
import * as skeletonModule from '../../src/chat/ui/skeleton';
import * as textareaModule from '../../src/chat/ui/textarea';
import * as tooltipModule from '../../src/chat/ui/tooltip';

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '../../src/chat/ui/avatar';
import { Button } from '../../src/chat/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../src/chat/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '../../src/chat/ui/dialog';
import { Input } from '../../src/chat/ui/input';
import { Skeleton } from '../../src/chat/ui/skeleton';
import { Textarea } from '../../src/chat/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../src/chat/ui/tooltip';
import { PortalHostContext } from '../../src/chat/lib/portal-host';

/** Every module in `src/chat/ui/`, so a new file is covered by being imported. */
const MODULES: Record<string, Record<string, unknown>> = {
  'avatar.tsx': avatarModule,
  'button.tsx': buttonModule,
  'collapsible.tsx': collapsibleModule,
  'dialog.tsx': dialogModule,
  'input.tsx': inputModule,
  'skeleton.tsx': skeletonModule,
  'textarea.tsx': textareaModule,
  'tooltip.tsx': tooltipModule,
};

/**
 * The three components here that render no element of their own.
 *
 * `Dialog.Root`, `Tooltip.Root` and `Tooltip.Provider` are context alone: Base
 * UI types them as plain functions with no `ref` in their props, so nothing can
 * hand these a ref, on either React version, and there is no node for one to
 * point at. Wrapping them would advertise a ref that silently went nowhere —
 * the failure this file exists to prevent, reintroduced by the fix for it.
 *
 * Anything NOT named here must be a `forwardRef`.
 */
const RENDERS_NO_ELEMENT = new Set(['Dialog', 'Tooltip', 'TooltipProvider']);

const FORWARD_REF = Symbol.for('react.forward_ref');

function isForwardRef(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { $$typeof?: symbol }).$$typeof === FORWARD_REF
  );
}

/** Exported components, by convention the capitalised exports. `buttonVariants` is not one. */
function components(): Array<{ file: string; name: string; value: unknown }> {
  const found: Array<{ file: string; name: string; value: unknown }> = [];
  for (const [file, mod] of Object.entries(MODULES)) {
    for (const [name, value] of Object.entries(mod)) {
      if (/^[A-Z]/.test(name)) found.push({ file, name, value });
    }
  }
  return found;
}

describe('the shape React 18 needs to pass a ref', () => {
  it('covers all 27 components, so the sweep below is not quietly empty', () => {
    expect(components()).toHaveLength(27);
  });

  it.each(
    components()
      .filter(({ name }) => !RENDERS_NO_ELEMENT.has(name))
      .map(({ file, name, value }) => [`${file} · ${name}`, value] as const),
  )(
    '%s is a forwardRef, not a plain function React 18 would strip the ref from',
    (_label, value) => {
      expect(isForwardRef(value)).toBe(true);
    },
  );

  it.each([...RENDERS_NO_ELEMENT].map((name) => [name] as const))(
    '%s stays a plain function: it mounts no element for a ref to reach',
    (name) => {
      const value = components().find((c) => c.name === name)?.value;
      expect(typeof value).toBe('function');
      expect(isForwardRef(value)).toBe(false);
    },
  );

  // Without this, React's devtools and the "Check the render method of X"
  // warnings both degrade to `ForwardRef` / anonymous once a component is
  // wrapped — the fix would make the next bug harder to read than this one was.
  it.each(
    components()
      .filter(({ value }) => isForwardRef(value))
      .map(({ file, name, value }) => [`${file} · ${name}`, name, value] as const),
  )('%s keeps its displayName', (_label, name, value) => {
    expect((value as { displayName?: string }).displayName).toBe(name);
  });
});

let portalHost: HTMLElement;

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = (() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  portalHost = document.createElement('div');
  document.body.appendChild(portalHost);
});

/**
 * The portal host `<Talk2ViewChat>` supplies, because the dialog and the
 * tooltip both portal into it and Base UI reads an explicit `container={null}`
 * as "the container has not resolved yet" and renders nothing at all — not as
 * "use `<body>`". Without a host, half the cases below would assert against a
 * subtree that was never mounted.
 */
const Host = ({ children }: { children: React.ReactNode }) => (
  <PortalHostContext.Provider value={portalHost}>{children}</PortalHostContext.Provider>
);

type Ref = React.RefObject<HTMLElement | null>;

/**
 * One case per component that mounts an element, with the DOM class its
 * `forwardRef<E, …>` promises. `instanceof` rather than `tagName` because the
 * promise under test is the TYPE a partner writes `useRef<E>` against, and
 * `HTMLButtonElement` versus `HTMLDivElement` is exactly the mistake that shows
 * up in their editor and never in ours.
 */
const CASES: Array<{
  name: string;
  element: typeof HTMLElement;
  mount: (ref: Ref) => React.ReactElement;
}> = [
  { name: 'Avatar', element: HTMLSpanElement, mount: (ref) => <Avatar ref={ref as never} /> },
  {
    name: 'AvatarImage',
    element: HTMLImageElement,
    // keepMounted: the default preloads through `new Image()`, which never
    // resolves in jsdom, so the <img> would not be in the tree to hold a ref.
    mount: (ref) => (
      <Avatar>
        <AvatarImage ref={ref as never} src="data:," keepMounted />
      </Avatar>
    ),
  },
  {
    name: 'AvatarFallback',
    element: HTMLSpanElement,
    mount: (ref) => (
      <Avatar>
        <AvatarFallback ref={ref as never}>T2</AvatarFallback>
      </Avatar>
    ),
  },
  { name: 'AvatarBadge', element: HTMLSpanElement, mount: (ref) => <AvatarBadge ref={ref as never} /> },
  { name: 'AvatarGroup', element: HTMLDivElement, mount: (ref) => <AvatarGroup ref={ref as never} /> },
  {
    name: 'AvatarGroupCount',
    element: HTMLDivElement,
    mount: (ref) => <AvatarGroupCount ref={ref as never} />,
  },
  { name: 'Button', element: HTMLButtonElement, mount: (ref) => <Button ref={ref as never} /> },
  { name: 'Collapsible', element: HTMLDivElement, mount: (ref) => <Collapsible ref={ref as never} /> },
  {
    name: 'CollapsibleTrigger',
    element: HTMLButtonElement,
    mount: (ref) => (
      <Collapsible>
        <CollapsibleTrigger ref={ref as never} />
      </Collapsible>
    ),
  },
  {
    name: 'CollapsibleContent',
    element: HTMLDivElement,
    mount: (ref) => (
      <Collapsible open>
        <CollapsibleContent ref={ref as never} />
      </Collapsible>
    ),
  },
  {
    name: 'DialogTrigger',
    element: HTMLButtonElement,
    mount: (ref) => (
      <Dialog>
        <DialogTrigger ref={ref as never} />
      </Dialog>
    ),
  },
  {
    name: 'DialogPortal',
    element: HTMLDivElement,
    mount: (ref) => (
      <Dialog open>
        <DialogPortal ref={ref as never} />
      </Dialog>
    ),
  },
  {
    name: 'DialogOverlay',
    element: HTMLDivElement,
    mount: (ref) => (
      <Dialog open>
        <DialogPortal>
          <DialogOverlay ref={ref as never} />
        </DialogPortal>
      </Dialog>
    ),
  },
  {
    name: 'DialogContent',
    element: HTMLDivElement,
    mount: (ref) => (
      <Dialog open>
        <DialogContent ref={ref as never} />
      </Dialog>
    ),
  },
  {
    name: 'DialogClose',
    element: HTMLButtonElement,
    mount: (ref) => (
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogClose ref={ref as never} />
        </DialogContent>
      </Dialog>
    ),
  },
  { name: 'DialogHeader', element: HTMLDivElement, mount: (ref) => <DialogHeader ref={ref as never} /> },
  { name: 'DialogFooter', element: HTMLDivElement, mount: (ref) => <DialogFooter ref={ref as never} /> },
  {
    name: 'DialogTitle',
    element: HTMLHeadingElement,
    mount: (ref) => (
      <Dialog open>
        <DialogContent>
          <DialogTitle ref={ref as never} />
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: 'DialogDescription',
    element: HTMLParagraphElement,
    mount: (ref) => (
      <Dialog open>
        <DialogContent>
          <DialogDescription ref={ref as never} />
        </DialogContent>
      </Dialog>
    ),
  },
  { name: 'Input', element: HTMLInputElement, mount: (ref) => <Input ref={ref as never} /> },
  { name: 'Skeleton', element: HTMLDivElement, mount: (ref) => <Skeleton ref={ref as never} /> },
  { name: 'Textarea', element: HTMLTextAreaElement, mount: (ref) => <Textarea ref={ref as never} /> },
  {
    name: 'TooltipTrigger',
    element: HTMLButtonElement,
    mount: (ref) => (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger ref={ref as never} />
        </Tooltip>
      </TooltipProvider>
    ),
  },
  {
    name: 'TooltipContent',
    element: HTMLDivElement,
    mount: (ref) => (
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger />
          <TooltipContent ref={ref as never}>hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
  },
];

describe('the ref reaching the element it was promised', () => {
  it('has a case for every component that mounts one', () => {
    const shouldMount = components()
      .filter(({ name }) => !RENDERS_NO_ELEMENT.has(name))
      .map(({ name }) => name)
      .sort();
    expect(CASES.map((c) => c.name).sort()).toEqual(shouldMount);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const ref: Ref = React.createRef<HTMLElement>();
    render(testCase.mount(ref), { wrapper: Host });
    expect(ref.current).toBeInstanceOf(testCase.element);
  });
});
