/**
 * ApprovalCard — HITL approval UI for a tool call requiring human review.
 *
 * Visual design mirrors the 0.3.3 assistant-ui `T2VToolFallback` approval card:
 * a Shield + tool-name header on a muted surface, a description line, an
 * "Arguments" disclosure (with inline Edit), and dark/muted/red-ghost action
 * buttons (Allow Once / Always / Deny). Colors use the --t2v-* token system.
 */

import React, { useCallback, useState } from 'react';
import { Shield, Check, CheckCheck, X, ChevronDown } from 'lucide-react';
import type { HumanDecision } from '../../types.js';

export interface ApprovalCardProps {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  description: string;
  onDecision: (decision: HumanDecision) => void | Promise<void>;
}

export function ApprovalCard({ toolName, args, description, onDecision }: ApprovalCardProps) {
  const [showArgs, setShowArgs] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [showDeny, setShowDeny] = useState(false);
  const [denyFeedback, setDenyFeedback] = useState('');

  const handleAllow = useCallback(
    (action: 'once' | 'always') => {
      let updatedInput: Record<string, unknown> | undefined;
      if (editing) {
        try {
          const parsed = JSON.parse(editedArgs) as Record<string, unknown>;
          updatedInput = JSON.stringify(parsed) === JSON.stringify(args) ? undefined : parsed;
        } catch {
          setEditError('Invalid JSON');
          return;
        }
      }
      Promise.resolve(onDecision({ action, updatedInput })).catch(() => {});
    },
    [onDecision, editing, editedArgs, args],
  );

  const handleDeny = useCallback(() => {
    Promise.resolve(onDecision({ action: 'deny', feedback: denyFeedback || undefined })).catch(() => {});
  }, [onDecision, denyFeedback]);

  return (
    <div
      role="region"
      aria-label={`Tool approval required: ${toolName}`}
      style={{
        margin: '8px 0',
        borderRadius: 'var(--t2v-radius-lg)',
        border: '1px solid var(--t2v-border)',
        overflow: 'hidden',
        fontSize: '0.875rem',
        fontFamily: 'var(--t2v-font)',
        animation: 't2v-fade-in 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderBottom: '1px solid var(--t2v-border)',
          background: 'var(--t2v-surface)',
        }}
      >
        <span style={{ color: 'var(--t2v-muted)', display: 'inline-flex' }}>
          <Shield size={14} />
        </span>
        <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--t2v-foreground)' }}>{toolName}</span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px' }}>
        <p
          style={{
            margin: '0 0 10px',
            fontSize: '0.8125rem',
            color: 'var(--t2v-muted)',
            lineHeight: 1.4,
          }}
        >
          {description}
        </p>

        {/* Arguments disclosure */}
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
            color: 'var(--t2v-muted)',
            marginBottom: showArgs ? '8px' : 0,
          }}
          aria-expanded={showArgs}
        >
          <ChevronDown
            size={12}
            style={{
              transform: showArgs ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s ease',
            }}
          />
          Arguments
        </button>

        {showArgs &&
          (editing ? (
            <div>
              <textarea
                value={editedArgs}
                onChange={(e) => { setEditedArgs(e.target.value); setEditError(null); }}
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '8px',
                  borderRadius: 'var(--t2v-radius-md)',
                  border: `1px solid ${editError ? 'var(--t2v-error)' : 'var(--t2v-border)'}`,
                  fontSize: '0.75rem',
                  fontFamily: 'var(--t2v-font-mono)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: 'var(--t2v-bg)',
                  color: 'var(--t2v-foreground)',
                }}
              />
              {editError && (
                <div style={{ fontSize: '0.75rem', color: 'var(--t2v-error)', marginTop: '4px' }}>{editError}</div>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  borderRadius: 'var(--t2v-radius-md)',
                  background: 'var(--t2v-surface)',
                  border: '1px solid var(--t2v-border)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--t2v-font-mono)',
                  overflowX: 'auto',
                  maxHeight: '120px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--t2v-foreground)',
                }}
              >
                {JSON.stringify(args, null, 2)}
              </pre>
              <button
                onClick={() => { setEditing(true); setShowArgs(true); setEditedArgs(JSON.stringify(args, null, 2)); }}
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  padding: '2px 8px',
                  borderRadius: 'var(--t2v-radius-sm)',
                  border: '1px solid var(--t2v-border)',
                  background: 'var(--t2v-bg)',
                  fontSize: '0.6875rem',
                  cursor: 'pointer',
                  color: 'var(--t2v-muted)',
                  fontFamily: 'var(--t2v-font)',
                }}
              >
                Edit
              </button>
            </div>
          ))}

        {/* Deny feedback */}
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
                borderRadius: 'var(--t2v-radius-md)',
                border: '1px solid var(--t2v-border)',
                fontSize: '0.8125rem',
                boxSizing: 'border-box',
                outline: 'none',
                background: 'var(--t2v-bg)',
                color: 'var(--t2v-foreground)',
                fontFamily: 'var(--t2v-font)',
              }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', padding: '8px 14px 12px' }}>
        {!showDeny ? (
          <>
            <ActionBtn variant="primary" onClick={() => handleAllow('once')}>
              <Check size={12} /> Allow Once
            </ActionBtn>
            <ActionBtn variant="secondary" onClick={() => handleAllow('always')}>
              <CheckCheck size={12} /> Always
            </ActionBtn>
            {editing ? (
              <ActionBtn variant="ghost" onClick={() => { setEditing(false); setEditedArgs(''); setEditError(null); }}>
                Cancel
              </ActionBtn>
            ) : (
              <ActionBtn variant="destructive" onClick={() => setShowDeny(true)}>
                <X size={12} /> Deny
              </ActionBtn>
            )}
          </>
        ) : (
          <>
            <ActionBtn variant="destructive" onClick={handleDeny}>
              <X size={12} /> Deny
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

/* ── Action button ────────────────────────────────────────────── */

const VARIANTS = {
  primary: {
    base: { background: 'var(--t2v-foreground)', color: '#fff', border: '1px solid transparent' },
    hover: { opacity: 0.9 },
  },
  secondary: {
    base: { background: 'var(--t2v-surface)', color: 'var(--t2v-foreground)', border: '1px solid var(--t2v-border)' },
    hover: { background: 'var(--t2v-surface-hover)' },
  },
  ghost: {
    base: { background: 'transparent', color: 'var(--t2v-muted)', border: '1px solid transparent' },
    hover: { background: 'var(--t2v-surface)' },
  },
  destructive: {
    base: {
      background: 'transparent',
      color: 'var(--t2v-error)',
      border: '1px solid color-mix(in srgb, var(--t2v-error) 25%, transparent)',
    },
    hover: { background: 'color-mix(in srgb, var(--t2v-error) 8%, transparent)' },
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
        borderRadius: 'var(--t2v-radius-md)',
        fontSize: '0.75rem',
        fontWeight: 600,
        fontFamily: 'var(--t2v-font)',
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
