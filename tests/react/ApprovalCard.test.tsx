import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '../../src/react/ApprovalCard';
import type { PendingApproval } from '../../src/types';

const sampleApproval: PendingApproval = {
  toolCallId: 'call_abc',
  toolName: 'send_email',
  arguments: { to: 'user@test.com', subject: 'Hello', body: 'World' },
  description: 'Send an email on behalf of the user',
};

/** Expand the collapsed arguments section. */
function expandArgs() {
  fireEvent.click(screen.getByText('Arguments'));
}

describe('ApprovalCard', () => {
  it('renders tool name in header and description', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expect(screen.getByText(/Wants to use.*send_email/)).toBeDefined();
    expect(screen.getByText('Send an email on behalf of the user')).toBeDefined();
  });

  it('renders the shield icon and shimmer header', () => {
    const { container } = render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    const shimmer = container.querySelector('.t2v-shimmer');
    expect(shimmer).not.toBeNull();
  });

  it('arguments are collapsed by default', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expect(screen.queryByText(/"to": "user@test.com"/)).toBeNull();
  });

  it('displays arguments as formatted JSON when expanded', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expandArgs();
    const pre = screen.getByText(/"to": "user@test.com"/);
    expect(pre).toBeDefined();
  });

  it('renders Allow Once, Allow Always, and Deny buttons', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expect(screen.getByText('Allow Once')).toBeDefined();
    expect(screen.getByText('Allow Always')).toBeDefined();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('calls onDecision with once action', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Allow Once'));
    expect(onDecision).toHaveBeenCalledWith({ action: 'once', updatedInput: undefined });
  });

  it('calls onDecision with always action', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Allow Always'));
    expect(onDecision).toHaveBeenCalledWith({ action: 'always', updatedInput: undefined });
  });

  it('shows deny feedback input when Deny is clicked', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    fireEvent.click(screen.getByText('Deny'));
    expect(screen.getByPlaceholderText('Corrective feedback (optional)')).toBeDefined();
    expect(screen.getByText('Confirm Deny')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('calls onDecision with deny action and feedback', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));

    const input = screen.getByPlaceholderText('Corrective feedback (optional)');
    fireEvent.change(input, { target: { value: 'Wrong address' } });
    fireEvent.click(screen.getByText('Confirm Deny'));

    expect(onDecision).toHaveBeenCalledWith({ action: 'deny', feedback: 'Wrong address' });
  });

  it('calls onDecision with deny and no feedback', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));
    fireEvent.click(screen.getByText('Confirm Deny'));
    expect(onDecision).toHaveBeenCalledWith({ action: 'deny', feedback: undefined });
  });

  it('submit deny via Enter key', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));

    const input = screen.getByPlaceholderText('Corrective feedback (optional)');
    fireEvent.change(input, { target: { value: 'Try a different tool' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onDecision).toHaveBeenCalledWith({ action: 'deny', feedback: 'Try a different tool' });
  });

  it('cancel in deny mode returns to initial view', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    fireEvent.click(screen.getByText('Deny'));
    expect(screen.getByText('Confirm Deny')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Allow Once')).toBeDefined();
    expect(screen.getByText('Allow Always')).toBeDefined();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('disables buttons when disabled prop is true', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} disabled />);
    const onceBtn = screen.getByText('Allow Once').closest('button') as HTMLButtonElement;
    expect(onceBtn.disabled).toBe(true);
  });
});

describe('ApprovalCard argument editing', () => {
  it('shows Edit button when arguments are expanded', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expandArgs();
    expect(screen.getByText('Edit')).toBeDefined();
  });

  it('switches to textarea when Edit is clicked', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe(JSON.stringify(sampleApproval.arguments, null, 2));
  });

  it('replaces Deny with Cancel Edit in edit mode', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));

    expect(screen.queryByText('Deny')).toBeNull();
    expect(screen.getByText('Cancel Edit')).toBeDefined();
  });

  it('returns to read-only on Cancel Edit', () => {
    render(<ApprovalCard approval={sampleApproval} onDecision={vi.fn()} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel Edit'));

    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('sends updatedInput when args are modified and Allow Once is clicked', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));

    const textarea = document.querySelector('textarea')!;
    const modified = JSON.stringify({ to: 'new@test.com', subject: 'Changed', body: 'Updated' }, null, 2);
    fireEvent.change(textarea, { target: { value: modified } });

    fireEvent.click(screen.getByText('Allow Once'));
    expect(onDecision).toHaveBeenCalledWith({
      action: 'once',
      updatedInput: { to: 'new@test.com', subject: 'Changed', body: 'Updated' },
    });
  });

  it('sends undefined updatedInput when args are not changed', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));

    // Don't change anything, just click Allow Once
    fireEvent.click(screen.getByText('Allow Once'));
    expect(onDecision).toHaveBeenCalledWith({ action: 'once', updatedInput: undefined });
  });

  it('shows error on invalid JSON and prevents submission', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={sampleApproval} onDecision={onDecision} />);
    expandArgs();
    fireEvent.click(screen.getByText('Edit'));

    const textarea = document.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: '{invalid json' } });

    fireEvent.click(screen.getByText('Allow Once'));
    expect(screen.getByText('Invalid JSON')).toBeDefined();
    expect(onDecision).not.toHaveBeenCalled();
  });
});
