/**
 * How a tool call looks inside the packaged chat: the activity row while it
 * runs, the approval card while it waits on the end-user, and the collapsed
 * "Used tool" line afterwards.
 *
 * Most cases drive the real thing end to end — a scripted engine stream through
 * the real client, the real runtime and the vendored <Thread /> — so the card
 * under test is the one assistant-ui actually mounts, with a real tool-call part
 * scope around it. Only the stale-card case builds the props by hand, because
 * staleness is exactly the state a live thread never produces.
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
    onAuthStateChange: vi.fn().mockReturnValue(() => {}),
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
import { Talk2ViewChat } from '../../src/chat/chat';
import { ChatProvider, type Talk2ViewChatProps } from '../../src/chat/provider';
import { ToolFallback } from '../../src/chat/tool-fallback';
import type { ChatEvent } from '../../src/types';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  // jsdom has no scrolling; the thread viewport auto-scrolls on every message.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

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
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

// ── a scripted engine, as in tests/assistant-ui/runtime.test.tsx ─────────────
const approvalRequired = (toolName: string, toolCallId: string, args = {}): ChatEvent => ({
  type: 'approval_required',
  toolName,
  toolCallId,
  arguments: args,
  description: `Run ${toolName}`,
});
const toolCall = (toolName: string, toolCallId: string, args = {}): ChatEvent => ({
  type: 'tool_call',
  toolName,
  toolCallId,
  arguments: args,
});
const done = (): ChatEvent => ({ type: 'done', threadId: 'th' });

function scripted(t2v: Talk2View, streams: ChatEvent[][], afterApproval: ChatEvent[][] = []) {
  let i = 0;
  let a = 0;
  const gen = (events: ChatEvent[]) =>
    (async function* () {
      for (const e of events) yield e;
    })();
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() => gen(streams[i++] ?? [])) as never);
  vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() =>
    gen(afterApproval[a++] ?? [])) as never);
}

async function mount(t2v: Talk2View, props: Partial<Talk2ViewChatProps>, message = 'do it') {
  render(<Talk2ViewChat client={t2v} {...props} />);
  await screen.findByRole('heading', { name: /how can i help/i });
  await act(async () => {
    await t2v.sendMessage(message).catch(() => {});
  });
}

const newClient = () => new Talk2View({ partnerKey: 'pk_test_x', anonymousAutoStart: false });

describe('a tool call that is still running', () => {
  /**
   * A tool step is "running" while the turn is still open and nobody is being
   * asked anything: the end-user has decided and the engine has not reported
   * back. Staged by answering an approval and holding the resume stream open.
   */
  const release: (() => void)[] = [];
  afterEach(() => {
    release.splice(0).forEach((fn) => fn());
  });

  const running = async (props: Partial<Talk2ViewChatProps>) => {
    const t2v = newClient();
    let held!: () => void;
    const open = new Promise<void>((resolve) => {
      held = resolve;
    });
    release.push(held);
    scripted(t2v, [[approvalRequired('insert_text', 'call-1', { chars: 240 })]]);
    // The engine has taken the decision and gone quiet: the turn stays open.
    vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() =>
      (async function* () {
        await open;
      })()) as never);

    await mount(t2v, props);
    await screen.findByRole('button', { name: 'Allow once' });
    await act(async () => {
      void t2v.approveToolCall({ action: 'once' });
      await Promise.resolve();
    });
    return t2v;
  };

  it('says what the agent is doing, and counts the seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await running({
      describeToolActivity: (name, args) =>
        name === 'insert_text' ? `Inserting ${String(args?.chars)} characters` : null,
    });

    expect(await screen.findByText('Inserting 240 characters')).toBeTruthy();
    expect(screen.getByText(/^\d+s$/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.getByText('2s')).toBeTruthy());
  });

  it('falls back to a plain "Working…" when the host describes nothing', async () => {
    await running({});
    expect(await screen.findByText('Working…')).toBeTruthy();
  });
});

describe('a tool call waiting on the end-user', () => {
  const card = (props: Partial<Talk2ViewChatProps> = {}) => {
    const t2v = newClient();
    scripted(t2v, [[approvalRequired('send_email', 'call-9', { to: 'a@b.c' })]]);
    return { t2v, mounted: mount(t2v, props) };
  };

  it('offers allow / always / deny, and pretty-prints the arguments', async () => {
    const { mounted } = card();
    await mounted;
    expect(await screen.findByRole('button', { name: 'Allow once' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(document.querySelector('pre')!.textContent).toBe('{\n  "to": "a@b.c"\n}');
  });

  it('warns before a tool that changes the document, and denies in two steps', async () => {
    const { t2v, mounted } = card({
      isToolDestructive: (name) => name === 'send_email',
      describeToolActivity: () => 'Send an email to a@b.c',
    });
    await mounted;
    const approve = vi.spyOn(t2v, 'approveToolCall').mockResolvedValue(undefined);

    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toBe(
      'This will modify your document: Send an email to a@b.c. Review before approving.',
    );
    expect(warning.querySelector('strong')!.textContent).toBe('Send an email to a@b.c');

    // One tap does not deny: the reason field and a confirm come first.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    });
    expect(approve).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/reason for denying/i), {
      target: { value: 'wrong recipient' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm deny' }));
    });
    expect(approve).toHaveBeenCalledWith({ action: 'deny', feedback: 'wrong recipient' });
  });

  it('attributes the agent’s own description instead of speaking in the chat’s voice', async () => {
    // `approval.prompt` is written by the model, which has read whatever this
    // conversation put in front of it. Unlabelled, directly above "Allow once",
    // it reads as first-party copy on the one screen where a person grants
    // permission to change their work.
    const { mounted } = card();
    await mounted;
    await screen.findByRole('button', { name: 'Allow once' });
    expect(screen.getByText('The assistant says:')).toBeTruthy();
    expect(document.querySelector('.t2v-tool-approval-prompt')!.textContent).toBe(
      'Run send_email',
    );
  });

  it('comes back to the thread when it arrives while another view is open', async () => {
    // The thread is `inert` whenever another view is up, so a card arriving
    // while the end-user is in Settings is on screen and unclickable.
    const t2v = newClient();
    scripted(t2v, [[]]);
    await mount(t2v, {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });
    expect(document.querySelector('.t2v-chat-settings')).toBeTruthy();
    expect(document.querySelector<HTMLElement>('.aui-modal-thread')!.inert).toBe(true);

    await act(async () => {
      (
        t2v as unknown as { emitter: { emit: (e: string, p: unknown) => void } }
      ).emitter.emit('approvalChange', {
        toolName: 'send_email',
        toolCallId: 'call-9',
        arguments: {},
        prompt: 'Run send_email',
      });
    });
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>('.aui-modal-thread')!.inert).toBe(false),
    );
    expect(document.querySelector('.t2v-chat-settings')).toBeNull();
  });

  it('leaves a half-typed sign-in alone', async () => {
    // Account is the one view that holds something worth losing. A decision
    // that waits a moment longer is the better trade.
    const t2v = newClient();
    scripted(t2v, [[]]);
    await mount(t2v, {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    });
    expect(document.querySelector('.t2v-chat-account')).toBeTruthy();

    await act(async () => {
      (
        t2v as unknown as { emitter: { emit: (e: string, p: unknown) => void } }
      ).emitter.emit('approvalChange', {
        toolName: 'send_email',
        toolCallId: 'call-9',
        arguments: {},
        prompt: 'Run send_email',
      });
    });
    expect(document.querySelector('.t2v-chat-account')).toBeTruthy();
  });

  it('leaves the warning out for a tool that only reads', async () => {
    const { mounted } = card({ isToolDestructive: () => false });
    await mounted;
    await screen.findByRole('button', { name: 'Allow once' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets the host write its own warning', async () => {
    const { mounted } = card({
      isToolDestructive: () => true,
      destructiveWarning: (name) => <span>Careful with {name}</span>,
    });
    await mounted;
    expect((await screen.findByRole('alert')).textContent).toBe('Careful with send_email');
  });

  it('sends edited arguments with a one-off allow, and withdraws "Always allow"', async () => {
    const { t2v, mounted } = card();
    await mounted;
    const approve = vi.spyOn(t2v, 'approveToolCall').mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit arguments/i }));
    });
    fireEvent.change(screen.getByLabelText(/arguments/i), {
      target: { value: '{"to":"safe@example.com"}' },
    });

    // Edits apply to this call only, so a standing permission is off the table.
    expect(
      (screen.getByRole('button', { name: 'Always allow' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    });
    expect(approve).toHaveBeenCalledWith({
      action: 'once',
      updatedInput: { to: 'safe@example.com' },
    });
  });

  it('refuses to allow arguments that are not valid JSON', async () => {
    const { t2v, mounted } = card();
    await mounted;
    const approve = vi.spyOn(t2v, 'approveToolCall').mockResolvedValue(undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit arguments/i }));
    });
    fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: '{oops' } });
    expect((screen.getByRole('button', { name: 'Allow once' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it('does nothing when the card is answering a decision that has moved on', async () => {
    const t2v = newClient();
    const approve = vi.spyOn(t2v, 'approveToolCall').mockResolvedValue(undefined);
    render(
      <ChatProvider client={t2v}>
        <ToolFallback
          {...({
            toolName: 'send_email',
            args: { to: 'a@b.c' },
            argsText: '{"to":"a@b.c"}',
            status: { type: 'requires-action', reason: 'tool-calls' },
            approval: { id: 'call-gone', prompt: 'Run send_email' },
          } as never)}
        />
      </ChatProvider>,
    );
    // The client holds no decision at all, so this card's is not the live one.
    expect(t2v.pendingApproval).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    });
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('a tool call that has finished', () => {
  it('collapses into the turn\u2019s tool group, and opens to the arguments', async () => {
    const t2v = newClient();
    scripted(t2v, [[toolCall('insert_text', 'call-1', { chars: 240 }), done()]]);
    await mount(t2v, {});

    // A settled turn folds its tool calls away: one line, opened on demand.
    const group = await screen.findByRole('button', { name: '1 tool call' });
    expect(screen.queryByRole('button', { name: /used tool: insert_text/i })).toBeNull();
    await act(async () => {
      fireEvent.click(group);
    });

    const trigger = await screen.findByRole('button', { name: /used tool: insert_text/i });
    expect(screen.queryByText(/"chars": 240/)).toBeNull();
    await act(async () => {
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(screen.getByText(/"chars": 240/)).toBeTruthy());
  });
});
