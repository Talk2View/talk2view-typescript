import React, { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Shimmer } from './Shimmer';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  startTime?: number;
}

export function ThinkingBlock({ content, isStreaming, startTime }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isStreaming && startTime) {
      intervalRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTime) / 1000));
      }, 1000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    } else if (!isStreaming && startTime) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setDuration(Math.round((Date.now() - startTime) / 1000));
    }
  }, [isStreaming, startTime]);

  useEffect(() => {
    if (!isStreaming && content) {
      const timer = setTimeout(() => setExpanded(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, content]);

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

  const durationText = duration !== null ? `${duration}s` : '';

  return (
    <div style={{
      border: '1px solid var(--t2v-border)', borderRadius: 'calc(var(--t2v-radius) * 0.5px)',
      overflow: 'hidden', margin: '6px 0', fontFamily: 'var(--t2v-font)',
    }}>
      <button onClick={() => setExpanded(!expanded)} className="t2v-btn-ghost" style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', border: 'none', background: 'var(--t2v-surface)',
        cursor: 'pointer', fontFamily: 'var(--t2v-font)', fontSize: '12px',
        color: 'var(--t2v-muted)', fontWeight: 500,
      }}>
        <Brain size={14} />
        <span style={{ flex: 1, textAlign: 'left' }}>
          {isStreaming ? 'Thinking...' : `Thought for ${durationText}`}
        </span>
        <span style={{ display: 'inline-flex', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <ChevronDown size={12} />
        </span>
      </button>
      <div style={{
        maxHeight: expanded ? `${contentHeight}px` : '0px',
        overflow: 'hidden',
        transition: 'max-height 0.2s ease-out',
      }}>
        <div ref={contentRef} style={{
          padding: '8px 12px', fontSize: '13px', lineHeight: 1.5,
          color: 'var(--t2v-muted)', borderTop: '1px solid var(--t2v-border)',
          maxHeight: '200px', overflowY: 'auto',
        }}>
          {isStreaming && !content ? <Shimmer /> : <MarkdownRenderer content={content} />}
        </div>
      </div>
    </div>
  );
}
