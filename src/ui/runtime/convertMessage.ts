/**
 * convertMessage — Converts DisplayMessage (from useT2VChat) to ThreadMessageLike (assistant-ui).
 *
 * Handles text, plan, tool steps, pending approvals, streaming status, and errors.
 */

import type { ThreadMessageLike } from '@assistant-ui/react';
import type { PendingApproval } from '../../types';
import type { DisplayMessage } from '../../react/useT2VChat';

/**
 * Convert a Talk2View DisplayMessage into an assistant-ui ThreadMessageLike.
 *
 * @param msg - The DisplayMessage from useT2VChat
 * @param pendingApproval - If this is the last assistant message and has a pending approval, pass it here
 * @param error - If this is the last assistant message and there's an error, pass the error string
 */
export function convertDisplayMessage(
  msg: DisplayMessage,
  pendingApproval: PendingApproval | null,
  error: string | null,
): ThreadMessageLike {
  if (msg.role === 'user') {
    return {
      role: 'user',
      id: msg.id,
      createdAt: msg.timestamp,
      content: [{ type: 'text' as const, text: msg.content }],
    };
  }

  // Assistant message — build content parts
  const content: NonNullable<Extract<ThreadMessageLike['content'], readonly unknown[]>[number]>[] = [];

  // Main text content
  if (msg.content) {
    content.push({ type: 'text' as const, text: msg.content });
  }

  // Plan output (markdown checklist from write_todos)
  if (msg.plan) {
    content.push({ type: 'text' as const, text: msg.plan });
  }

  // Completed tool steps
  if (msg.steps) {
    for (const step of msg.steps) {
      content.push({
        type: 'tool-call' as const,
        toolName: step.name,
        toolCallId: `step_${step.name}_${msg.id}`,
        args: {} as Record<string, never>,
        result: step.status === 'denied' ? 'Tool call denied' : 'Tool call completed',
        isError: step.status === 'denied',
      });
    }
  }

  // Pending approval — tool call without result triggers requires-action status
  if (pendingApproval) {
    content.push({
      type: 'tool-call' as const,
      toolName: pendingApproval.toolName,
      toolCallId: pendingApproval.toolCallId,
      args: pendingApproval.arguments as Record<string, never>,
    });
  }

  // Determine message status
  let status: ThreadMessageLike['status'];
  if (pendingApproval) {
    status = { type: 'requires-action' as const, reason: 'tool-calls' as const };
  } else if (msg.isStreaming) {
    status = { type: 'running' as const };
  } else if (error) {
    status = { type: 'incomplete' as const, reason: 'error' as const, error };
  } else {
    status = { type: 'complete' as const, reason: 'stop' as const };
  }

  return {
    role: 'assistant',
    id: msg.id,
    createdAt: msg.timestamp,
    content: content.length > 0 ? content : [{ type: 'text' as const, text: '' }],
    status,
  };
}
