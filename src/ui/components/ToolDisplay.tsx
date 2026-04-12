import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Check, X, Loader2, ChevronDown, Wrench } from 'lucide-react';

export interface ToolDisplayProps {
  name: string;
  status: 'used' | 'denied' | 'running';
  args?: Record<string, unknown>;
  result?: string;
}

export function ToolDisplay({ name, status, args, result }: ToolDisplayProps) {
  // Default expanded when completed, collapsed when running
  const [expanded, setExpanded] = useState(status !== 'running');
  const [contentHeight, setContentHeight] = useState<number>(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isRunning = status === 'running';
  const isDenied = status === 'denied';
  const hasDetails = (args && Object.keys(args).length > 0) || result;

  // ResizeObserver to track inner content height for smooth max-height transition
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContentHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{
      border: '1px solid var(--t2v-border)',
      borderRadius: '8px',
      overflow: 'hidden',
      margin: '4px 0',
      fontFamily: 'var(--t2v-font)',
    }}>
      {/* Header */}
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          border: 'none',
          background: 'transparent',
          cursor: hasDetails ? 'pointer' : 'default',
          fontFamily: 'var(--t2v-font)',
          color: 'var(--t2v-foreground)',
          textAlign: 'left',
        }}
      >
        {/* Wrench icon */}
        <Wrench size={15} style={{ color: 'var(--t2v-muted)', flexShrink: 0 }} />

        {/* Tool name */}
        <span style={{
          fontWeight: 600,
          fontSize: '14px',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {name}
        </span>

        {/* Status badge */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '12px',
          fontWeight: 500,
          color: isDenied ? 'var(--t2v-error)' : isRunning ? 'var(--t2v-muted)' : 'var(--t2v-accent)',
        }}>
          {isRunning ? (
            <Loader2 size={13} style={{ animation: 't2v-spin 1s linear infinite' }} />
          ) : isDenied ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
          {isDenied ? 'Denied' : isRunning ? 'Running...' : 'Completed'}
        </span>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Chevron */}
        {hasDetails && (
          <ChevronDown
            size={16}
            style={{
              color: 'var(--t2v-muted)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
            }}
          />
        )}
      </button>

      {/* Expanded detail — always rendered, controlled via max-height for smooth transition */}
      {hasDetails && (
        <div style={{
          maxHeight: expanded ? `${contentHeight}px` : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.2s ease-out',
        }}>
          <div ref={contentRef} style={{ padding: '4px 16px 16px' }}>
            {args && Object.keys(args).length > 0 && (
              <DetailSection label="PARAMETERS" json={JSON.stringify(args, null, 2)} />
            )}
            {result && (
              <DetailSection label="RESULT" json={result} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders a labeled JSON section with syntax coloring */
function DetailSection({ label, json }: { label: string; json: string }) {
  const coloredHtml = useMemo(() => colorizeJson(json), [json]);

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        color: 'var(--t2v-muted)',
        letterSpacing: '0.5px',
        marginBottom: '8px',
      }}>
        {label}
      </div>
      <pre
        dangerouslySetInnerHTML={{ __html: coloredHtml }}
        style={{
          margin: 0,
          padding: '4px 0',
          fontSize: '13px',
          fontFamily: 'var(--t2v-font-mono)',
          lineHeight: 1.6,
          overflow: 'auto',
          maxHeight: '200px',
          color: 'var(--t2v-foreground)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'transparent',
        }}
      />
    </div>
  );
}

/** Simple JSON syntax coloring — no external dependency */
function colorizeJson(json: string): string {
  return json.replace(
    /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|((?:true|false|null))|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, key, colon, str, bool, num) => {
      if (key && colon) {
        // JSON key
        return `<span style="color:#b91c1c">${key}</span>${colon}`;
      }
      if (str) {
        // String value
        return `<span style="color:#166534">${str}</span>`;
      }
      if (bool) {
        // Boolean / null
        return `<span style="color:#9333ea">${bool}</span>`;
      }
      if (num) {
        // Number
        return `<span style="color:#b45309">${num}</span>`;
      }
      return match;
    },
  );
}
