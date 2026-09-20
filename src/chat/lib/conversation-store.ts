/**
 * Earlier conversations, kept in the browser.
 *
 * The engine does not keep them. Its agent checkpointer is in-memory and it has
 * no API to list or fetch a past conversation, so there is nothing server-side
 * to read. It does not need to: the client replays the whole transcript with
 * every message (`sendMessage` → `chat({ history })` → `sessions.ts`), so a
 * conversation restored from here continues correctly even after a deploy.
 *
 * This module is the storage half — no React, no client, so the caps and the
 * validation can be tested directly. {@link useConversations} owns the list.
 *
 * ## Shape
 *
 * One `localStorage` entry per partner key, holding one bucket per identity:
 *
 * ```
 * t2v_chat_conversations_v1:<partnerKey>
 *   { v: 1, identities: { "u:<userId>": { updatedAt, conversations: [ … ] } } }
 * ```
 *
 * One entry rather than one per conversation because the thing that actually
 * fails is the origin's storage quota, and a quota is only enforceable against
 * the string you are about to write. Writes are read-modify-write, so two tabs
 * signed in as different people keep each other's buckets.
 *
 * ## Identity
 *
 * The bucket is the end-user's id and nothing else — not whether they are a
 * guest. A guest has an id of their own, so a guest and a signed-in person on
 * one device land in different buckets, as do two accounts. Converting a guest
 * into an account keeps the same id (`POST /v1/auth/convert`), so the
 * conversations survive the conversion without being moved.
 */
import type { ChatMessage, ConversationSnapshot, DisplayMessage } from '../../types.js';

/** What the thread list shows for a conversation with no first message yet. */
export const UNTITLED = 'New chat';

/**
 * Per identity. Fifty is far more than anyone accumulates in a side panel, and
 * small enough to render in one list and to keep the stored blob modest. The
 * size ceiling below usually binds first.
 */
export const MAX_CONVERSATIONS = 50;

/**
 * Identity buckets kept per partner. Signing out and back in as a guest mints a
 * new anonymous id each time, so without this the entry would grow one dead
 * bucket per visit. Eight keeps a shared machine's recent users and drops the
 * rest, least recently used first.
 */
export const MAX_IDENTITIES = 8;

/**
 * Characters in the stored entry, across every identity. `localStorage` gives
 * an origin about 5 MB in every current browser, and the chat is a guest in the
 * partner's page — taking a tenth of their budget is the most it can justify.
 * A conversation of twenty substantial turns is about 20 KB, so this is roughly
 * twenty-five of them; the count cap above catches the short ones.
 */
export const MAX_CHARS = 512 * 1024;

/** Longest title kept; longer first messages are cut at a word boundary. */
const MAX_TITLE = 60;

const KEY_PREFIX = 't2v_chat_conversations_v1:';

/** One conversation, as the list holds it in memory. */
export interface Conversation {
  id: string;
  /** From the first user message. Null until there is one — shown as {@link UNTITLED}. */
  title: string | null;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, last change of any kind. Orders the list and decides what is dropped. */
  updatedAt: number;
  snapshot: ConversationSnapshot;
}

/** The `localStorage` entry for one partner key. */
export function storageKey(partnerKey: string): string {
  return KEY_PREFIX + partnerKey;
}

/**
 * The bucket for an end-user. `null` — nobody signed in and no guest session
 * yet — gets its own, which only ever holds the conversation a visitor started
 * before anything authenticated; {@link useConversations} moves that one across
 * when an id appears.
 */
export function identityKey(userId: string | null | undefined): string {
  return userId ? `u:${userId}` : 'none';
}

/**
 * A short title from the first user message: one line, cut at a word boundary.
 * Null when there is nothing to make one from — an attachment with no text, or
 * whitespace — and the caller shows {@link UNTITLED} instead.
 */
export function titleFrom(message: DisplayMessage | undefined): string | null {
  const text = (message?.content ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length <= MAX_TITLE ? text : cut(text);
  const file = message?.attachments?.[0]?.filename?.trim();
  return file ? (file.length <= MAX_TITLE ? file : cut(file)) : null;
}

function cut(text: string): string {
  const head = text.slice(0, MAX_TITLE);
  const space = head.lastIndexOf(' ');
  // Only break on a space if one is far enough in to leave a real title behind;
  // a first word longer than that is cut mid-word rather than thrown away.
  return (space > MAX_TITLE / 2 ? head.slice(0, space) : head).trimEnd() + '…';
}

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * This identity's conversations, newest first.
 *
 * Never throws and never trusts what it finds: a private window refuses
 * `localStorage` entirely, and the value itself is whatever anything else with
 * access to this origin last wrote there. Anything that does not validate is
 * dropped — one bad conversation, or the whole entry — and the chat carries on
 * with no history rather than not at all.
 */
export function readConversations(partnerKey: string, identity: string): Conversation[] {
  const file = readFile(partnerKey);
  const bucket = file?.identities?.[identity];
  if (!bucket) return [];
  return sortNewestFirst(
    asArray(bucket.conversations)
      .map(parseConversation)
      .filter((c): c is Conversation => c !== null),
  );
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * Replace this identity's conversations, keeping every other identity's as they
 * are on disk. Returns false when nothing could be stored (no `localStorage`,
 * or a quota that even the caps below could not get under), which the caller
 * treats as "this device does not keep history" rather than as a failure.
 *
 * `current` is the conversation on screen: it is the one the caps must never
 * drop, because dropping it would lose what the end-user is looking at.
 */
export function writeConversations(
  partnerKey: string,
  identity: string,
  conversations: readonly Conversation[],
  current: string | null,
): boolean {
  const file = readFile(partnerKey) ?? { v: 1 as const, identities: {} };
  const identities: StoredFile['identities'] = { ...file.identities };

  const mine = sortNewestFirst([...conversations]).slice(0, MAX_CONVERSATIONS);
  if (mine.length === 0) {
    delete identities[identity];
  } else {
    identities[identity] = { updatedAt: Date.now(), conversations: mine.map(serialise) };
  }

  // Least recently used identities go first: they are somebody else's old
  // visit, where this one is on screen.
  const ordered = Object.keys(identities)
    .filter((key) => key !== identity)
    .sort((a, b) => (identities[b]?.updatedAt ?? 0) - (identities[a]?.updatedAt ?? 0));
  for (const key of ordered.slice(MAX_IDENTITIES - 1)) delete identities[key];

  let json = JSON.stringify({ v: 1, identities });
  while (json.length > MAX_CHARS) {
    if (!dropOldest(identities, identity, current)) return remove(partnerKey);
    json = JSON.stringify({ v: 1, identities });
  }
  return write(partnerKey, json);
}

/**
 * Drop the single oldest conversation we are allowed to drop: another
 * identity's first, then this one's, and never the one on screen. False when
 * there is nothing left to give up.
 */
function dropOldest(
  identities: StoredFile['identities'],
  identity: string,
  current: string | null,
): boolean {
  const candidates: Array<{ key: string; index: number; mine: boolean; updatedAt: number }> = [];
  for (const [key, bucket] of Object.entries(identities)) {
    bucket.conversations.forEach((conversation, index) => {
      if (key === identity && conversation.id === current) return;
      candidates.push({
        key,
        index,
        mine: key === identity,
        updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : 0,
      });
    });
  }
  // Another identity's conversations go before any of this one's, however old:
  // what this end-user can still open is worth more than what they cannot.
  candidates.sort((a, b) => Number(a.mine) - Number(b.mine) || a.updatedAt - b.updatedAt);

  const victim = candidates[0];
  if (!victim) return false;
  const bucket = identities[victim.key]!;
  bucket.conversations = bucket.conversations.filter((_, i) => i !== victim.index);
  if (bucket.conversations.length === 0) delete identities[victim.key];
  return true;
}

/** Forget everything stored for this partner key. Always returns false: nothing is stored now. */
function remove(partnerKey: string): boolean {
  try {
    localStorage.removeItem(storageKey(partnerKey));
  } catch {
    // A private window, or storage the page is not allowed to touch at all.
  }
  return false;
}

function write(partnerKey: string, json: string): boolean {
  try {
    localStorage.setItem(storageKey(partnerKey), json);
    return true;
  } catch {
    // Out of quota even under the caps, or storage refused outright. The list
    // still works for the rest of this page's life; it just does not survive.
    return false;
  }
}

// ── Serialising ────────────────────────────────────────────────────────────

interface StoredFile {
  v: 1;
  identities: Record<string, { updatedAt: number; conversations: StoredConversation[] }>;
}

interface StoredConversation {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  threadId: string | null;
  messages: StoredMessage[];
  history: ChatMessage[];
}

type StoredMessage = Omit<DisplayMessage, 'timestamp' | 'isStreaming'> & { timestamp: string };

function serialise(conversation: Conversation): StoredConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    threadId: conversation.snapshot.threadId,
    messages: conversation.snapshot.messages.map((message) => {
      // `isStreaming` is deliberately dropped. A conversation left mid-reply is
      // stored with the text that had arrived; restoring it with the flag still
      // set would put a cursor on a message nothing is writing to.
      const { isStreaming: _isStreaming, timestamp, ...rest } = message;
      return { ...rest, timestamp: asDate(timestamp).toISOString() };
    }),
    history: conversation.snapshot.history,
  };
}

function readFile(partnerKey: string): StoredFile | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(partnerKey));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.identities)) return null;
    const identities: StoredFile['identities'] = {};
    for (const [key, value] of Object.entries(parsed.identities)) {
      if (!isRecord(value)) continue;
      identities[key] = {
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
        conversations: asArray(value.conversations) as StoredConversation[],
      };
    }
    return { v: 1, identities };
  } catch {
    return null;
  }
}

/**
 * One stored conversation, checked field by field. Anything missing or of the
 * wrong type means the record is not ours — a half-written value, an older
 * shape, or something hostile — and it is dropped rather than rendered.
 */
function parseConversation(value: unknown): Conversation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  const messages = asArray(value.messages)
    .map(parseMessage)
    .filter((m): m is DisplayMessage => m !== null);
  const history = asArray(value.history).filter(isChatMessage);
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title ? value.title : null,
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
    snapshot: {
      messages,
      history,
      threadId: typeof value.threadId === 'string' ? value.threadId : null,
    },
  };
}

function parseMessage(value: unknown): DisplayMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.content !== 'string') return null;
  if (value.role !== 'user' && value.role !== 'assistant') return null;
  const message: DisplayMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    timestamp: asDate(value.timestamp),
  };
  if (Array.isArray(value.attachments)) message.attachments = value.attachments as DisplayMessage['attachments'];
  if (typeof value.plan === 'string') message.plan = value.plan;
  if (Array.isArray(value.steps)) message.steps = value.steps as DisplayMessage['steps'];
  return message;
}

/** `role` and `content` are all the engine is sent; content may be parts, not a string. */
function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false;
  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') return false;
  return typeof value.content === 'string' || Array.isArray(value.content);
}

function asDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value : NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sortNewestFirst(conversations: Conversation[]): Conversation[] {
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}
