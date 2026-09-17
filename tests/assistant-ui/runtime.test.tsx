/**
 * assistant-ui's own primitives, driven by the Talk2View runtime.
 *
 * The engine is replaced by scripted event streams (the same technique as
 * tests/core/chat-state.test.ts); everything from the runtime down is real:
 * AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive, and our
 * ExternalStore adapter. If this passes, the stock <Thread /> works too — it is
 * built from the same primitives.
 */
import React, { useEffect } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  type AssistantRuntime,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request: vi.fn(), streamRequest: vi.fn() })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({ onAuthStateChange: vi.fn(), getUser: vi.fn().mockReturnValue(null) })),
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
import { useTalk2ViewRuntimeForClient, APPROVAL_OPTION_IDS } from '../../src/assistant-ui';
import type { Attachment, ChatEvent, ClientTool } from '../../src/types';

// ── jsdom lacks the layout APIs the primitives observe ──────────────────────
beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = (() => ({
    matches: false, media: '', onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// ── Scripted engine ─────────────────────────────────────────────────────────
const text = (content: string): ChatEvent => ({ type: 'text', content });
const done = (): ChatEvent => ({ type: 'done', threadId: 'th' });
const toolCall = (toolName: string, toolCallId: string, args = {}): ChatEvent => ({ type: 'tool_call', toolName, toolCallId, arguments: args });
const approvalRequired = (toolName: string, toolCallId: string, args = {}): ChatEvent =>
  ({ type: 'approval_required', toolName, toolCallId, arguments: args, description: `Run ${toolName}` });
const approvalResult = (toolName: string, decision: 'once' | 'always' | 'deny'): ChatEvent => ({ type: 'approval_result', toolName, decision });

function scripted(t2v: Talk2View, chatStreams: ChatEvent[][], approvalStreams: ChatEvent[][] = []) {
  let c = 0;
  let a = 0;
  const gen = (events: ChatEvent[]) => (async function* () { for (const e of events) yield e; })();
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() => gen(chatStreams[c++] ?? [])) as never);
  vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() => gen(approvalStreams[a++] ?? [])) as never);
}

// ── Minimal thread built from the primitives ────────────────────────────────
const Text = ({ text }: { text: string }) => <span data-testid="text">{text}</span>;

const ToolCall = (p: ToolCallMessagePartProps) => {
  const gate = p.approval && p.approval.approved === undefined;
  return (
    <div data-testid={`tool-${p.toolName}`} data-state={gate ? 'gate' : p.result !== undefined ? 'done' : 'running'}>
      {gate ? (
        <>
          <button onClick={() => p.respondToApproval({ optionId: APPROVAL_OPTION_IDS.once })}>Allow once</button>
          <button onClick={() => p.respondToApproval({ optionId: APPROVAL_OPTION_IDS.deny, text: 'No' })}>Deny</button>
        </>
      ) : null}
    </div>
  );
};

const Message = () => (
  <div data-testid="message">
    <MessagePrimitive.Parts components={{ Text, tools: { Fallback: ToolCall } }} />
  </div>
);

const tools: ClientTool[] = [
  { name: 'get_time', description: 'time', parameters: { type: 'object', properties: {} }, execute: async () => '10:00' },
];

function Harness({ t2v, onRuntime }: { t2v: Talk2View; onRuntime: (r: AssistantRuntime) => void }) {
  const runtime = useTalk2ViewRuntimeForClient(t2v, { tools, systemPrompt: 'Be brief.' });
  useEffect(() => onRuntime(runtime), [runtime, onRuntime]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages components={{ Message }} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function mount(t2v: Talk2View) {
  let runtime!: AssistantRuntime;
  const view = render(<Harness t2v={t2v} onRuntime={(r) => { runtime = r; }} />);
  return { ...view, runtime: () => runtime };
}

async function send(runtime: AssistantRuntime, content: string) {
  await act(async () => {
    runtime.thread.append({ role: 'user', content: [{ type: 'text', text: content }] });
    await Promise.resolve();
  });
}

let t2v: Talk2View;
beforeEach(() => {
  localStorage.clear();
  t2v = new Talk2View({ partnerKey: 'pk_test', anonymousAutoStart: false });
});

describe('the Talk2View runtime under assistant-ui primitives', () => {
  it('registers the tools with the engine on mount', async () => {
    mount(t2v);
    await waitFor(() => expect(t2v.tools.register).toHaveBeenCalledTimes(1));
    expect(t2v.tools.register).toHaveBeenCalledWith([expect.objectContaining({ name: 'get_time' })]);
    expect(t2v.tools.handle).toHaveBeenCalledWith('get_time', expect.any(Function));
    // Schemas only — the handler must not be sent to the engine.
    const [schemas] = vi.mocked(t2v.tools.register).mock.calls[0]!;
    expect(schemas[0]).not.toHaveProperty('execute');
  });

  it('streams a reply into the thread and settles', async () => {
    scripted(t2v, [[text('It is '), text('10:00'), done()]]);
    const sendSpy = vi.spyOn(t2v, 'sendMessage');
    const { getAllByTestId, runtime } = mount(t2v);

    await send(runtime(), 'What time is it?');

    await waitFor(() => {
      const texts = getAllByTestId('text').map((n) => n.textContent);
      expect(texts).toEqual(['What time is it?', 'It is 10:00']);
    });
    expect(sendSpy).toHaveBeenCalledWith('What time is it?', { systemPrompt: 'Be brief.' });
    await waitFor(() => expect(runtime().thread.getState().isRunning).toBe(false));
    expect(getAllByTestId('message')).toHaveLength(2);
  });

  it('shows a client tool call as a tool part', async () => {
    scripted(t2v, [[toolCall('get_time', 'call-1'), text('Done'), done()]]);
    const { getByTestId, runtime } = mount(t2v);

    await send(runtime(), 'Use the tool');

    await waitFor(() => expect(getByTestId('tool-get_time')).toBeTruthy());
  });

  it('renders the approval gate and resumes on the stock allow option', async () => {
    scripted(
      t2v,
      [[approvalRequired('send_email', 'call-9', { to: 'a@b.c' })]],
      [[approvalResult('send_email', 'once'), text('Sent.'), done()]],
    );
    const approve = vi.spyOn(t2v, 'approveToolCall');
    const { getByTestId, getByText, getAllByTestId, queryByText, runtime } = mount(t2v);

    await send(runtime(), 'Email Bob');

    await waitFor(() => expect(getByTestId('tool-send_email').dataset.state).toBe('gate'));
    expect(runtime().thread.getState().isRunning).toBe(true);

    await act(async () => { fireEvent.click(getByText('Allow once')); await Promise.resolve(); });

    await waitFor(() => expect(approve).toHaveBeenCalledWith({ action: 'once' }));
    await waitFor(() => expect(getAllByTestId('text').map((n) => n.textContent)).toContain('Sent.'));
    expect(queryByText('Allow once')).toBeNull();
  });

  it('turns a denial with a reason into feedback', async () => {
    scripted(t2v, [[approvalRequired('send_email', 'call-2')]], [[approvalResult('send_email', 'deny'), done()]]);
    const approve = vi.spyOn(t2v, 'approveToolCall');
    const { getByText, runtime } = mount(t2v);

    await send(runtime(), 'Email Bob');
    await waitFor(() => getByText('Deny'));
    await act(async () => { fireEvent.click(getByText('Deny')); await Promise.resolve(); });

    await waitFor(() => expect(approve).toHaveBeenCalledWith({ action: 'deny', feedback: 'No' }));
  });

  it('routes stop to the client', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() => (async function* () {
      yield text('thinking');
      await blocked;
      yield done();
    })()) as never);
    const stop = vi.spyOn(t2v, 'stop');
    const { runtime } = mount(t2v);

    await send(runtime(), 'Long task');
    await waitFor(() => expect(runtime().thread.getState().isRunning).toBe(true));

    await act(async () => { runtime().thread.cancelRun(); await Promise.resolve(); });
    expect(stop).toHaveBeenCalledTimes(1);
    release();
  });

  it('shows an error even when the turn failed before any text arrived', async () => {
    // The SDK drops the empty assistant message on this path, so without help
    // assistant-ui would have nothing to attach the error to.
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() => (async function* () {
      throw new Error('Server unreachable');
      yield text('never');
    })()) as never);
    const { runtime } = mount(t2v);

    await send(runtime(), 'hi');

    await waitFor(() => expect(t2v.error).toBe('Server unreachable'));
    await waitFor(() => {
      const msgs = runtime().thread.getState().messages;
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(msgs[1]!.status).toEqual({ type: 'incomplete', reason: 'error', error: 'Server unreachable' });
    });
    expect(runtime().thread.getState().isRunning).toBe(false);
  });

  it('only regenerates the latest turn on reload', async () => {
    scripted(t2v, [[text('first'), done()], [text('second'), done()], [text('regenerated'), done()]]);
    const retry = vi.spyOn(t2v, 'retryLastMessage');
    const { runtime } = mount(t2v);
    await send(runtime(), 'q1');
    await waitFor(() => expect(runtime().thread.getState().messages).toHaveLength(2));
    await send(runtime(), 'q2');
    await waitFor(() => expect(runtime().thread.getState().messages).toHaveLength(4));

    // Refresh on the FIRST assistant message must not touch the second turn.
    await act(async () => { runtime().thread.getMessageByIndex(1).reload(); await Promise.resolve(); });
    expect(retry).not.toHaveBeenCalled();
    expect(runtime().thread.getState().messages).toHaveLength(4);

    // Refresh on the latest one does.
    await act(async () => { runtime().thread.getMessageByIndex(3).reload(); await Promise.resolve(); });
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  it('after a failed turn, reload retries the failed turn and never an older reply', async () => {
    let calls = 0;
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() => (async function* () {
      calls += 1;
      if (calls === 1) { yield text('first'); yield done(); return; }
      if (calls === 2) throw new Error('Server unreachable');
      yield text('recovered'); yield done();
    })()) as never);
    const retry = vi.spyOn(t2v, 'retryLastMessage');
    const { runtime } = mount(t2v);
    await send(runtime(), 'q1');
    await waitFor(() => expect(runtime().thread.getState().messages).toHaveLength(2));
    await send(runtime(), 'q2');
    // [user q1, assistant first, user q2, synthetic error card]
    await waitFor(() => expect(runtime().thread.getState().messages).toHaveLength(4));
    expect(runtime().thread.getState().messages[3]!.status).toMatchObject({ type: 'incomplete', reason: 'error' });

    // Refresh on the older reply must not resend q2.
    await act(async () => { runtime().thread.getMessageByIndex(1).reload(); await Promise.resolve(); });
    expect(retry).not.toHaveBeenCalled();

    // Refresh on the error card retries q2.
    await act(async () => { runtime().thread.getMessageByIndex(3).reload(); await Promise.resolve(); });
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const msgs = runtime().thread.getState().messages;
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(msgs[3]!.status).toEqual({ type: 'complete', reason: 'stop' });
    });
    expect(t2v.error).toBeNull();
  });

  it('turns Stop into a denial while a tool call awaits approval', async () => {
    scripted(t2v, [[approvalRequired('send_email', 'call-5')]], [[approvalResult('send_email', 'deny'), done()]]);
    const approve = vi.spyOn(t2v, 'approveToolCall');
    const stop = vi.spyOn(t2v, 'stop');
    const { getByTestId, runtime } = mount(t2v);

    await send(runtime(), 'Email Bob');
    await waitFor(() => expect(getByTestId('tool-send_email').dataset.state).toBe('gate'));

    await act(async () => { runtime().thread.cancelRun(); await Promise.resolve(); });

    await waitFor(() => expect(approve).toHaveBeenCalledWith({ action: 'deny', feedback: 'Cancelled by the user' }));
    expect(stop).not.toHaveBeenCalled();
    await waitFor(() => expect(runtime().thread.getState().isRunning).toBe(false));
  });

  it('ignores an approval answer for a gate that is no longer pending', async () => {
    scripted(t2v, [[approvalRequired('send_email', 'call-6')]], [[done()]]);
    const approve = vi.spyOn(t2v, 'approveToolCall');
    const { getByTestId, runtime } = mount(t2v);
    await send(runtime(), 'Email Bob');
    await waitFor(() => expect(getByTestId('tool-send_email').dataset.state).toBe('gate'));

    // A stale card answering a different approval id must not reach the SDK.
    // (The thread core is the only seam that lets a test inject a wrong id.)
    const core = () => runtime().thread.__internal_threadBinding.getState();
    await act(async () => {
      await core().respondToToolApproval({ approvalId: 'stale-id', approved: true, optionId: APPROVAL_OPTION_IDS.once }).catch(() => {});
    });
    expect(approve).not.toHaveBeenCalled();

    await act(async () => {
      await core().respondToToolApproval({ approvalId: 'call-6', approved: true, optionId: APPROVAL_OPTION_IDS.once });
    });
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
  });

  it('registers an inline tools array once, not on every stream chunk', async () => {
    scripted(t2v, [[text('a'), text('b'), text('c'), done()]]);
    function Inline({ onRuntime }: { onRuntime: (r: AssistantRuntime) => void }) {
      const runtime = useTalk2ViewRuntimeForClient(t2v, {
        tools: [{ name: 'get_time', description: 'time', parameters: { type: 'object', properties: {} }, execute: async () => '10:00' }],
      });
      useEffect(() => onRuntime(runtime), [runtime, onRuntime]);
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{ Message }} /></ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      );
    }
    let runtime!: AssistantRuntime;
    render(<Inline onRuntime={(r) => { runtime = r; }} />);
    await waitFor(() => expect(t2v.tools.register).toHaveBeenCalledTimes(1));

    await send(runtime, 'go');
    await waitFor(() => expect(runtime.thread.getState().isRunning).toBe(false));
    expect(t2v.tools.register).toHaveBeenCalledTimes(1);
  });

  it('sends the chosen model with each message without recreating the client', async () => {
    scripted(t2v, [[text('a'), done()], [text('b'), done()]]);
    const sendSpy = vi.spyOn(t2v, 'sendMessage');
    let runtime!: AssistantRuntime;
    function WithModel({ model }: { model?: string }) {
      const r = useTalk2ViewRuntimeForClient(t2v, { model });
      useEffect(() => { runtime = r; }, [r]);
      return (
        <AssistantRuntimeProvider runtime={r}>
          <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{ Message }} /></ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      );
    }
    const view = render(<WithModel model="gemini-3.8-flash" />);
    await send(runtime, 'one');
    await waitFor(() => expect(sendSpy).toHaveBeenLastCalledWith('one', { model: 'gemini-3.8-flash' }));
    await waitFor(() => expect(runtime.thread.getState().isRunning).toBe(false));

    // The end-user picks another model in settings: same chat, next message uses it.
    view.rerender(<WithModel model="claude-sonnet-5" />);
    await send(runtime, 'two');
    await waitFor(() => expect(sendSpy).toHaveBeenLastCalledWith('two', { model: 'claude-sonnet-5' }));
    expect(runtime.thread.getState().messages.length).toBeGreaterThanOrEqual(3);
  });

  it('offers dictation to assistant-ui only when asked to', async () => {
    let runtime!: AssistantRuntime;
    function WithDictation({ on }: { on: boolean }) {
      const r = useTalk2ViewRuntimeForClient(t2v, { dictation: on });
      useEffect(() => { runtime = r; }, [r]);
      return <AssistantRuntimeProvider runtime={r}><ThreadPrimitive.Root /></AssistantRuntimeProvider>;
    }
    const view = render(<WithDictation on={false} />);
    await waitFor(() => expect(runtime.thread.getState().capabilities.dictation).toBe(false));
    view.rerender(<WithDictation on />);
    // The stock Thread renders its mic button off this capability.
    await waitFor(() => expect(runtime.thread.getState().capabilities.dictation).toBe(true));
  });

  it('warms the key on the first character typed, once, and not on mount', async () => {
    const warmUp = vi.spyOn(t2v, 'warmUp').mockResolvedValue(undefined);
    const { runtime } = mount(t2v);
    expect(warmUp).not.toHaveBeenCalled();

    act(() => runtime().thread.composer.setText('W'));
    act(() => runtime().thread.composer.setText('Wh'));
    expect(warmUp).toHaveBeenCalledTimes(1);
  });

  it('uploads composer attachments and sends them by id', async () => {
    scripted(t2v, [[text('Nice scan.'), done()]]);
    const stored: Attachment = { id: 'att-1', filename: 'scan.png', mime_type: 'image/png', size_bytes: 3 };
    const upload = vi.spyOn(t2v, 'uploadAttachment').mockResolvedValue(stored);
    const sendSpy = vi.spyOn(t2v, 'sendMessage');
    const { runtime } = mount(t2v);

    const file = new File([new Uint8Array([1, 2, 3])], 'scan.png', { type: 'image/png' });
    await act(async () => {
      await runtime().thread.composer.addAttachment(file);
      runtime().thread.composer.setText('Look at this');
      await runtime().thread.composer.send();
    });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, 'scan.png'));
    await waitFor(() =>
      expect(sendSpy).toHaveBeenCalledWith('Look at this', { systemPrompt: 'Be brief.', attachments: [stored] }),
    );
  });
});
