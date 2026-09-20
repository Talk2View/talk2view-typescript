/**
 * The storage half of the conversation list: what is kept, what is dropped when
 * there is too much of it, and what happens when the value in `localStorage` is
 * not what we put there.
 *
 * Anything stored in a browser is shared with whatever else runs on that origin
 * and survives longer than any assumption about it, so the read path is tested
 * against rubbish as well as against what it wrote.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CHARS,
  MAX_CONVERSATIONS,
  MAX_IDENTITIES,
  identityKey,
  readConversations,
  storageKey,
  titleFrom,
  writeConversations,
  type Conversation,
} from '../../src/chat/lib/conversation-store';
import type { DisplayMessage } from '../../src/types';

const PARTNER = 'pk_test_x';
const ME = identityKey('u1');

beforeEach(() => {
  localStorage.clear();
});

function message(role: 'user' | 'assistant', content: string, id = `m_${content}`): DisplayMessage {
  return { id, role, content, timestamp: new Date('2026-09-19T00:00:00Z') };
}

function conversation(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Title ${id}`,
    createdAt: 1_000,
    updatedAt: 1_000,
    snapshot: {
      messages: [message('user', `question ${id}`), message('assistant', `answer ${id}`)],
      history: [
        { role: 'user', content: `question ${id}` },
        { role: 'assistant', content: `answer ${id}` },
      ],
      threadId: `th_${id}`,
    },
    ...over,
  };
}

describe('a conversation through storage and back', () => {
  it('keeps the transcript, the history and the thread id', () => {
    expect(writeConversations(PARTNER, ME, [conversation('a')], 'a')).toBe(true);

    const [read] = readConversations(PARTNER, ME);
    expect(read).toMatchObject({ id: 'a', title: 'Title a' });
    expect(read!.snapshot.threadId).toBe('th_a');
    expect(read!.snapshot.history).toEqual([
      { role: 'user', content: 'question a' },
      { role: 'assistant', content: 'answer a' },
    ]);
    expect(read!.snapshot.messages.map((m) => m.content)).toEqual(['question a', 'answer a']);
    // A date, not the string JSON turned it into: the thread renders it.
    expect(read!.snapshot.messages[0]!.timestamp).toBeInstanceOf(Date);
  });

  it('does not bring a half-written reply back as one that is still writing', () => {
    const streaming = conversation('a');
    streaming.snapshot.messages[1] = { ...streaming.snapshot.messages[1]!, isStreaming: true };
    writeConversations(PARTNER, ME, [streaming], 'a');

    const [read] = readConversations(PARTNER, ME);
    expect(read!.snapshot.messages[1]!.isStreaming).toBeUndefined();
  });

  it('gives each identity its own, and shows one nothing of the other', () => {
    writeConversations(PARTNER, ME, [conversation('mine')], 'mine');
    writeConversations(PARTNER, identityKey('u2'), [conversation('theirs')], 'theirs');

    expect(readConversations(PARTNER, ME).map((c) => c.id)).toEqual(['mine']);
    expect(readConversations(PARTNER, identityKey('u2')).map((c) => c.id)).toEqual(['theirs']);
    // …and a guest, who has an id of their own, sees neither.
    expect(readConversations(PARTNER, identityKey('guest-77'))).toEqual([]);
  });

  it('writing one identity leaves the others where they are', () => {
    writeConversations(PARTNER, identityKey('u2'), [conversation('theirs')], 'theirs');
    writeConversations(PARTNER, ME, [conversation('mine')], 'mine');

    expect(readConversations(PARTNER, identityKey('u2')).map((c) => c.id)).toEqual(['theirs']);
  });

  it('keeps partners apart', () => {
    writeConversations(PARTNER, ME, [conversation('a')], 'a');
    expect(readConversations('pk_other', ME)).toEqual([]);
  });

  it('orders newest first', () => {
    writeConversations(
      PARTNER,
      ME,
      [
        conversation('old', { updatedAt: 1 }),
        conversation('new', { updatedAt: 3 }),
        conversation('middle', { updatedAt: 2 }),
      ],
      'new',
    );
    expect(readConversations(PARTNER, ME).map((c) => c.id)).toEqual(['new', 'middle', 'old']);
  });
});

describe('what it refuses to trust', () => {
  it('reads nothing from a value that is not ours, rather than throwing', () => {
    localStorage.setItem(storageKey(PARTNER), 'not json at all');
    expect(readConversations(PARTNER, ME)).toEqual([]);

    localStorage.setItem(storageKey(PARTNER), '[1,2,3]');
    expect(readConversations(PARTNER, ME)).toEqual([]);

    localStorage.setItem(storageKey(PARTNER), '{"identities":"nope"}');
    expect(readConversations(PARTNER, ME)).toEqual([]);
  });

  it('drops the conversations that do not check out and keeps the ones that do', () => {
    localStorage.setItem(
      storageKey(PARTNER),
      JSON.stringify({
        v: 1,
        identities: {
          [ME]: {
            updatedAt: 1,
            conversations: [
              { id: 'good', title: 'Fine', createdAt: 1, updatedAt: 2, threadId: null, messages: [], history: [] },
              { title: 'no id' },
              'a string',
              null,
              { id: 'alsogood', createdAt: 1, updatedAt: 1, messages: 'not an array', history: { no: 1 } },
            ],
          },
        },
      }),
    );

    const read = readConversations(PARTNER, ME);
    expect(read.map((c) => c.id)).toEqual(['good', 'alsogood']);
    expect(read[1]!.snapshot.messages).toEqual([]);
    expect(read[1]!.snapshot.history).toEqual([]);
  });

  it('drops a message with the wrong shape and keeps its neighbours', () => {
    localStorage.setItem(
      storageKey(PARTNER),
      JSON.stringify({
        v: 1,
        identities: {
          [ME]: {
            updatedAt: 1,
            conversations: [
              {
                id: 'a',
                createdAt: 1,
                updatedAt: 1,
                messages: [
                  { id: 'm1', role: 'user', content: 'kept', timestamp: '2026-09-19T00:00:00Z' },
                  { id: 'm2', role: 'wizard', content: 'dropped', timestamp: '2026-09-19T00:00:00Z' },
                  { id: 'm3', role: 'assistant', content: 42 },
                  { id: 'm4', role: 'assistant', content: 'kept too', timestamp: 'nonsense' },
                ],
                history: [
                  { role: 'user', content: 'kept' },
                  { role: 'user' },
                  { role: 'assistant', content: [{ type: 'text', text: 'parts are allowed' }] },
                ],
              },
            ],
          },
        },
      }),
    );

    const [read] = readConversations(PARTNER, ME);
    expect(read!.snapshot.messages.map((m) => m.content)).toEqual(['kept', 'kept too']);
    expect(read!.snapshot.history).toHaveLength(2);
    // An unparseable date still has to be a Date, or the list cannot group it.
    expect(read!.snapshot.messages[1]!.timestamp).toBeInstanceOf(Date);
  });

  it('carries on with no history when localStorage refuses to answer', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(readConversations(PARTNER, ME)).toEqual([]);
      expect(writeConversations(PARTNER, ME, [conversation('a')], 'a')).toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('says so when the quota refuses the write', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(writeConversations(PARTNER, ME, [conversation('a')], 'a')).toBe(false);
    } finally {
      set.mockRestore();
    }
  });
});

describe('the caps', () => {
  it('keeps the newest MAX_CONVERSATIONS and drops the rest', () => {
    const many = Array.from({ length: MAX_CONVERSATIONS + 10 }, (_, i) =>
      conversation(`c${i}`, { updatedAt: i }),
    );
    writeConversations(PARTNER, ME, many, `c${many.length - 1}`);

    const read = readConversations(PARTNER, ME);
    expect(read).toHaveLength(MAX_CONVERSATIONS);
    expect(read[0]!.id).toBe(`c${many.length - 1}`);
    expect(read.some((c) => c.id === 'c0')).toBe(false);
  });

  it('keeps the stored entry under the size ceiling, oldest first', () => {
    // Each conversation is a few kilobytes, so the ceiling binds well before
    // the count does.
    const big = (id: string, updatedAt: number): Conversation => {
      const c = conversation(id, { updatedAt });
      c.snapshot.messages = [message('assistant', 'x'.repeat(30_000), `m_${id}`)];
      c.snapshot.history = [{ role: 'assistant', content: 'x'.repeat(30_000) }];
      return c;
    };
    const many = Array.from({ length: 40 }, (_, i) => big(`c${i}`, i));

    expect(writeConversations(PARTNER, ME, many, 'c39')).toBe(true);
    expect(localStorage.getItem(storageKey(PARTNER))!.length).toBeLessThanOrEqual(MAX_CHARS);

    const read = readConversations(PARTNER, ME);
    expect(read.length).toBeLessThan(40);
    // The one on screen survives, and the newest survive with it.
    expect(read.map((c) => c.id)).toContain('c39');
    expect(read.map((c) => c.id)).not.toContain('c0');
  });

  it('gives up another identity’s conversations before any of this one’s', () => {
    const bulk = (id: string) => {
      const c = conversation(id);
      c.snapshot.history = [{ role: 'assistant', content: 'x'.repeat(200_000) }];
      return c;
    };
    writeConversations(PARTNER, identityKey('someone-else'), [bulk('theirs')], null);
    writeConversations(PARTNER, ME, [bulk('mine-1'), bulk('mine-2')], 'mine-1');

    expect(readConversations(PARTNER, ME).map((c) => c.id)).toContain('mine-1');
    expect(readConversations(PARTNER, identityKey('someone-else'))).toEqual([]);
  });

  it('keeps at most MAX_IDENTITIES buckets, least recently used going first', () => {
    // A bucket is dated by the wall clock when it was written, and the whole
    // loop below would otherwise land in the same millisecond.
    let clock = 1_700_000_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    try {
      for (let i = 0; i < MAX_IDENTITIES + 3; i++) {
        writeConversations(PARTNER, identityKey(`u${i}`), [conversation(`c${i}`)], `c${i}`);
      }
    } finally {
      now.mockRestore();
    }
    const kept = Array.from({ length: MAX_IDENTITIES + 3 }, (_, i) =>
      readConversations(PARTNER, identityKey(`u${i}`)),
    ).filter((list) => list.length > 0);

    expect(kept).toHaveLength(MAX_IDENTITIES);
    // The oldest bucket is the one that went.
    expect(readConversations(PARTNER, identityKey('u0'))).toEqual([]);
  });

  it('forgets an identity entirely when its last conversation is deleted', () => {
    writeConversations(PARTNER, ME, [conversation('a')], 'a');
    writeConversations(PARTNER, ME, [], null);
    expect(readConversations(PARTNER, ME)).toEqual([]);
    expect(localStorage.getItem(storageKey(PARTNER))).not.toContain(ME);
  });
});

describe('titles', () => {
  it('comes from the first user message', () => {
    expect(titleFrom(message('user', 'What is in this report?'))).toBe('What is in this report?');
  });

  it('is one line', () => {
    expect(titleFrom(message('user', '  Summarise\n\nthis   report  '))).toBe('Summarise this report');
  });

  it('cuts a long one at a word', () => {
    const long = 'Summarise the findings section of this chest study and tell me what changed since March';
    const title = titleFrom(message('user', long))!;
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/ …$/);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('cuts a single enormous word rather than giving up on it', () => {
    const title = titleFrom(message('user', 'z'.repeat(200)))!;
    expect(title).toBe('z'.repeat(60) + '…');
  });

  it('falls back to the attached file when there are no words', () => {
    const withFile: DisplayMessage = {
      ...message('user', '   '),
      attachments: [{ id: 'a1', filename: 'chest-ct.pdf', mime_type: 'application/pdf', size_bytes: 1 }],
    };
    expect(titleFrom(withFile)).toBe('chest-ct.pdf');
  });

  it('is null when there is nothing to make one from', () => {
    expect(titleFrom(undefined)).toBeNull();
    expect(titleFrom(message('user', ''))).toBeNull();
  });
});
