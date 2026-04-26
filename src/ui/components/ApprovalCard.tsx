import React, { useState } from 'react';
import { Zap, ChevronDown } from 'lucide-react';
import type { HumanDecision } from '../../types';

export interface ApprovalCardProps {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  description: string;
  onDecision: (decision: HumanDecision) => void | Promise<void>;
}

export function ApprovalCard({ toolName, toolCallId, args, description, onDecision }: ApprovalCardProps) {
  const [showArgs, setShowArgs] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState(JSON.stringify(args, null, 2));
  const [editError, setEditError] = useState<string | null>(null);
  const [showDeny, setShowDeny] = useState(false);
  const [denyFeedback, setDenyFeedback] = useState('');

  const handleApprove = (action: 'once' | 'always') => {
    let updatedInput: Record<string, unknown> | undefined;
    if (editing) {
      try { updatedInput = JSON.parse(editedArgs); }
      catch { setEditError('Invalid JSON'); return; }
    }
    Promise.resolve(onDecision({ action, updatedInput })).catch(() => {});
  };

  const handleDeny = () => {
    Promise.resolve(onDecision({ action: 'deny', feedback: denyFeedback || undefined })).catch(() => {});
  };

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--t2v-border)',
    borderRadius: 'calc(var(--t2v-radius) * 0.75px)',
    overflow: 'hidden', margin: '8px 0',
    animation: 't2v-fade-in 0.2s ease-out',
    fontSize: '13px', fontFamily: 'var(--t2v-font)',
  };

  const btnBase: React.CSSProperties = {
    padding: '6px 12px', borderRadius: '6px', border: 'none',
    cursor: 'pointer', fontSize: '12px', fontWeight: 500,
    fontFamily: 'var(--t2v-font)', transition: 'all 0.15s',
  };

  return (
    <div style={cardStyle} role="region" aria-label={`Tool approval required: ${toolName}`}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 12px', background: 'var(--t2v-surface)',
        borderBottom: '1px solid var(--t2v-border)', fontWeight: 500,
      }}>
        <span style={{ color: 'var(--t2v-accent)', display: 'inline-flex' }}><Zap size={14} /></span>
        <span>{toolName}</span>
        {description && (
          <span style={{ color: 'var(--t2v-muted)', fontWeight: 400, fontSize: '12px' }}>— {description}</span>
        )}
      </div>

      <div style={{ padding: '10px 12px' }}>
        {Object.keys(args).length > 0 && (
          <button onClick={() => { setShowArgs(!showArgs); setEditing(false); setEditError(null); }}
            style={{ ...btnBase, background: 'transparent', color: 'var(--t2v-muted)', padding: '4px 0', fontSize: '12px' }}>
            <><ChevronDown size={12} style={{ transform: showArgs ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block' }} /> {showArgs ? 'Hide arguments' : 'Show arguments'}</>
          </button>
        )}

        {showArgs && (
          <div style={{ margin: '6px 0' }}>
            {editing ? (
              <>
                <textarea value={editedArgs}
                  onChange={(e) => { setEditedArgs(e.target.value); setEditError(null); }}
                  style={{
                    width: '100%', minHeight: '80px', padding: '8px',
                    fontFamily: 'var(--t2v-font-mono)', fontSize: '12px',
                    border: `1px solid ${editError ? 'var(--t2v-error)' : 'var(--t2v-border)'}`,
                    borderRadius: '4px', resize: 'vertical',
                    background: 'var(--t2v-bg)', color: 'var(--t2v-foreground)',
                  }} />
                {editError && <div style={{ color: 'var(--t2v-error)', fontSize: '11px', marginTop: '4px' }}>{editError}</div>}
              </>
            ) : (
              <pre style={{
                padding: '8px', background: 'var(--t2v-surface)', borderRadius: '4px',
                fontSize: '12px', fontFamily: 'var(--t2v-font-mono)',
                overflow: 'auto', maxHeight: '120px', margin: 0,
              }}>
                {JSON.stringify(args, null, 2)}
              </pre>
            )}
            <button onClick={() => setEditing(!editing)}
              style={{ ...btnBase, background: 'transparent', color: 'var(--t2v-accent)', padding: '4px 0', fontSize: '11px', marginTop: '4px' }}>
              {editing ? 'Cancel edit' : 'Edit'}
            </button>
          </div>
        )}

        {showDeny && (
          <div style={{ margin: '8px 0' }}>
            <input type="text" placeholder="Reason for denying (optional)"
              value={denyFeedback} onChange={(e) => setDenyFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDeny(); }}
              style={{
                width: '100%', padding: '6px 8px', border: '1px solid var(--t2v-border)',
                borderRadius: '4px', fontSize: '12px', fontFamily: 'var(--t2v-font)',
                background: 'var(--t2v-bg)', color: 'var(--t2v-foreground)',
              }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => handleApprove('once')} className="t2v-btn"
            style={{ ...btnBase, background: 'var(--t2v-accent)', color: 'var(--t2v-accent-foreground)' }}>
            Allow Once
          </button>
          <button onClick={() => handleApprove('always')} className="t2v-btn"
            style={{ ...btnBase, background: 'transparent', border: '1px solid var(--t2v-accent)', color: 'var(--t2v-accent)' }}>
            Allow Always
          </button>
          {showDeny ? (
            <button onClick={handleDeny} className="t2v-btn"
              style={{ ...btnBase, background: 'rgba(220,38,38,0.08)', color: 'var(--t2v-error)' }}>
              Confirm Deny
            </button>
          ) : (
            <button onClick={() => setShowDeny(true)} className="t2v-btn"
              style={{ ...btnBase, background: 'transparent', color: 'var(--t2v-muted)' }}>
              Deny
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
