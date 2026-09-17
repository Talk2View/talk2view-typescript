import { describe, expect, it } from 'vitest';
import {
  APPROVAL_OPTION_IDS,
  approvalPart,
  stepToolCallId,
  toHumanDecision,
  toThreadMessage,
} from '../../src/assistant-ui/convert';
import type { DisplayMessage, PendingApproval } from '../../src/types';

const at = new Date('2026-09-16T10:00:00Z');
const quiet = { isLast: false, pendingApproval: null, error: null };

function assistant(over: Partial<DisplayMessage> = {}): DisplayMessage {
  return { id: 'a1', role: 'assistant', content: 'Hello', timestamp: at, ...over };
}

describe('toThreadMessage', () => {
  it('maps a user message with its attachments', () => {
    const out = toThreadMessage(
      {
        id: 'u1', role: 'user', content: 'Look at this', timestamp: at,
        attachments: [{ id: 'att-9', filename: 'scan.png', mime_type: 'image/png', size_bytes: 10 }],
      },
      quiet,
    );
    expect(out).toMatchObject({
      id: 'u1', role: 'user', createdAt: at,
      content: [{ type: 'text', text: 'Look at this' }],
      attachments: [{ id: 'att-9', type: 'image', name: 'scan.png', contentType: 'image/png', status: { type: 'complete' } }],
    });
  });

  it('marks a streaming reply as running and a finished one as complete', () => {
    expect(toThreadMessage(assistant({ isStreaming: true }), { ...quiet, isLast: true }).status)
      .toEqual({ type: 'running' });
    expect(toThreadMessage(assistant(), { ...quiet, isLast: true }).status)
      .toEqual({ type: 'complete', reason: 'stop' });
  });

  it('renders completed steps as tool-call parts before the text', () => {
    const out = toThreadMessage(
      assistant({
        steps: [
          { name: 'get_time', status: 'used', args: {}, result: '10:00' },
          { name: 'delete_all', status: 'denied' },
          { name: 'search', status: 'running', args: { q: 'x' } },
        ],
      }),
      quiet,
    );
    expect(out.content).toEqual([
      { type: 'tool-call', toolCallId: stepToolCallId('a1', 0), toolName: 'get_time', args: {}, result: '10:00', isError: false },
      { type: 'tool-call', toolCallId: stepToolCallId('a1', 1), toolName: 'delete_all', args: {}, result: 'Denied by the user', isError: true },
      { type: 'tool-call', toolCallId: stepToolCallId('a1', 2), toolName: 'search', args: { q: 'x' } },
      { type: 'text', text: 'Hello' },
    ]);
  });

  it('carries the plan as a data part and keeps an empty reply renderable', () => {
    const out = toThreadMessage(assistant({ content: '', plan: '- [ ] step' }), quiet);
    expect(out.content).toEqual([{ type: 'data-plan', data: { markdown: '- [ ] step' } }]);
    expect(toThreadMessage(assistant({ content: '' }), quiet).content).toEqual([{ type: 'text', text: '' }]);
  });

  it('puts the pending approval on the last assistant message only', () => {
    const pending: PendingApproval = {
      toolCallId: 'call-7', toolName: 'send_email', arguments: { to: 'a@b.c' }, description: 'Send an email',
    };
    // The SDK records a running step for the gated tool; the gate replaces it.
    const last = toThreadMessage(
      assistant({ content: '', steps: [{ name: 'send_email', status: 'running', args: { to: 'a@b.c' } }] }),
      { isLast: true, pendingApproval: pending, error: null },
    );
    expect(last.status).toEqual({ type: 'requires-action', reason: 'tool-calls' });
    expect(last.content).toEqual([approvalPart(pending)]);
    // Without a running step (defensive), the gate is still shown.
    expect(toThreadMessage(assistant({ content: '' }), { isLast: true, pendingApproval: pending, error: null }).content)
      .toEqual([approvalPart(pending)]);
    expect(approvalPart(pending)).toMatchObject({
      toolCallId: 'call-7',
      approval: {
        id: 'call-7',
        prompt: 'Send an email',
        allowFreeform: true,
        options: [
          { id: APPROVAL_OPTION_IDS.once, kind: 'allow-once' },
          { id: APPROVAL_OPTION_IDS.always, kind: 'allow-always' },
          { id: APPROVAL_OPTION_IDS.deny, kind: 'reject-once' },
        ],
      },
    });

    const earlier = toThreadMessage(assistant(), { isLast: false, pendingApproval: pending, error: null });
    expect(earlier.status).toEqual({ type: 'complete', reason: 'stop' });
    expect(earlier.content.length).toBe(1);
  });

  it('reports the SDK error on the last message', () => {
    const out = toThreadMessage(assistant(), { isLast: true, pendingApproval: null, error: 'Server unreachable' });
    expect(out.status).toEqual({ type: 'incomplete', reason: 'error', error: 'Server unreachable' });
  });
});

describe('toHumanDecision', () => {
  it('maps the three stock options onto once / always / deny', () => {
    expect(toHumanDecision({ approved: true, optionId: APPROVAL_OPTION_IDS.once })).toEqual({ action: 'once' });
    expect(toHumanDecision({ approved: true, optionId: APPROVAL_OPTION_IDS.always })).toEqual({ action: 'always' });
    expect(toHumanDecision({ approved: false, optionId: APPROVAL_OPTION_IDS.deny })).toEqual({ action: 'deny' });
  });

  it('falls back to the approved flag when no option id is sent', () => {
    expect(toHumanDecision({ approved: true })).toEqual({ action: 'once' });
    expect(toHumanDecision({ approved: false })).toEqual({ action: 'deny' });
  });

  it('carries free-form text through as feedback', () => {
    expect(toHumanDecision({ approved: false, optionId: APPROVAL_OPTION_IDS.deny, text: 'Wrong recipient' }))
      .toEqual({ action: 'deny', feedback: 'Wrong recipient' });
  });
});
