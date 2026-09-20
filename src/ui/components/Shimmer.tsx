import React from 'react';

export function Shimmer() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--t2v-muted)',
          opacity: 0.4,
          animation: `t2v-typing 1.4s ${i * 0.2}s infinite ease-in-out`,
        }} />
      ))}
    </div>
  );
}
