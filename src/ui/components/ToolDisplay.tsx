import React, { useState, useMemo } from 'react';

export interface ToolDisplayProps {
  name: string;
  status: 'used' | 'denied' | 'running';
  args?: Record<string, unknown>;
  result?: string;
}

/**
 * ToolDisplay — compact single-line tool step, expandable to show args/result.
 */
export function ToolDisplay({ name, status, args, result }: ToolDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (args && Object.keys(args).length > 0) || result;

  return (
    <div style={{ fontSize: 12 }}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '3px 0',
          cursor: hasDetails ? 'pointer' : 'default',
          fontFamily: 'var(--t2v-font-mono, monospace)',
          fontSize: 12,
          color: 'var(--t2v-muted, #9F9AA4)',
          textAlign: 'left',
        }}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <StatusIcon status={status} />
        <span style={{ flex: 1 }}>{name}</span>
        {hasDetails && <ChevronIcon rotated={expanded} />}
      </button>

      {expanded && hasDetails && (
        <div
          style={{
            marginLeft: 20,
            paddingLeft: 8,
            borderLeft: '2px solid var(--t2v-border, #E5E7EB)',
            fontSize: 11,
            fontFamily: 'var(--t2v-font-mono, monospace)',
            color: 'var(--t2v-muted, #9F9AA4)',
          }}
        >
          {args && Object.keys(args).length > 0 && (
            <DetailSection label="PARAMS" content={formatJson(args)} />
          )}
          {result && (
            <DetailSection label="RESULT" content={formatResult(result)} />
          )}
        </div>
      )}
    </div>
  );
}

export interface ToolStepGroupProps {
  steps: Array<{
    name: string;
    status: 'used' | 'denied' | 'running';
    args?: Record<string, unknown>;
    result?: string;
  }>;
  isStreaming?: boolean;
}

/**
 * ToolStepGroup — wraps multiple tool steps into a collapsible group.
 *
 * While streaming or any tool is running → expanded (shows individual items).
 * After all tools complete → auto-collapses to summary line.
 * Single completed step → renders as standalone ToolDisplay.
 */
export function ToolStepGroup({ steps, isStreaming }: ToolStepGroupProps) {
  const hasRunning = steps.some((s) => s.status === 'running');
  const autoExpanded = hasRunning || !!isStreaming;

  const [userToggle, setUserToggle] = React.useState<boolean | null>(null);
  const prevAutoRef = React.useRef(autoExpanded);

  React.useEffect(() => {
    if (prevAutoRef.current && !autoExpanded) {
      setUserToggle(null);
    }
    prevAutoRef.current = autoExpanded;
  }, [autoExpanded]);

  if (steps.length === 0) return null;

  if (steps.length === 1 && !hasRunning) {
    const s = steps[0]!;
    return (
      <div style={{ padding: '2px 0' }}>
        <ToolDisplay name={s.name} status={s.status} args={s.args} result={s.result} />
      </div>
    );
  }

  const expanded = userToggle !== null ? userToggle : autoExpanded;
  const completedCount = steps.filter((s) => s.status === 'used').length;
  const deniedCount = steps.filter((s) => s.status === 'denied').length;
  const runningStep = steps.find((s) => s.status === 'running');

  let summaryText: string;
  if (runningStep) {
    summaryText = `Running ${runningStep.name}...`;
  } else {
    const parts: string[] = [];
    if (completedCount > 0) parts.push(`${completedCount} completed`);
    if (deniedCount > 0) parts.push(`${deniedCount} denied`);
    summaryText = `${steps.length} tool calls — ${parts.join(', ')}`;
  }

  return (
    <div style={{ padding: '2px 0' }}>
      <button
        onClick={() => setUserToggle(expanded ? false : true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'var(--t2v-font-mono, monospace)',
          color: 'var(--t2v-muted, #9F9AA4)',
          textAlign: 'left',
        }}
        aria-expanded={expanded}
      >
        <StatusIcon status={runningStep ? 'running' : 'used'} />
        <span style={{ flex: 1 }}>{summaryText}</span>
        <ChevronIcon rotated={expanded} />
      </button>

      {expanded && (
        <div
          style={{
            marginLeft: 6,
            paddingLeft: 8,
            borderLeft: '2px solid var(--t2v-border, #E5E7EB)',
          }}
        >
          {steps.map((step, i) => (
            <ToolDisplay key={i} name={step.name} status={step.status} args={step.args} result={step.result} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ──

function StatusIcon({ status }: { status: string }) {
  const size = 14;
  if (status === 'running') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="var(--t2v-accent, #40D4B6)" strokeWidth={2.5} strokeLinecap="round"
        style={{ animation: 't2v-spin 1s linear infinite', flexShrink: 0 }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (status === 'denied') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="var(--t2v-error, #DC2626)" strokeWidth={2.5}
        strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="var(--t2v-accent, #40D4B6)" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon({ rotated }: { rotated: boolean }) {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 150ms ease', transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function DetailSection({ label, content }: { label: string; content: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflow: 'auto' }}>
        {content}
      </pre>
    </div>
  );
}

function formatJson(obj: Record<string, unknown>): string {
  try { return JSON.stringify(obj, null, 2); }
  catch { return String(obj); }
}

function formatResult(result: string): string {
  try { return JSON.stringify(JSON.parse(result), null, 2); }
  catch { return result; }
}
