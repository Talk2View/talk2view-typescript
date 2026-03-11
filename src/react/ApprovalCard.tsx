/**
 * ApprovalCard — inline UI for human-in-the-loop tool call approval.
 *
 * Styled as a Chainlit-inspired step with a left accent border for
 * visual consistency with PlanStep and ToolStep.
 *
 * Shows the tool name, description, arguments (editable), and
 * Allow Once / Allow Always / Deny buttons.
 *
 * Aligned with Claude Agent SDK's permission model:
 * - Allow = PermissionResultAllow (with optional updatedInput)
 * - Deny  = PermissionResultDeny  (with optional feedback message)
 */

import React, { useCallback, useState } from 'react';
import type { HumanDecision, PendingApproval } from '../types';
import { T2V_ALPHA, T2V_COLORS, T2V_FONTS } from './theme';

export interface ApprovalCardProps {
  approval: PendingApproval;
  onDecision: (decision: HumanDecision) => void;
  disabled?: boolean;
  className?: string;
}

export function ApprovalCard({ approval, onDecision, disabled, className }: ApprovalCardProps) {
  const [showDeny, setShowDeny] = useState(false);
  const [denyFeedback, setDenyFeedback] = useState('');
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [argsExpanded, setArgsExpanded] = useState(false);

  /** Parse edited JSON. Returns { ok, value } to distinguish parse error from no-change. */
  const parseEditedArgs = useCallback((): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } => {
    if (!editing) return { ok: true, value: undefined };
    try {
      const parsed = JSON.parse(editedArgs) as Record<string, unknown>;
      setEditError(null);
      // Only return updatedInput if args actually changed
      if (JSON.stringify(parsed) === JSON.stringify(approval.arguments)) {
        return { ok: true, value: undefined };
      }
      return { ok: true, value: parsed };
    } catch {
      setEditError('Invalid JSON');
      return { ok: false };
    }
  }, [editing, editedArgs, approval.arguments]);

  const handleAllow = useCallback((action: 'once' | 'always') => {
    const result = parseEditedArgs();
    if (!result.ok) return; // parse error
    onDecision({ action, updatedInput: result.value });
  }, [onDecision, parseEditedArgs]);

  const handleDeny = useCallback(() => {
    onDecision({ action: 'deny', feedback: denyFeedback || undefined });
  }, [onDecision, denyFeedback]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setArgsExpanded(true);
    setEditedArgs(JSON.stringify(approval.arguments, null, 2));
    setEditError(null);
  }, [approval.arguments]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditedArgs('');
    setEditError(null);
  }, []);

  return (
    <div
      className={className}
      style={{
        margin: '8px 0',
        borderLeft: `2px solid ${T2V_COLORS.turquoise}`,
        borderRadius: '0 8px 8px 0',
        backgroundColor: T2V_ALPHA.turquoise06,
        overflow: 'hidden',
        animation: 't2v-fade-in 0.25s ease-out',
      }}
    >
      {/* Header — shield icon + tool name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '9px 12px',
        }}
      >
        {/* Shield icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={T2V_COLORS.turquoise}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span className="t2v-shimmer" style={{ fontSize: '12px', fontFamily: T2V_FONTS.heading, fontWeight: 600 }}>
          Wants to use {approval.toolName}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '0 12px 10px' }}>
        {/* Description */}
        {approval.description && (
          <div
            style={{
              fontSize: '12px',
              fontFamily: T2V_FONTS.body,
              color: T2V_COLORS.midGray,
              marginBottom: '8px',
              lineHeight: '1.4',
            }}
          >
            {approval.description}
          </div>
        )}

        {/* Arguments — collapsible, editable */}
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={() => {
              if (editing) return; // don't collapse while editing
              setArgsExpanded((v) => !v);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: 0,
              border: 'none',
              backgroundColor: 'transparent',
              cursor: editing ? 'default' : 'pointer',
              fontSize: '11px',
              fontFamily: T2V_FONTS.heading,
              fontWeight: 600,
              color: T2V_COLORS.midGray,
              marginBottom: argsExpanded ? '6px' : 0,
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: argsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Arguments
          </button>

          {argsExpanded && (
            <>
              {editing ? (
                <div>
                  <textarea
                    value={editedArgs}
                    onChange={(e) => { setEditedArgs(e.target.value); setEditError(null); }}
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: T2V_COLORS.light,
                      border: `1px solid ${editError ? T2V_COLORS.errorRed : T2V_ALPHA.turquoise20}`,
                      fontSize: '11px',
                      fontFamily: T2V_FONTS.mono,
                      color: T2V_COLORS.dark,
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  {editError && (
                    <div style={{ fontSize: '11px', color: T2V_COLORS.errorRed, fontFamily: T2V_FONTS.body, marginTop: '4px' }}>
                      {editError}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(1, 22, 30, 0.03)',
                      border: `1px solid ${T2V_ALPHA.turquoise20}`,
                      fontSize: '11px',
                      fontFamily: T2V_FONTS.mono,
                      color: T2V_COLORS.dark,
                      overflowX: 'auto',
                      maxHeight: '160px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(approval.arguments, null, 2)}
                  </pre>
                  <HoverButton
                    onClick={startEditing}
                    disabled={disabled}
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: `1px solid ${T2V_ALPHA.turquoise20}`,
                      backgroundColor: T2V_COLORS.light,
                      fontSize: '10px',
                      fontFamily: T2V_FONTS.heading,
                      color: T2V_COLORS.midGray,
                    }}
                    hoverStyle={{ borderColor: T2V_COLORS.turquoise, color: T2V_COLORS.turquoise }}
                  >
                    Edit
                  </HoverButton>
                </div>
              )}
            </>
          )}
        </div>

        {/* Deny feedback */}
        {showDeny && (
          <div style={{ marginBottom: '8px' }}>
            <input
              type="text"
              placeholder="Corrective feedback (optional)"
              value={denyFeedback}
              onChange={(e) => setDenyFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDeny(); }}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: '6px',
                border: `1px solid ${T2V_ALPHA.turquoise20}`,
                backgroundColor: T2V_COLORS.light,
                color: T2V_COLORS.dark,
                fontSize: '12px',
                fontFamily: T2V_FONTS.body,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {!showDeny && (
            <>
              <ActionButton
                onClick={() => handleAllow('once')}
                disabled={disabled}
                variant="primary"
                icon={<CheckIcon />}
              >
                Allow Once
              </ActionButton>
              <ActionButton
                onClick={() => handleAllow('always')}
                disabled={disabled}
                variant="secondary"
                icon={<CheckDoubleIcon />}
              >
                Allow Always
              </ActionButton>
              {editing ? (
                <ActionButton
                  onClick={cancelEditing}
                  disabled={disabled}
                  variant="ghost"
                >
                  Cancel Edit
                </ActionButton>
              ) : (
                <ActionButton
                  onClick={() => setShowDeny(true)}
                  disabled={disabled}
                  variant="danger"
                  icon={<XIcon />}
                >
                  Deny
                </ActionButton>
              )}
            </>
          )}
          {showDeny && (
            <>
              <ActionButton
                onClick={handleDeny}
                disabled={disabled}
                variant="danger"
                icon={<XIcon />}
              >
                Confirm Deny
              </ActionButton>
              <ActionButton
                onClick={() => { setShowDeny(false); setDenyFeedback(''); }}
                disabled={disabled}
                variant="ghost"
              >
                Cancel
              </ActionButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Action Button with hover states ─────────────────────────────── */

const VARIANT_STYLES = {
  primary: {
    base: {
      backgroundColor: T2V_COLORS.turquoise,
      color: '#fff',
      border: 'none',
    },
    hover: {
      backgroundColor: T2V_COLORS.stormyTeal,
    },
  },
  secondary: {
    base: {
      backgroundColor: T2V_ALPHA.turquoise10,
      color: T2V_COLORS.dark,
      border: `1px solid ${T2V_ALPHA.turquoise20}`,
    },
    hover: {
      backgroundColor: T2V_ALPHA.turquoise20,
      borderColor: T2V_COLORS.turquoise,
    },
  },
  ghost: {
    base: {
      backgroundColor: 'transparent',
      color: T2V_COLORS.midGray,
      border: `1px solid ${T2V_ALPHA.dark10}`,
    },
    hover: {
      backgroundColor: T2V_ALPHA.dark10,
    },
  },
  danger: {
    base: {
      backgroundColor: 'transparent',
      color: T2V_COLORS.errorRed,
      border: `1px solid rgba(220, 38, 38, 0.25)`,
    },
    hover: {
      backgroundColor: T2V_COLORS.errorBg,
      borderColor: T2V_COLORS.errorRed,
    },
  },
} as const;

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: keyof typeof VARIANT_STYLES;
  icon?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const vs = VARIANT_STYLES[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '5px 12px',
        borderRadius: '6px',
        fontSize: '11px',
        fontFamily: T2V_FONTS.heading,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease',
        ...vs.base,
        ...(hovered && !disabled ? vs.hover : {}),
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── Hover Button (for Edit) ─────────────────────────────────────── */

function HoverButton({
  children,
  onClick,
  disabled,
  style,
  hoverStyle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  style: React.CSSProperties;
  hoverStyle: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease',
        ...style,
        ...(hovered && !disabled ? hoverStyle : {}),
      }}
    >
      {children}
    </button>
  );
}

/* ── Inline SVG Icons ────────────────────────────────────────────── */

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
