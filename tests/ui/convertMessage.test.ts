import { describe, it, expect } from 'vitest';
import { convertDisplayMessage } from '../../src/ui/runtime/convertMessage';
import type { DisplayMessage, ToolStep } from '../../src/react/useT2VChat';
import type { PendingApproval } from '../../src/types';

function makeMsg(overrides: Partial<DisplayMessage> & { role: DisplayMessage['role'] }): DisplayMessage {
  return {
    id: 'msg_1',
    role: overrides.role,
    content: '',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('convertDisplayMessage', () => {
  // ── User messages ──

  it('converts a user message', () => {
    const msg = makeMsg({ role: 'user', content: 'Hello' });
    const result = convertDisplayMessage(msg, null, null);

    expect(result.role).toBe('user');
    expect(result.id).toBe('msg_1');
    expect(result.createdAt).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.status).toBeUndefined();
  });

  it('user message ignores pendingApproval and error', () => {
    const msg = makeMsg({ role: 'user', content: 'Hi' });
    const approval: PendingApproval = {
      toolCallId: 'tc_1',
      toolName: 'get_weather',
      arguments: { city: 'NYC' },
      description: 'Get weather',
    };
    const result = convertDisplayMessage(msg, approval, 'some error');

    expect(result.role).toBe('user');
    expect(result.content).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(result.status).toBeUndefined();
  });

  // ── Assistant messages — basic ──

  it('converts a completed assistant message with text', () => {
    const msg = makeMsg({ role: 'assistant', content: 'Here is the answer.' });
    const result = convertDisplayMessage(msg, null, null);

    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ type: 'text', text: 'Here is the answer.' }]);
    expect(result.status).toEqual({ type: 'complete', reason: 'stop' });
  });

  it('converts a streaming assistant message', () => {
    const msg = makeMsg({ role: 'assistant', content: 'Partial...', isStreaming: true });
    const result = convertDisplayMessage(msg, null, null);

    expect(result.status).toEqual({ type: 'running' });
    expect(result.content).toEqual([{ type: 'text', text: 'Partial...' }]);
  });

  it('converts an empty assistant message', () => {
    const msg = makeMsg({ role: 'assistant', content: '' });
    const result = convertDisplayMessage(msg, null, null);

    // Should have at least one empty text part
    expect(result.content).toEqual([{ type: 'text', text: '' }]);
    expect(result.status).toEqual({ type: 'complete', reason: 'stop' });
  });

  // ── Plan output ──

  it('includes plan as additional text content', () => {
    const msg = makeMsg({
      role: 'assistant',
      content: 'Working on it.',
      plan: '- [x] Step 1\n- [ ] Step 2',
    });
    const result = convertDisplayMessage(msg, null, null);

    expect(result.content).toHaveLength(2);
    expect(result.content).toEqual([
      { type: 'text', text: 'Working on it.' },
      { type: 'text', text: '- [x] Step 1\n- [ ] Step 2' },
    ]);
  });

  // ── Tool steps ──

  it('converts completed tool steps as tool-call parts', () => {
    const steps: ToolStep[] = [
      { name: 'get_weather', status: 'used' },
      { name: 'delete_file', status: 'denied' },
    ];
    const msg = makeMsg({ role: 'assistant', content: 'Done.', steps });
    const result = convertDisplayMessage(msg, null, null);

    const content = result.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3); // text + 2 tool-calls

    // First tool step — used
    expect(content[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'get_weather',
      result: 'Tool call completed',
      isError: false,
    });

    // Second tool step — denied
    expect(content[2]).toMatchObject({
      type: 'tool-call',
      toolName: 'delete_file',
      result: 'Tool call denied',
      isError: true,
    });
  });

  // ── Pending approval ──

  it('converts pending approval as tool-call without result', () => {
    const msg = makeMsg({ role: 'assistant', content: 'Let me check.', isStreaming: true });
    const approval: PendingApproval = {
      toolCallId: 'tc_42',
      toolName: 'run_query',
      arguments: { sql: 'SELECT 1' },
      description: 'Run a database query',
    };

    const result = convertDisplayMessage(msg, approval, null);

    expect(result.status).toEqual({ type: 'requires-action', reason: 'tool-calls' });

    const content = result.content as Array<Record<string, unknown>>;
    const toolCall = content.find((p) => p['type'] === 'tool-call');
    expect(toolCall).toBeDefined();
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolName: 'run_query',
      toolCallId: 'tc_42',
      args: { sql: 'SELECT 1' },
    });
    // No result — this is what triggers requires-action in assistant-ui
    expect(toolCall!['result']).toBeUndefined();
  });

  // ── Error state ──

  it('sets incomplete/error status on error', () => {
    const msg = makeMsg({ role: 'assistant', content: '' });
    const result = convertDisplayMessage(msg, null, 'Network timeout');

    expect(result.status).toEqual({
      type: 'incomplete',
      reason: 'error',
      error: 'Network timeout',
    });
  });

  it('error takes precedence over complete but not over requires-action', () => {
    const msg = makeMsg({ role: 'assistant', content: 'Hmm' });
    const approval: PendingApproval = {
      toolCallId: 'tc_1',
      toolName: 'foo',
      arguments: {},
      description: '',
    };

    // With both error and approval, requires-action wins (approval is checked first)
    const result = convertDisplayMessage(msg, approval, 'some error');
    expect(result.status).toEqual({ type: 'requires-action', reason: 'tool-calls' });
  });

  // ── Combined: steps + plan + pending approval ──

  it('handles message with steps, plan, and pending approval', () => {
    const steps: ToolStep[] = [{ name: 'search', status: 'used' }];
    const msg = makeMsg({
      role: 'assistant',
      content: 'Found something.',
      plan: '- [x] Search\n- [ ] Confirm',
      steps,
      isStreaming: true,
    });
    const approval: PendingApproval = {
      toolCallId: 'tc_99',
      toolName: 'confirm_action',
      arguments: { action: 'deploy' },
      description: 'Confirm deployment',
    };

    const result = convertDisplayMessage(msg, approval, null);

    expect(result.status).toEqual({ type: 'requires-action', reason: 'tool-calls' });

    const content = result.content as Array<Record<string, unknown>>;
    // text + plan + completed step + pending tool call = 4 parts
    expect(content).toHaveLength(4);
    expect(content[0]).toMatchObject({ type: 'text', text: 'Found something.' });
    expect(content[1]).toMatchObject({ type: 'text', text: '- [x] Search\n- [ ] Confirm' });
    expect(content[2]).toMatchObject({ type: 'tool-call', toolName: 'search', result: 'Tool call completed' });
    expect(content[3]).toMatchObject({ type: 'tool-call', toolName: 'confirm_action', toolCallId: 'tc_99' });
  });
});
