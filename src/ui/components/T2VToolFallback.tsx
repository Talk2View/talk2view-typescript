/**
 * T2VToolFallback — Renders tool call UI for assistant-ui Thread.
 *
 * When a tool call requires approval (status === "requires-action"),
 * renders a clean inline approval card matching assistant-ui's aesthetic.
 *
 * When a tool call is completed, renders a compact step indicator.
 */

import React, { useCallback, useState } from 'react';
import { useT2V } from '../../react/T2VProvider';
import type { HumanDecision } from '../../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const T2VToolFallback: React.FC<any> = (props) => {
  const { toolName, toolCallId, args, isError, status, addResult } = props as {
    toolName: string;
    toolCallId: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
    status: { type: string; reason?: string };
    addResult: (result: unknown) => void;
  };

  const { t2v } = useT2V();

  if (status.type === 'requires-action') {
    const description =
      t2v.tools.getDescription(toolName) ||
      `The assistant wants to use ${toolName}`;

    return (
      <ApprovalUI
        toolName={toolName}
        toolCallId={toolCallId}
        args={args}
        description={description}
        onDecision={(decision) => addResult(decision)}
      />
    );
  }

  // Completed tool call — compact step indicator
  const isDenied = isError === true;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 0',
      fontSize: '0.8125rem',
      color: 'var(--aui-muted-foreground, #888)',
    }}>
      {isDenied ? <XCircleIcon /> : <CheckCircleIcon />}
      <span style={{ color: isDenied ? 'var(--aui-destructive, #dc2626)' : undefined }}>
        {isDenied ? 'Denied' : 'Used'} <strong>{toolName}</strong>
      </span>
    </div>
  );
};

/* ── Inline Approval UI ───────────────────────────────────────── */

function ApprovalUI({
  toolName,
  toolCallId,
  args,
  description,
  onDecision,
}: {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  description: string;
  onDecision: (decision: HumanDecision) => void;
}) {
  const [showArgs, setShowArgs] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [showDeny, setShowDeny] = useState(false);
  const [denyFeedback, setDenyFeedback] = useState('');

  const parseEditedArgs = useCallback((): Record<string, unknown> | undefined => {
    if (!editing) return undefined;
    try {
      const parsed = JSON.parse(editedArgs) as Record<string, unknown>;
      setEditError(null);
      if (JSON.stringify(parsed) === JSON.stringify(args)) return undefined;
      return parsed;
    } catch {
      setEditError('Invalid JSON');
      return undefined;
    }
  }, [editing, editedArgs, args]);

  const handleAllow = useCallback((action: 'once' | 'always') => {
    if (editing) {
      const updated = parseEditedArgs();
      if (editError) return;
      onDecision({ action, updatedInput: updated });
    } else {
      onDecision({ action });
    }
  }, [onDecision, editing, parseEditedArgs, editError]);

  const handleDeny = useCallback(() => {
    onDecision({ action: 'deny', feedback: denyFeedback || undefined });
  }, [onDecision, denyFeedback]);

  return (
    <div style={{
      margin: '8px 0',
      borderRadius: '0.75rem',
      border: '1px solid var(--aui-border, #e5e7eb)',
      overflow: 'hidden',
      fontSize: '0.875rem',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 14px',
        borderBottom: '1px solid var(--aui-border, #e5e7eb)',
        backgroundColor: 'var(--aui-muted, #f9fafb)',
      }}>
        <ShieldIcon />
        <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>
          {toolName}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px' }}>
        {/* Description */}
        <p style={{
          margin: '0 0 10px',
          fontSize: '0.8125rem',
          color: 'var(--aui-muted-foreground, #888)',
          lineHeight: 1.4,
        }}>
          {description}
        </p>

        {/* Arguments toggle */}
        <button
          onClick={() => { if (!editing) setShowArgs((v) => !v); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: editing ? 'default' : 'pointer',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--aui-muted-foreground, #888)',
            marginBottom: showArgs ? '8px' : 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: showArgs ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Arguments
        </button>

        {showArgs && (
          editing ? (
            <div>
              <textarea
                value={editedArgs}
                onChange={(e) => { setEditedArgs(e.target.value); setEditError(null); }}
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '8px',
                  borderRadius: '0.5rem',
                  border: `1px solid ${editError ? 'var(--aui-destructive, #dc2626)' : 'var(--aui-border, #e5e7eb)'}`,
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              {editError && (
                <div style={{ fontSize: '0.75rem', color: 'var(--aui-destructive, #dc2626)', marginTop: '4px' }}>
                  {editError}
                </div>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <pre style={{
                margin: 0,
                padding: '8px',
                borderRadius: '0.5rem',
                backgroundColor: 'var(--aui-muted, #f9fafb)',
                border: '1px solid var(--aui-border, #e5e7eb)',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: '120px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {JSON.stringify(args, null, 2)}
              </pre>
              <button
                onClick={() => {
                  setEditing(true);
                  setShowArgs(true);
                  setEditedArgs(JSON.stringify(args, null, 2));
                }}
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  padding: '2px 8px',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--aui-border, #e5e7eb)',
                  backgroundColor: 'var(--aui-background, #fff)',
                  fontSize: '0.6875rem',
                  cursor: 'pointer',
                  color: 'var(--aui-muted-foreground, #888)',
                }}
              >
                Edit
              </button>
            </div>
          )
        )}

        {/* Deny feedback input */}
        {showDeny && (
          <div style={{ marginTop: '8px' }}>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={denyFeedback}
              onChange={(e) => setDenyFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDeny(); }}
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: '0.5rem',
                border: '1px solid var(--aui-border, #e5e7eb)',
                fontSize: '0.8125rem',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '8px 14px 12px',
      }}>
        {!showDeny ? (
          <>
            <ActionBtn variant="primary" onClick={() => handleAllow('once')}>
              <CheckIcon /> Allow Once
            </ActionBtn>
            <ActionBtn variant="secondary" onClick={() => handleAllow('always')}>
              <CheckDoubleIcon /> Always
            </ActionBtn>
            {editing ? (
              <ActionBtn variant="ghost" onClick={() => { setEditing(false); setEditedArgs(''); setEditError(null); }}>
                Cancel
              </ActionBtn>
            ) : (
              <ActionBtn variant="destructive" onClick={() => setShowDeny(true)}>
                <XIcon /> Deny
              </ActionBtn>
            )}
          </>
        ) : (
          <>
            <ActionBtn variant="destructive" onClick={handleDeny}>
              <XIcon /> Deny
            </ActionBtn>
            <ActionBtn variant="ghost" onClick={() => { setShowDeny(false); setDenyFeedback(''); }}>
              Cancel
            </ActionBtn>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Action Button ────────────────────────────────────────────── */

const VARIANTS = {
  primary: {
    base: { backgroundColor: 'var(--aui-primary, #18181b)', color: 'var(--aui-primary-foreground, #fff)' },
    hover: { opacity: '0.9' },
  },
  secondary: {
    base: { backgroundColor: 'var(--aui-muted, #f4f4f5)', color: 'var(--aui-foreground, #18181b)', border: '1px solid var(--aui-border, #e5e7eb)' },
    hover: { backgroundColor: 'var(--aui-accent, #e4e4e7)' },
  },
  ghost: {
    base: { backgroundColor: 'transparent', color: 'var(--aui-muted-foreground, #888)' },
    hover: { backgroundColor: 'var(--aui-muted, #f4f4f5)' },
  },
  destructive: {
    base: { backgroundColor: 'transparent', color: 'var(--aui-destructive, #dc2626)', border: '1px solid color-mix(in srgb, var(--aui-destructive, #dc2626) 25%, transparent)' },
    hover: { backgroundColor: 'color-mix(in srgb, var(--aui-destructive, #dc2626) 8%, transparent)' },
  },
} as const;

function ActionBtn({
  children,
  onClick,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant: keyof typeof VARIANTS;
}) {
  const [hovered, setHovered] = useState(false);
  const v = VARIANTS[variant];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '5px 12px',
        borderRadius: '0.5rem',
        border: 'none',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        ...v.base,
        ...(hovered ? v.hover : {}),
      }}
    >
      {children}
    </button>
  );
}

/* ── Icons ────────────────────────────────────────────────────── */

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--aui-muted-foreground, #888)' }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CheckDoubleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 6 7 17 2 12" />
      <polyline points="22 10 13 21" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 12 15 16 10" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--aui-destructive, #dc2626)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
