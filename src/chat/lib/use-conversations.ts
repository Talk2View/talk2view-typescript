'use client';

/**
 * The chat's list of conversations: what "New chat" starts, what the Chats view
 * shows, and what survives a reload.
 *
 * It owns the list and hands assistant-ui a thread-list adapter for it. The
 * runtime stays dumb: it passes the adapter through and knows nothing about
 * storage. {@link conversation-store} is the storage half.
 *
 * ## What happens when
 *
 * - **New chat** — the conversation on screen is kept where it is and an empty
 *   one takes its place. Clicking it again on an empty chat does nothing, so
 *   the list does not fill up with blanks.
 * - **Switching** — the client is handed the stored transcript and the engine
 *   session is detached, not deleted: the visitor may switch back, and the turn
 *   it is running may not be finished. The next message opens a new session and
 *   replays the transcript into it.
 * - **Signing in or out** — the list follows the end-user. Whoever is there now
 *   sees their own conversations and an empty chat, never the last person's.
 *   The one exception is a visitor who started typing before anything
 *   authenticated: their conversation moves across with them when the guest
 *   session appears, because it was theirs all along.
 * - **A guest becoming an account** — nothing moves. Converting keeps the same
 *   user id, so the conversations are already in the right bucket.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExternalStoreThreadData, ExternalStoreThreadListAdapter } from '@assistant-ui/react';
import type { Talk2View } from '../../index.js';
import type { ConversationSnapshot, DisplayMessage } from '../../types.js';
import {
  UNTITLED,
  identityKey,
  readConversations,
  titleFrom,
  writeConversations,
  type Conversation,
} from './conversation-store.js';

/**
 * Written this long after the last change, so a reply is stored once when it
 * lands and not once per token.
 */
const WRITE_DELAY_MS = 500;

/**
 * …but never delayed longer than this. A reply that streams for a minute is
 * checkpointed as it goes, so a reload in the middle of one keeps what arrived.
 */
const WRITE_MAX_DELAY_MS = 5_000;

const EMPTY: ConversationSnapshot = { messages: [], history: [], threadId: null };

/**
 * assistant-ui's thread data, plus the field its own list groups by.
 * `ExternalStoreThreadData` does not declare `lastMessageAt`, but the runtime
 * spreads every thread into the item state, where it is declared and where the
 * vendored list reads it to bucket conversations into Today / Yesterday /
 * Earlier.
 */
type ThreadData = ExternalStoreThreadData<'regular'> & { lastMessageAt: Date };

interface Store {
  identity: string;
  /** Newest first — the order the list is shown in. */
  conversations: Conversation[];
  currentId: string;
  /** How many messages the current conversation had when its title and date were last set. */
  seen: number;
  /**
   * Conversations begun in front of us, in this page's life, rather than found
   * in storage. Only one of these follows the end-user when they sign in: a
   * conversation read back from a guest bucket may be an earlier visitor's, and
   * it must not walk into somebody else's account.
   */
  fresh: Set<string>;
  /**
   * Whether the identity above is a guest or nobody at all, recorded when it
   * was adopted. `auth.isAnonymous()` cannot answer this later: by the time a
   * sign-in reaches us it already describes the account, not the guest who was
   * there a moment before.
   */
  guest: boolean;
}

/**
 * The thread-list adapter for `adapters.threadList`.
 *
 * With `enabled` false there is no list and nothing is stored, but New chat
 * still works: it clears the conversation the way it always did, deleting the
 * engine session too, because with no list there is no way back to it.
 */
export function useConversations(
  client: Talk2View,
  { enabled }: { enabled: boolean },
): ExternalStoreThreadListAdapter {
  const partnerKey = client.config.partnerKey;

  // A mutable store plus a counter to re-render on: the snapshot of the
  // conversation on screen changes on every streamed token, and the list only
  // changes when a conversation is added, renamed, deleted or gains a message.
  // Keeping them apart is what stops a reply repainting the list 60 times.
  const store = useRef<Store | null>(null);
  const [, setListVersion] = useState(0);
  const publish = useCallback(() => setListVersion((n) => n + 1), []);

  // Once, on the first render. Deliberately not in an effect: `start` may put a
  // stored conversation back into the client, and the runtime reads the client's
  // messages as its own initial state on this same render. Restoring later would
  // paint the welcome screen first and replace it a frame afterwards. Nothing is
  // subscribed to the client yet at this point — this hook is called before the
  // runtime's — so the change this publishes reaches no other component.
  if (store.current === null) {
    store.current = start(client, partnerKey, enabled);
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oldestPending = useRef(0);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    oldestPending.current = 0;
    const s = store.current!;
    if (!enabled) return;
    writeConversations(partnerKey, s.identity, s.conversations, s.currentId);
  }, [enabled, partnerKey]);

  const schedule = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    if (oldestPending.current === 0) oldestPending.current = now;
    if (timer.current !== null) clearTimeout(timer.current);
    const wait = Math.min(WRITE_DELAY_MS, Math.max(0, oldestPending.current + WRITE_MAX_DELAY_MS - now));
    timer.current = setTimeout(flush, wait);
  }, [enabled, flush]);

  // Closing the tab, or a phone putting the page to sleep, does not wait for a
  // debounce. `pagehide` is the one that fires on the bfcache path too.
  useEffect(() => {
    const onHide = () => {
      if (timer.current !== null) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      // An unmount mid-debounce would otherwise drop the last change.
      if (timer.current !== null) flush();
    };
  }, [flush]);

  // ── Keeping the conversation on screen up to date ────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      const s = store.current!;
      const current = s.conversations.find((c) => c.id === s.currentId);
      if (!current) return;
      const snapshot = client.exportConversation();
      current.snapshot = snapshot;

      // Title and date move when the transcript gains a message, not when the
      // reply in it grows by a token.
      if (snapshot.messages.length !== s.seen) {
        s.seen = snapshot.messages.length;
        current.updatedAt = Date.now();
        if (current.title === null) current.title = titleFrom(firstUser(snapshot.messages));
        reorder(s);
        publish();
      }
      schedule();
    };
    const offs = [
      client.on('messagesChange', sync),
      // The last thing a turn does is record itself in the history the next
      // message replays, and it does that after its final message change — so a
      // snapshot taken on messages alone is one assistant turn short of being
      // able to carry the conversation on. The loading flag drops after it.
      client.on('loadingChange', (loading) => {
        if (!loading) sync();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, enabled, publish, schedule]);

  // ── Identity ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    return client.auth.onAuthStateChange((user) => {
      const s = store.current!;
      const next = identityKey(user?.id);
      if (next === s.identity) return;

      // The conversation on screen follows the end-user across exactly one
      // step: out of a guest session, or out of no session at all, into the
      // account they have just signed in to. That is the same person carrying
      // on — the visitor who typed before anything authenticated, and the guest
      // who signed up because the demo ran out.
      //
      // It has to be a conversation they started here, in this page's life: one
      // read back out of a guest bucket may be the last visitor's, and it must
      // not walk into somebody else's account. And it never crosses from one
      // account to another, where the two are simply different people.
      const carried =
        s.guest && s.fresh.has(s.currentId)
          ? s.conversations.find((c) => c.id === s.currentId)
          : undefined;

      // What the previous identity keeps, written before we let go of it. A
      // conversation that moves is taken out of it rather than left in both.
      const left = carried ? s.conversations.filter((c) => c.id !== carried.id) : s.conversations;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      oldestPending.current = 0;
      writeConversations(partnerKey, s.identity, left, null);

      s.identity = next;
      s.guest = isGuest(client, next);
      s.conversations = readConversations(partnerKey, next);
      if (carried) {
        s.conversations.unshift(carried);
        reorder(s);
        s.seen = client.messages.length;
      } else {
        // Somebody else is in front of the chat now. They get their own list and
        // an empty conversation; the last person's goes off the screen.
        blank(s);
        client.restoreConversation(EMPTY);
      }
      publish();
      flush();
    });
  }, [client, enabled, flush, partnerKey, publish]);

  // ── The adapter ──────────────────────────────────────────────────────────
  const s = store.current;

  const threads = useMemo<ThreadData[]>(
    () =>
      s.conversations
        // An empty conversation is not one yet. Leaving it out is what keeps
        // the Chats button off until there is something behind it, and stops
        // the list opening on a single row saying "New chat".
        .filter((c) => c.snapshot.messages.length > 0)
        .map(
          (c): ThreadData => ({
            id: c.id,
            status: 'regular',
            // Never left to assistant-ui's own fallback, so one word decides
            // what an untitled conversation is called.
            title: c.title ?? UNTITLED,
            lastMessageAt: new Date(c.updatedAt),
          }),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.conversations],
  );

  const onSwitchToNewThread = useCallback(() => {
    if (!enabled) {
      // No list, so no way back: end the session rather than leave it behind.
      client.clearMessages();
      return;
    }
    const s = store.current!;
    const current = s.conversations.find((c) => c.id === s.currentId);
    // Already on an empty chat. Pressing New again should not stack up blanks.
    if (current && current.snapshot.messages.length === 0) return;
    blank(s);
    client.restoreConversation(EMPTY);
    s.seen = 0;
    publish();
    flush();
  }, [client, enabled, flush, publish]);

  const onSwitchToThread = useCallback(
    (id: string) => {
      const s = store.current!;
      const target = s.conversations.find((c) => c.id === id);
      if (!target || id === s.currentId) return;
      s.currentId = id;
      s.seen = target.snapshot.messages.length;
      client.restoreConversation(target.snapshot);
      publish();
      flush();
    },
    [client, flush, publish],
  );

  const onRename = useCallback(
    (id: string, title: string) => {
      const s = store.current!;
      const target = s.conversations.find((c) => c.id === id);
      if (!target) return;
      // Renaming does not count as activity: the conversation keeps its place
      // in the list instead of jumping to the top of it.
      target.title = title.trim() || null;
      // A new array, or the adapter would hand assistant-ui the one it already
      // has and the new name would never reach the screen.
      reorder(s);
      publish();
      flush();
    },
    [flush, publish],
  );

  const onDelete = useCallback(
    (id: string) => {
      const s = store.current!;
      s.conversations = s.conversations.filter((c) => c.id !== id);
      if (id === s.currentId) {
        blank(s);
        client.restoreConversation(EMPTY);
        s.seen = 0;
      }
      publish();
      flush();
    },
    [client, flush, publish],
  );

  return useMemo<ExternalStoreThreadListAdapter>(
    () =>
      enabled
        ? {
            threadId: s.currentId,
            threads,
            onSwitchToNewThread,
            onSwitchToThread,
            onRename,
            onDelete,
          }
        : { onSwitchToNewThread },
    [enabled, s.currentId, threads, onSwitchToNewThread, onSwitchToThread, onRename, onDelete],
  );
}

// ── The store ──────────────────────────────────────────────────────────────

/**
 * The list as it stands when the chat mounts.
 *
 * A client handed to the chat may already be holding a conversation — a partner
 * sharing one client with the rest of their app, or a chat that unmounted and
 * came back. That transcript is adopted rather than thrown away: into the
 * stored conversation it came from where the last message identifies one, and
 * into a new conversation where it does not.
 */
function start(client: Talk2View, partnerKey: string, enabled: boolean): Store {
  const identity = identityKey(client.auth.getUser?.()?.id);
  const conversations = enabled ? readConversations(partnerKey, identity) : [];
  const messages = client.messages;
  const store: Store = {
    identity,
    conversations,
    currentId: '',
    seen: 0,
    fresh: new Set(),
    guest: isGuest(client, identity),
  };

  if (messages.length > 0) {
    // A transcript already in the client is one somebody is in the middle of,
    // so it counts as started here however it got there.
    const lastId = messages[messages.length - 1]!.id;
    const known = conversations.find(
      (c) => c.snapshot.messages[c.snapshot.messages.length - 1]?.id === lastId,
    );
    const conversation =
      known ??
      ({
        id: newId(),
        title: titleFrom(firstUser(messages)),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        snapshot: client.exportConversation(),
      } satisfies Conversation);
    if (known) known.snapshot = client.exportConversation();
    else conversations.unshift(conversation);
    store.currentId = conversation.id;
    store.seen = messages.length;
    store.fresh.add(conversation.id);
    return store;
  }

  // Nothing on screen: pick up where this device left off. The transcript is
  // put back locally — the engine is not asked for anything and does not need
  // to remember it. Not marked as started here: it may be an earlier visitor's.
  const newest = conversations[0];
  if (newest) {
    client.restoreConversation(newest.snapshot);
    store.currentId = newest.id;
    store.seen = newest.snapshot.messages.length;
    return store;
  }

  blank(store);
  return store;
}

/** Put a fresh, empty conversation at the top of the list and make it the current one. */
function blank(store: Store): void {
  const conversation: Conversation = {
    id: newId(),
    title: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    snapshot: { messages: [], history: [], threadId: null },
  };
  store.conversations = [conversation, ...store.conversations];
  store.currentId = conversation.id;
  store.seen = 0;
  store.fresh.add(conversation.id);
}

/** Newest first, and a new array so the adapter's `threads` is seen to have changed. */
function reorder(store: Store): void {
  store.conversations = [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

function firstUser(messages: readonly DisplayMessage[]): DisplayMessage | undefined {
  return messages.find((m) => m.role === 'user');
}

/** Whether there is no account behind this identity: a guest, or nobody yet. */
function isGuest(client: Talk2View, identity: string): boolean {
  return identity === identityKey(null) || client.auth.isAnonymous?.() === true;
}

/**
 * `crypto.randomUUID` needs a secure context, which a partner's staging page on
 * plain http is not. The id only has to be unique inside one browser's storage.
 */
function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
