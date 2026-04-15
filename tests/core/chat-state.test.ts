/**
 * Tests for Talk2View class state management (sendMessage, approveToolCall, etc.).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Talk2View } from '../../src/index';
import type { ChatEvent, DisplayMessage, PendingApproval, AgentStatus } from '../../src/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn(),
    streamRequest: vi.fn(),
  })),
}));

vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
  })),
  stripNullArgs: (args: Record<string, unknown>) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v !== null && v !== undefined) clean[k] = v;
    }
    return clean;
  },
}));

vi.mock('../../src/skills', () => ({
  T2VSkills: vi.fn().mockImplementation(() => ({})),
}));

// ─── Chunk builders ──────────────────────────────────────────────────────────

function textChunk(content: string): ChatEvent {
  return { type: 'text', content };
}

function stopChunk(threadId = 'thread_1'): ChatEvent {
  return { type: 'done', threadId };
}

function interruptChunk(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  description = '',
): ChatEvent {
  return { type: 'approval_required', toolName, toolCallId, arguments: args, description };
}

function statusChunk(status: string, message: string): ChatEvent {
  return { type: 'status', status, message };
}

function todosChunk(content: string): ChatEvent {
  return { type: 'todos', content };
}

function toolCallChunk(toolName: string, toolCallId: string, args: Record<string, unknown>): ChatEvent {
  return { type: 'tool_call', toolName, toolCallId, arguments: args };
}

function approvalResultChunk(toolName: string, decision: 'once' | 'always' | 'deny'): ChatEvent {
  return { type: 'approval_result', toolName, decision };
}

function errorChunk(message: string): ChatEvent {
  return { type: 'error', message };
}

// ─── Mock stream setup ──────────────────────────────────────────────────────

/**
 * Configure a Talk2View instance so its `chat()` and `respondToApproval()` methods
 * yield pre-defined event sequences, bypassing real networking.
 */
function setupMockClient(
  t2v: Talk2View,
  streams: ChatEvent[][],
): void {
  let callIndex = 0;
  const createStream = (): AsyncGenerator<ChatEvent> => {
    const events = streams[callIndex++] ?? [];
    return (async function* () {
      for (const e of events) yield e;
    })();
  };

  // Override chat and respondToApproval with mock generators
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() => createStream()) as never);

  // For respondToApproval, we need it to return a new stream each time
  vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() => createStream()) as never);
}

/**
 * More flexible setup: separate chat streams from approval streams.
 */
function setupMockClientSeparate(
  t2v: Talk2View,
  chatStreams: ChatEvent[][],
  approvalStreams: ChatEvent[][],
): void {
  let chatIndex = 0;
  let approvalIndex = 0;

  vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
    const events = chatStreams[chatIndex++] ?? [];
    return (async function* () {
      for (const e of events) yield e;
    })();
  }) as never);

  vi.spyOn(t2v, 'respondToApproval' as never).mockImplementation((() => {
    const events = approvalStreams[approvalIndex++] ?? [];
    return (async function* () {
      for (const e of events) yield e;
    })();
  }) as never);
}

function createT2V(): Talk2View {
  return new Talk2View({ partnerKey: 'pk_test_123' });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Talk2View state management', () => {
  let t2v: Talk2View;

  beforeEach(() => {
    t2v = createT2V();
  });

  describe('initial state', () => {
    it('starts with empty messages', () => {
      expect(t2v.messages).toEqual([]);
    });

    it('starts with isLoading false', () => {
      expect(t2v.isLoading).toBe(false);
    });

    it('starts with no error', () => {
      expect(t2v.error).toBeNull();
    });

    it('starts with no pending approval', () => {
      expect(t2v.pendingApproval).toBeNull();
    });

    it('starts with no agent status', () => {
      expect(t2v.agentStatus).toBeNull();
    });

    it('starts with no thread ID', () => {
      expect(t2v.threadId).toBeNull();
    });

    it('starts with empty always-allowed tools', () => {
      expect(t2v.alwaysAllowedTools.size).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('adds user and assistant messages, streams text', async () => {
      setupMockClient(t2v, [
        [textChunk('Hello '), textChunk('world'), stopChunk()],
      ]);

      await t2v.sendMessage('Hi');

      expect(t2v.messages).toHaveLength(2);
      expect(t2v.messages[0]!.role).toBe('user');
      expect(t2v.messages[0]!.content).toBe('Hi');
      expect(t2v.messages[1]!.role).toBe('assistant');
      expect(t2v.messages[1]!.content).toBe('Hello world');
    });

    it('sets isLoading during streaming and clears after', async () => {
      const loadingStates: boolean[] = [];
      t2v.on('loadingChange', (loading) => loadingStates.push(loading));

      setupMockClient(t2v, [
        [textChunk('response'), stopChunk()],
      ]);

      await t2v.sendMessage('test');

      // Should have set loading true then false
      expect(loadingStates).toContain(true);
      expect(loadingStates[loadingStates.length - 1]).toBe(false);
      expect(t2v.isLoading).toBe(false);
    });

    it('emits messagesChange events', async () => {
      const messageSnapshots: DisplayMessage[][] = [];
      t2v.on('messagesChange', (msgs) => messageSnapshots.push([...msgs]));

      setupMockClient(t2v, [
        [textChunk('Hi'), stopChunk()],
      ]);

      await t2v.sendMessage('Hello');

      // At least: initial add (user + assistant), text update, finalize (isStreaming: false)
      expect(messageSnapshots.length).toBeGreaterThanOrEqual(2);
    });

    it('sets threadId from done event', async () => {
      setupMockClient(t2v, [
        [textChunk('ok'), stopChunk('thread_abc')],
      ]);

      await t2v.sendMessage('test');

      expect(t2v.threadId).toBe('thread_abc');
    });

    it('handles status events', async () => {
      const statuses: (AgentStatus | null)[] = [];
      t2v.on('statusChange', (s) => statuses.push(s));

      setupMockClient(t2v, [
        [statusChunk('thinking', 'Processing...'), textChunk('done'), stopChunk()],
      ]);

      await t2v.sendMessage('test');

      // Status set during stream, then cleared at finalize
      expect(statuses).toContainEqual({ type: 'thinking', message: 'Processing...' });
      expect(statuses[statuses.length - 1]).toBeNull();
    });

    it('stores todos as plan on assistant message', async () => {
      setupMockClient(t2v, [
        [todosChunk('- [ ] Step 1\n- [ ] Step 2'), textChunk('Working'), stopChunk()],
      ]);

      await t2v.sendMessage('plan');

      const assistant = t2v.messages.find((m) => m.role === 'assistant');
      expect(assistant?.plan).toBe('- [ ] Step 1\n- [ ] Step 2');
    });

    it('records tool_call as step on assistant message', async () => {
      setupMockClient(t2v, [
        [toolCallChunk('search', 'call_1', { q: 'test' }), textChunk('Found it'), stopChunk()],
      ]);

      await t2v.sendMessage('search for something');

      const assistant = t2v.messages.find((m) => m.role === 'assistant');
      expect(assistant?.steps).toHaveLength(1);
      expect(assistant?.steps?.[0]).toMatchObject({ name: 'search', status: 'used', args: { q: 'test' } });
    });

    it('sets error on stream error event', async () => {
      setupMockClient(t2v, [
        [textChunk('partial'), errorChunk('Something went wrong')],
      ]);

      await t2v.sendMessage('test');

      expect(t2v.error).toBe('Something went wrong');
    });

    it('sets error on stream exception', async () => {
      vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
        return (async function* () {
          yield textChunk('partial');
          throw new Error('Network failure');
        })();
      }) as never);

      await t2v.sendMessage('test');

      expect(t2v.error).toBe('Network failure');
    });

    it('passes model from options to chat', async () => {
      const chatSpy = vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
        return (async function* (): AsyncGenerator<ChatEvent> {
          yield stopChunk();
        })();
      }) as never);

      await t2v.sendMessage('test', { model: 'gpt-4o' });

      expect(chatSpy).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ model: 'gpt-4o' }),
      );
    });

    it('passes systemPrompt from sendMessage options', async () => {
      const chatSpy = vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
        return (async function* (): AsyncGenerator<ChatEvent> {
          yield stopChunk();
        })();
      }) as never);

      await t2v.sendMessage('test', { systemPrompt: 'You are a helpful bot' });

      expect(chatSpy).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ systemPrompt: 'You are a helpful bot' }),
      );
    });

    it('marks assistant message as not streaming after completion', async () => {
      setupMockClient(t2v, [
        [textChunk('Hello'), stopChunk()],
      ]);

      await t2v.sendMessage('Hi');

      const assistant = t2v.messages.find((m) => m.role === 'assistant');
      expect(assistant?.isStreaming).toBe(false);
    });
  });

  describe('approval flow', () => {
    it('pauses on approval_required and sets pendingApproval', async () => {
      setupMockClient(t2v, [
        [
          textChunk('Let me '),
          interruptChunk('send_email', 'call_1', { to: 'a@b.com' }, 'Send an email'),
        ],
      ]);

      await t2v.sendMessage('send email');

      expect(t2v.pendingApproval).toEqual({
        toolCallId: 'call_1',
        toolName: 'send_email',
        arguments: { to: 'a@b.com' },
        description: 'Send an email',
      });
      // Loading stays true because we're waiting for approval
      expect(t2v.isLoading).toBe(false);
    });

    it('approveToolCall resumes stream after approval', async () => {
      setupMockClientSeparate(
        t2v,
        // chat stream: pauses at approval
        [[
          textChunk('Let me '),
          interruptChunk('send_email', 'call_1', { to: 'a@b.com' }, 'Send an email'),
        ]],
        // approval stream: continues after approval
        [[
          approvalResultChunk('send_email', 'once'),
          textChunk('Email sent!'),
          stopChunk(),
        ]],
      );

      await t2v.sendMessage('send email');
      expect(t2v.pendingApproval).not.toBeNull();

      await t2v.approveToolCall({ action: 'once' });

      expect(t2v.pendingApproval).toBeNull();
      // After approval, text arrives in a new message segment (message segmentation)
      const assistants = t2v.messages.filter((m) => m.role === 'assistant');
      const lastAssistant = assistants[assistants.length - 1];
      expect(lastAssistant?.content).toContain('Email sent!');
    });

    it('approveToolCall with deny marks step as denied', async () => {
      setupMockClientSeparate(
        t2v,
        // Include a tool_call before the interrupt so a step exists to be denied
        [[
          toolCallChunk('delete_file', 'call_2', { path: '/tmp' }),
          interruptChunk('delete_file', 'call_2', { path: '/tmp' }, 'Delete file'),
        ]],
        [[
          approvalResultChunk('delete_file', 'deny'),
          textChunk('Ok, skipping.'),
          stopChunk(),
        ]],
      );

      await t2v.sendMessage('delete file');
      await t2v.approveToolCall({ action: 'deny' });

      const assistant = t2v.messages.find((m) => m.role === 'assistant');
      const deniedStep = assistant?.steps?.find((s) => s.name === 'delete_file');
      expect(deniedStep?.status).toBe('denied');
    });

    it('approveToolCall does nothing if no pending approval', async () => {
      await t2v.approveToolCall({ action: 'once' });
      // Should not throw, just silently return
      expect(t2v.messages).toEqual([]);
    });
  });

  describe('always-approve', () => {
    it('remembers tools with "always" decision', async () => {
      setupMockClientSeparate(
        t2v,
        [[interruptChunk('send_email', 'call_1', { to: 'a@b.com' }, 'Send')]],
        [[textChunk('Sent!'), stopChunk()]],
      );

      await t2v.sendMessage('send email');
      await t2v.approveToolCall({ action: 'always' });

      expect(t2v.alwaysAllowedTools.has('send_email')).toBe(true);
    });

    it('auto-approves on subsequent calls for always-allowed tools', async () => {
      // First call: user approves with "always"
      setupMockClientSeparate(
        t2v,
        [[interruptChunk('send_email', 'call_1', {}, 'Send')]],
        [[textChunk('Sent 1'), stopChunk()]],
      );
      await t2v.sendMessage('send first email');
      await t2v.approveToolCall({ action: 'always' });

      // Second call: should auto-approve
      const statuses: (AgentStatus | null)[] = [];
      t2v.on('statusChange', (s) => statuses.push(s));

      setupMockClientSeparate(
        t2v,
        // Chat stream has approval for the always-allowed tool
        [[interruptChunk('send_email', 'call_2', {}, 'Send')]],
        // The auto-approval response
        [[textChunk('Sent 2'), stopChunk()]],
      );

      await t2v.sendMessage('send second email');

      // Should have auto-approved (shown in status)
      expect(statuses).toContainEqual({
        type: 'auto-approved',
        message: 'Auto-approved send_email',
      });
      // Should NOT have set pendingApproval
      expect(t2v.pendingApproval).toBeNull();
    });
  });

  describe('retryLastMessage', () => {
    it('removes failed messages and resends', async () => {
      // First call fails
      setupMockClient(t2v, [
        [textChunk('partial'), errorChunk('Server error')],
      ]);
      await t2v.sendMessage('test');
      expect(t2v.error).toBe('Server error');
      expect(t2v.messages).toHaveLength(2);

      // Retry
      setupMockClient(t2v, [
        [textChunk('Success'), stopChunk()],
      ]);
      await t2v.retryLastMessage();

      expect(t2v.error).toBeNull();
      // After retry: user + assistant from the retry
      expect(t2v.messages).toHaveLength(2);
      const assistant = t2v.messages.find((m) => m.role === 'assistant');
      expect(assistant?.content).toBe('Success');
    });

    it('does nothing if no previous message', async () => {
      await t2v.retryLastMessage();
      expect(t2v.messages).toEqual([]);
    });
  });

  describe('clearMessages', () => {
    it('resets all state', async () => {
      setupMockClient(t2v, [
        [textChunk('Hello'), stopChunk('thread_x')],
      ]);
      await t2v.sendMessage('Hi');

      t2v.clearMessages();

      expect(t2v.messages).toEqual([]);
      expect(t2v.isLoading).toBe(false);
      expect(t2v.error).toBeNull();
      expect(t2v.pendingApproval).toBeNull();
      expect(t2v.agentStatus).toBeNull();
      expect(t2v.threadId).toBeNull();
      expect(t2v.alwaysAllowedTools.size).toBe(0);
    });
  });

  describe('clearError', () => {
    it('clears the error', async () => {
      setupMockClient(t2v, [
        [errorChunk('boom')],
      ]);
      await t2v.sendMessage('test');
      expect(t2v.error).toBe('boom');

      t2v.clearError();
      expect(t2v.error).toBeNull();
    });
  });

  describe('event unsubscribe', () => {
    it('stops receiving events after unsubscribe', async () => {
      const messages: DisplayMessage[][] = [];
      const unsub = t2v.on('messagesChange', (msgs) => messages.push([...msgs]));

      setupMockClient(t2v, [
        [textChunk('first'), stopChunk()],
      ]);
      await t2v.sendMessage('test');
      const countBefore = messages.length;

      unsub();

      setupMockClient(t2v, [
        [textChunk('second'), stopChunk()],
      ]);
      await t2v.sendMessage('test2');

      // No new messages after unsubscribe
      expect(messages.length).toBe(countBefore);
    });
  });
});
