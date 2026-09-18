'use client';

/**
 * `<Talk2ViewChat>` — the packaged chat, filling whatever box you put it in: a
 * Word task pane, a partner's side panel, a page section.
 *
 * ```tsx
 * import { Talk2ViewChat } from '@talk2view/sdk/chat';
 * import '@talk2view/sdk/chat.css';
 *
 * <Talk2ViewChat partnerKey="pk_live_…" welcome={{ suggestions: ['What can you do?'] }} />
 * ```
 *
 * The frame is ported from the website's assistant modal, minus the popover:
 * a header of one-tap views over a thread that never unmounts, so switching to
 * Settings and back keeps the conversation, the scroll position and any
 * half-typed message.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from 'react';
import { HistoryIcon, PlusIcon, SettingsIcon, UserRoundIcon } from 'lucide-react';
import { ThreadListPrimitive, useAuiState } from '@assistant-ui/react';
import { Thread, ComposerExtrasContext, type ThreadComponents } from './vendor/thread.aui.js';
import { TooltipIconButton } from './vendor/tooltip-icon-button.js';
import { cn } from './lib/cn.js';
import { ChatProvider, useChatContext, type Talk2ViewChatProps } from './provider.js';
import { Welcome } from './welcome.js';
import { ComposerDictation } from './composer-extras.js';
import { ToolFallback, ToolGroup } from './tool-fallback.js';
import { useAuthGate } from './auth-gate.js';
import { AccountView } from './views/account.js';
import { SettingsView } from './views/settings.js';
import { ThreadListView } from './views/thread-list.js';

/** Which pane the header is showing. */
export type ChatView = 'thread' | 'list' | 'settings' | 'account';

const VIEW_TITLES: Record<ChatView, string> = {
  thread: 'New Chat',
  list: 'Threads',
  settings: 'Settings',
  account: 'Account',
};

export function Talk2ViewChat(props: Talk2ViewChatProps): ReactNode {
  const { className, fontFamily, footer } = props;
  return (
    <div
      className={cn('t2v-chat', className)}
      // The host page's font unless the integrator names one; nothing is fetched.
      style={fontFamily ? ({ ['--t2v-font']: fontFamily } as CSSProperties) : undefined}
    >
      <ChatProvider {...props}>
        <ChatShell footer={footer} />
      </ChatProvider>
    </div>
  );
}

export interface ChatShellProps {
  /** A short line under the composer, e.g. terms. */
  footer?: ReactNode;
  /** Extra header buttons at the end of the row — the launcher's Close (Task 6). */
  headerEnd?: ReactNode;
  /** Drive the view from outside, e.g. the launcher opening on a notification. */
  view?: ChatView;
  onViewChange?: (view: ChatView) => void;
}

/**
 * The frame without the outer `.t2v-chat` box, so the launcher (Task 6) can
 * render the same thing inside its popover.
 */
export const ChatShell: FC<ChatShellProps> = ({ footer, headerEnd, view: given, onViewChange }) => {
  const { client, features, behaviour, limits } = useChatContext();
  const [own, setOwn] = useState<ChatView>('thread');
  const gate = useAuthGate(client, behaviour.current.allowAnonymous, limits);
  const chosen = given ?? own;
  // Behind the gate the thread is not somewhere to go back to: Settings and the
  // thread list stay reachable, but "back" lands on sign-in until there is an
  // account behind it.
  const view: ChatView = gate.gated && chosen === 'thread' ? 'account' : chosen;
  const setView = (next: ChatView) => {
    setOwn(next);
    onViewChange?.(next);
  };

  // An approval stops the agent until somebody answers it, and the thread is
  // `inert` whenever another view is open — so a card arriving while the
  // end-user is in Settings or the thread list is on screen and unclickable,
  // with nothing saying why. Bring the thread back.
  //
  // Account is the exception: it holds a half-typed sign-in, and throwing that
  // away is a worse trade than a decision that waits a moment longer.
  const latest = useRef({ view, setView });
  latest.current = { view, setView };
  useEffect(
    () =>
      client.on('approvalChange', (approval) => {
        const now = latest.current;
        if (approval && now.view !== 'thread' && now.view !== 'account') now.setView('thread');
      }),
    [client],
  );

  const components = useMemo<ThreadComponents>(() => ({ Welcome, ToolFallback, ToolGroup }), []);
  // The voice button replaces upstream's mic; the attach button goes when files
  // are off, because upstream renders it whether or not the runtime takes one.
  const extras = useMemo(
    () => ({ dictate: <ComposerDictation />, attachments: features.attachments }),
    [features.attachments],
  );
  // Mounted once: switching views must not throw away the conversation, the
  // scroll position or a half-typed message.
  const thread = useMemo(
    () => (
      <ComposerExtrasContext.Provider value={extras}>
        <Thread components={components} />
      </ComposerExtrasContext.Provider>
    ),
    [components, extras],
  );

  return (
    <div className="t2v-chat-shell aui-root bg-popover text-popover-foreground flex h-full min-h-0 flex-col overflow-clip text-base antialiased">
      <ChatHeader
        view={view}
        onViewChange={setView}
        end={headerEnd}
        signedIn={gate.account.status === 'signed-in'}
      />
      <div className="t2v-chat-body aui-modal-body relative min-h-0 flex-1">
        <div
          // An inline ref runs again on every render, which is what keeps this in
          // step with the view. Inert, not unmounted: see `thread` above.
          ref={(node) => {
            if (node) node.inert = view !== 'thread';
          }}
          className="aui-modal-thread h-full"
        >
          {thread}
        </div>
        {view === 'list' && features.threadList && (
          <ThreadListView onSelect={() => setView('thread')} />
        )}
        {view === 'settings' && features.settings && <SettingsView />}
        {/* Rendered whenever the view is Account, feature flag or not: the gate
            turns it on by itself, and a gate with no way through is a dead end. */}
        {view === 'account' && (
          <AccountView reason={gate.reason} onSignedIn={() => setView('thread')} />
        )}
      </div>
      {footer ? (
        <div className="t2v-chat-footer text-muted-foreground border-foreground/10 shrink-0 border-t px-3.5 py-2 text-xs">
          {footer}
        </div>
      ) : null}
    </div>
  );
};

const ChatHeader: FC<{
  view: ChatView;
  onViewChange: (view: ChatView) => void;
  end?: ReactNode;
  signedIn: boolean;
}> = ({ view, onViewChange, end, signedIn }) => {
  const { features } = useChatContext();
  const title = useAuiState((s) => s.threadListItem.title);
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownViewRef = useRef(view);

  // Switching view moves the content under an unmoved focus ring; send focus to
  // the heading so a screen reader announces what is now on screen — but only
  // when focus was nowhere in particular, never stealing it from a control.
  useEffect(() => {
    if (shownViewRef.current === view) return;
    shownViewRef.current = view;
    const heading = titleRef.current;
    const active = document.activeElement;
    if (active === document.body || active === heading?.closest("[role='dialog']")) {
      heading?.focus();
    }
  }, [view]);

  // A one-tap toggle: the button that opened a view closes it again.
  const toggle = (target: ChatView) => () => onViewChange(view === target ? 'thread' : target);

  return (
    <div className="t2v-chat-header aui-modal-header border-foreground/10 flex h-11 shrink-0 items-center gap-2 border-b ps-3.5 pe-2">
      <h2
        ref={titleRef}
        tabIndex={-1}
        className="aui-modal-title min-w-0 flex-1 truncate text-[13px] font-medium outline-none"
      >
        {view === 'thread' ? title || VIEW_TITLES.thread : VIEW_TITLES[view]}
      </h2>
      <div className="flex shrink-0 items-center gap-0.5">
        {features.account && (
          <TooltipIconButton
            // "Account" in both states. An icon-only button's name should say
            // where it goes, and "Sign in" here collided with the account form's
            // own submit button — two controls, one name, two different actions.
            tooltip="Account"
            side="bottom"
            aria-pressed={view === 'account'}
            className={cn(HEADER_BUTTON, 'relative')}
            onClick={toggle('account')}
          >
            <UserRoundIcon className="size-3.5" />
            {/* A Teal dot: signed in. Guests and new visitors get the plain icon. */}
            {signedIn ? (
              <span
                aria-hidden="true"
                className="bg-primary absolute end-1 top-1 size-1.5 rounded-full max-sm:end-2 max-sm:top-2"
              />
            ) : null}
          </TooltipIconButton>
        )}
        {features.settings && (
          <TooltipIconButton
            tooltip="Settings"
            side="bottom"
            aria-pressed={view === 'settings'}
            className={HEADER_BUTTON}
            onClick={toggle('settings')}
          >
            <SettingsIcon className="size-3.5" />
          </TooltipIconButton>
        )}
        {features.threadList && (
          <TooltipIconButton
            tooltip="Threads"
            side="bottom"
            aria-pressed={view === 'list'}
            disabled={!hasThreads && view === 'thread'}
            className={HEADER_BUTTON}
            onClick={toggle('list')}
          >
            <HistoryIcon className="size-3.5" />
          </TooltipIconButton>
        )}
        <ThreadListPrimitive.New
          render={
            <TooltipIconButton
              tooltip="New Thread"
              side="bottom"
              className={HEADER_BUTTON}
              onClick={() => onViewChange('thread')}
            />
          }
        >
          <PlusIcon className="size-3.5" />
        </ThreadListPrimitive.New>
        {end}
      </div>
    </div>
  );
};

/* 28px on a mouse, 36px under a finger — the touch target, not the icon. */
const HEADER_BUTTON =
  'text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground size-7 max-sm:size-9 rounded-md p-0';
