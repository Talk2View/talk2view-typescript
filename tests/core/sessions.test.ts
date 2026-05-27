import { describe, expect, it, vi } from 'vitest';
import { T2VSession } from '../../src/sessions';
import type { T2VClient } from '../../src/client';
import type { T2VTools } from '../../src/tools';
import type { ChatCompletionChunk, ChatEvent, PendingApproval } from '../../src/types';

/** Helper: build an SSE chunk with an interrupt payload. */
function interruptChunk(toolName: string, toolCallId: string, args: Record<string, unknown>): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    thread_id: 'thread_1',
    interrupt: { type: 'tool_call', tool_name: toolName, tool_call_id: toolCallId, arguments: args },
  };
}

/** Helper: build an SSE chunk with text content. */
function textChunk(content: string): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    thread_id: 'thread_1',
  };
}

/** Helper: build a stop chunk. */
function stopChunk(): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    thread_id: 'thread_1',
  };
}

/** Helper: build a todos chunk. */
function todosChunk(todos: string): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: null }],
    thread_id: 'thread_1',
    todos,
  };
}

/** Collect all events from an async generator. */
async function collectEvents(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function createMockTools(overrides: Partial<T2VTools> = {}): T2VTools {
  return {
    hasHandler: vi.fn().mockReturnValue(false),
    checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
    getDescription: vi.fn().mockReturnValue(''),
    executeToolCall: vi.fn().mockResolvedValue({ result: 'ok', isError: false }),
    ...overrides,
  } as unknown as T2VTools;
}

function createMockClient(streams: ChatCompletionChunk[][]): T2VClient {
  let callIndex = 0;
  return {
    streamRequest: vi.fn().mockImplementation(async function* () {
      const chunks = streams[callIndex++] ?? [];
      for (const c of chunks) yield c;
    }),
  } as unknown as T2VClient;
}

function createSession(client: T2VClient, tools: T2VTools): T2VSession {
  return new T2VSession(
    { session_id: 'sess_1', thread_id: 'thread_1', model: 'test' },
    client,
    tools,
  );
}

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolCallId: 'call_123',
    toolName: 'send_email',
    arguments: { to: 'a@b.com' },
    description: 'Send an email',
    ...overrides,
  };
}

describe('T2VSession — todos (planning)', () => {
  it('yields a todos event when the chunk contains todos', async () => {
    const tools = createMockTools();
    const client = createMockClient([
      [todosChunk('- [ ] Step 1\n- [ ] Step 2'), textChunk('Working on it'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('plan something'));

    const todosEvent = events.find((e) => e.type === 'todos');
    expect(todosEvent).toEqual({
      type: 'todos',
      content: '- [ ] Step 1\n- [ ] Step 2',
    });
  });

  it('yields updated todos when agent checks off items', async () => {
    const tools = createMockTools();
    const client = createMockClient([
      [
        todosChunk('- [ ] Step 1\n- [ ] Step 2'),
        textChunk('Starting...'),
        todosChunk('- [x] Step 1\n- [ ] Step 2'),
        textChunk(' done with step 1'),
        stopChunk(),
      ],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('do steps'));

    const todosEvents = events.filter((e) => e.type === 'todos');
    expect(todosEvents).toHaveLength(2);
    expect(todosEvents[1]).toEqual({
      type: 'todos',
      content: '- [x] Step 1\n- [ ] Step 2',
    });
  });
});

describe('T2VSession HITL — approval_required event', () => {
  it('yields approval_required when checkPermission returns require_approval', async () => {
    const tools = createMockTools({
      checkPermission: vi.fn().mockResolvedValue({ action: 'require_approval' }),
      hasHandler: vi.fn().mockReturnValue(true),
      getDescription: vi.fn().mockReturnValue('Send an email'),
    });

    const client = createMockClient([
      [interruptChunk('send_email', 'call_123', { to: 'a@b.com', subject: 'Hi' })],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('send an email'));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'approval_required',
      toolName: 'send_email',
      toolCallId: 'call_123',
      arguments: { to: 'a@b.com', subject: 'Hi' },
      description: 'Send an email',
    });
  });

  it('auto-executes when checkPermission returns allow', async () => {
    const tools = createMockTools({
      checkPermission: vi.fn().mockResolvedValue({ action: 'allow' }),
      hasHandler: vi.fn().mockReturnValue(true),
      executeToolCall: vi.fn().mockResolvedValue({ result: 'done', isError: false }),
    });

    const client = createMockClient([
      [interruptChunk('safe_tool', 'call_456', { x: 1 })],
      [textChunk('Result processed'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('do something'));

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('text');
    expect(types).toContain('done');
    expect(types).not.toContain('approval_required');
  });

  it('auto-executes with updatedInput when callback modifies args', async () => {
    const executeMock = vi.fn().mockResolvedValue({ result: 'ok', isError: false });
    const tools = createMockTools({
      checkPermission: vi.fn().mockResolvedValue({ action: 'allow', updatedInput: { x: 99 } }),
      hasHandler: vi.fn().mockReturnValue(true),
      executeToolCall: executeMock,
    });

    const client = createMockClient([
      [interruptChunk('modify_tool', 'call_789', { x: 1 })],
      [textChunk('Done'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('modify'));

    // Should have called executeToolCall with the updated args
    expect(executeMock).toHaveBeenCalledWith('modify_tool', { x: 99 });

    // tool_call event should show the updated args
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toEqual({
      type: 'tool_call',
      toolName: 'modify_tool',
      toolCallId: 'call_789',
      arguments: { x: 99 },
    });
  });

  it('resumes with denial when checkPermission returns deny', async () => {
    const tools = createMockTools({
      checkPermission: vi.fn().mockResolvedValue({ action: 'deny', message: 'Not allowed' }),
    });

    const client = createMockClient([
      [interruptChunk('blocked_tool', 'call_111', {})],
      [textChunk('Ok, I won\'t do that.'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('try blocked'));

    // Should have resumed with denial
    const streamCall = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[1];
    const body = streamCall[1];
    expect(body.is_error).toBe(true);
    expect(body.result).toContain('Permission denied');
    expect(body.result).toContain('Not allowed');
  });
});

describe('T2VSession.respondToApproval', () => {
  it('once: executes tool and resumes', async () => {
    const executeMock = vi.fn().mockResolvedValue({ result: '{"sent": true}', isError: false });
    const tools = createMockTools({ executeToolCall: executeMock });

    const client = createMockClient([
      [textChunk('Email sent successfully'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const approval = makeApproval();
    const events = await collectEvents(
      session.respondToApproval(approval, { action: 'once' }),
    );

    // Should have executed with original args
    expect(executeMock).toHaveBeenCalledWith('send_email', { to: 'a@b.com' });

    const types = events.map((e) => e.type);
    expect(types).toContain('approval_result');
    expect(types).toContain('text');
    expect(types).toContain('done');

    const approvalResult = events.find((e) => e.type === 'approval_result')!;
    expect(approvalResult).toEqual({ type: 'approval_result', toolName: 'send_email', decision: 'once' });
  });

  it('once with updatedInput: executes tool with modified args', async () => {
    const executeMock = vi.fn().mockResolvedValue({ result: '{"sent": true}', isError: false });
    const tools = createMockTools({ executeToolCall: executeMock });

    const client = createMockClient([
      [textChunk('Done'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const approval = makeApproval();
    await collectEvents(
      session.respondToApproval(approval, {
        action: 'once',
        updatedInput: { to: 'corrected@b.com' },
      }),
    );

    // Should have executed with updated args, not original
    expect(executeMock).toHaveBeenCalledWith('send_email', { to: 'corrected@b.com' });
  });

  it('always: executes tool and resumes (same as once at session level)', async () => {
    const executeMock = vi.fn().mockResolvedValue({ result: '{"sent": true}', isError: false });
    const tools = createMockTools({ executeToolCall: executeMock });

    const client = createMockClient([
      [textChunk('Done'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(
      session.respondToApproval(makeApproval(), { action: 'always' }),
    );

    // Should have executed with original args
    expect(executeMock).toHaveBeenCalledWith('send_email', { to: 'a@b.com' });

    const approvalResult = events.find((e) => e.type === 'approval_result')!;
    expect(approvalResult).toEqual({ type: 'approval_result', toolName: 'send_email', decision: 'always' });
  });

  it('deny: does not execute tool and resumes with error', async () => {
    const executeMock = vi.fn();
    const tools = createMockTools({ executeToolCall: executeMock });

    const client = createMockClient([
      [textChunk('Understood, I won\'t send the email.'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    const events = await collectEvents(
      session.respondToApproval(
        makeApproval(),
        { action: 'deny', feedback: 'Wrong recipient' },
      ),
    );

    // Should NOT have called executeToolCall
    expect(executeMock).not.toHaveBeenCalled();

    // Should have resumed with error containing feedback
    const streamCall = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = streamCall[1];
    expect(body.is_error).toBe(true);
    expect(body.result).toContain('User denied');
    expect(body.result).toContain('Wrong recipient');

    const approvalResult = events.find((e) => e.type === 'approval_result')!;
    expect(approvalResult).toEqual({ type: 'approval_result', toolName: 'send_email', decision: 'deny' });
  });

  it('deny without feedback sends generic denial', async () => {
    const tools = createMockTools();
    const client = createMockClient([
      [textChunk('Ok'), stopChunk()],
    ]);

    const session = createSession(client, tools);
    await collectEvents(
      session.respondToApproval(makeApproval(), { action: 'deny' }),
    );

    const body = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.result).toBe('User denied this action.');
    expect(body.is_error).toBe(true);
  });
});

describe('T2VSession — engine error chunks', () => {
  it('yields a structured error event when the chunk carries engine.error', async () => {
    const tools = createMockTools();
    const errorChunk: ChatCompletionChunk = {
      id: 'test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test',
      choices: [
        {
          index: 0,
          delta: { content: 'An error occurred while resuming. Please try again.' },
          finish_reason: 'stop',
        },
      ],
      thread_id: 'thread_1',
      error: {
        type: 'ValidationError',
        message: 'An error occurred while resuming. Please try again.',
        detail: "ValidationError(2 errors for ClientTool_insert_content_Args, extras: ['space_before', 'space_after'])",
      },
    };
    const client = createMockClient([[errorChunk]]);

    const session = createSession(client, tools);
    const events = await collectEvents(session.sendMessage('go'));

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toEqual({
      type: 'error',
      message: 'An error occurred while resuming. Please try again.',
      errorType: 'ValidationError',
      detail: "ValidationError(2 errors for ClientTool_insert_content_Args, extras: ['space_before', 'space_after'])",
    });
    // The error message should NOT be duplicated as a text event when chunk.error is present.
    expect(events.find((e) => e.type === 'text')).toBeUndefined();
  });
});
