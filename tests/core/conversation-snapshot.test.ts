/**
 * Taking a conversation out of the client and putting it back.
 *
 * This is the seam the packaged chat's conversation list is built on: switching
 * away has to keep everything needed to carry on — what is displayed, what the
 * model is told, and the engine's thread id — and switching away must not
 * delete a session somebody may come back to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index';
import type { ChatEvent } from '../../src/types';

const request = vi.fn();

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: (...args: unknown[]) => request(...args),
    streamRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({ onAuthStateChange: vi.fn() })),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({ reRegister: vi.fn().mockResolvedValue(null) })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
  // A stub that answers the whole surface the client uses: createSession
  // re-registers the end-user's skills, so a bare {} breaks every test
  // that starts a session.
  T2VSkills: vi.fn().mockImplementation(() => ({
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  })),
}));

const text = (content: string): ChatEvent => ({ type: 'text', content });
const done = (threadId = 'th_1'): ChatEvent => ({ type: 'done', threadId });

/** Script `chat()` so each send yields one of `streams`. */
function scripted(t2v: Talk2View, streams: ChatEvent[][]): void {
  let next = 0;
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
    const events = streams[next++] ?? [];
    return (async function* () {
      for (const event of events) yield event;
    })();
  }) as never);
}

let t2v: Talk2View;

beforeEach(() => {
  request.mockReset().mockResolvedValue({
    session_id: 'sess_1',
    thread_id: 'th_1',
    model: 'm',
  });
  t2v = new Talk2View({ partnerKey: 'pk_test_x', anonymousAutoStart: false });
});

describe('exportConversation / restoreConversation', () => {
  it('round-trips the messages, the history and the thread id', async () => {
    scripted(t2v, [[text('Hello.'), done('th_9')]]);
    await t2v.sendMessage('Hi');

    const snapshot = t2v.exportConversation();
    expect(snapshot.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello.'],
    ]);
    expect(snapshot.history).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello.' },
    ]);
    expect(snapshot.threadId).toBe('th_9');

    t2v.restoreConversation({ messages: [], history: [], threadId: null });
    expect(t2v.messages).toEqual([]);
    expect(t2v.threadId).toBeNull();

    t2v.restoreConversation(snapshot);
    expect(t2v.messages.map((m) => m.content)).toEqual(['Hi', 'Hello.']);
    expect(t2v.threadId).toBe('th_9');

    // The history is what proves the conversation can be carried on: the next
    // turn replays it, which is why a restored conversation does not need the
    // engine to remember anything.
    scripted(t2v, [[text('Still here.'), done()]]);
    const chat = vi.spyOn(t2v, 'chat' as never);
    await t2v.sendMessage('And?');
    expect((chat.mock.calls[0] as unknown[])[1]).toMatchObject({
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello.' },
      ],
    });
  });

  it('hands back copies, so the caller cannot edit the live conversation', async () => {
    scripted(t2v, [[text('One.'), done()]]);
    await t2v.sendMessage('Hi');

    const snapshot = t2v.exportConversation();
    snapshot.messages.push({ id: 'x', role: 'user', content: 'not really', timestamp: new Date() });
    snapshot.history.push({ role: 'user', content: 'nor this' });

    expect(t2v.messages).toHaveLength(2);
    expect(t2v.exportConversation().history).toHaveLength(2);
  });

  it('clears the error, the loading flag and a waiting approval', async () => {
    scripted(t2v, [
      [
        {
          type: 'approval_required',
          toolName: 'do_it',
          toolCallId: 'call_1',
          arguments: {},
          description: '',
        },
      ],
    ]);
    await t2v.sendMessage('go');
    expect(t2v.pendingApproval).not.toBeNull();

    t2v.restoreConversation({ messages: [], history: [], threadId: null });
    expect(t2v.pendingApproval).toBeNull();
    expect(t2v.isLoading).toBe(false);
    expect(t2v.error).toBeNull();
    expect(t2v.agentStatus).toBeNull();
  });

  it('forgets the tools the end-user allowed for the session', async () => {
    scripted(t2v, [
      [
        {
          type: 'approval_required',
          toolName: 'do_it',
          toolCallId: 'call_1',
          arguments: {},
          description: '',
        },
      ],
    ]);
    vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() =>
      (async function* () {
        yield done();
      })()) as never);
    await t2v.sendMessage('go');
    await t2v.approveToolCall({ action: 'always' });
    expect(t2v.alwaysAllowedTools.has('do_it')).toBe(true);

    t2v.restoreConversation(t2v.exportConversation());
    expect(t2v.alwaysAllowedTools.size).toBe(0);
  });

  it('leaves reload pointing at the restored conversation, not the one before it', async () => {
    scripted(t2v, [[text('First answer.'), done()]]);
    await t2v.sendMessage('First question');
    const first = t2v.exportConversation();

    t2v.restoreConversation({ messages: [], history: [], threadId: null });
    t2v.restoreConversation(first);

    scripted(t2v, [[text('Second answer.'), done()]]);
    await t2v.retryLastMessage();
    expect(t2v.messages.map((m) => m.content)).toEqual(['First question', 'Second answer.']);
  });

  it('keeps a reply that is still streaming out of the conversation that replaces it', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* () {
        yield text('half a repl');
        await held;
        yield text('y that nobody wants');
        yield done('th_late');
      })()) as never);

    const sending = t2v.sendMessage('go');
    await Promise.resolve();

    t2v.restoreConversation({ messages: [], history: [], threadId: null });
    release!();
    await sending;

    expect(t2v.messages).toEqual([]);
    expect(t2v.threadId).toBeNull();
    expect(t2v.error).toBeNull();
    // The abandoned turn must not have recorded itself in the new conversation.
    expect(t2v.exportConversation().history).toEqual([]);
  });
});

describe('detachSession', () => {
  it('does not delete the session on the server', async () => {
    await t2v.createSession();
    request.mockClear();

    t2v.detachSession();

    expect(t2v.getSession()).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('tells session-clear listeners, so client tools re-register on the next one', () => {
    const listener = vi.fn();
    t2v.onSessionClear(listener);
    t2v.detachSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is what restoring uses — unlike clearMessages, which does delete it', async () => {
    await t2v.createSession();
    request.mockClear();
    t2v.restoreConversation({ messages: [], history: [], threadId: null });
    expect(t2v.getSession()).toBeNull();
    expect(request).not.toHaveBeenCalled();

    await t2v.createSession();
    request.mockClear();
    t2v.clearMessages();
    expect(request).toHaveBeenCalledWith('/v1/sessions/sess_1', { method: 'DELETE' });
  });
});
