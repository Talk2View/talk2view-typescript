/**
 * Talk2View brand tokens, font loader, keyframe injector, and logo component.
 */

import React from 'react';

/* ── Brand Colours ─────────────────────────────────────────────── */

export const T2V_COLORS = {
  dark: '#01161E',
  light: '#F8FAFC',
  midGray: '#9F9AA4',
  lightGray: '#E5E7EB',
  turquoise: '#40D4B6',
  accent: '#40D4B6',
  stormyTeal: '#037171',
  errorRed: '#DC2626',
  errorBg: '#FEF2F2',
} as const;

/* ── Alpha Variants ───────────────────────────────────────────── */

export const T2V_ALPHA = {
  turquoise06: 'rgba(64, 212, 182, 0.06)',
  turquoise08: 'rgba(64, 212, 182, 0.08)',
  turquoise10: 'rgba(64, 212, 182, 0.1)',
  turquoise12: 'rgba(64, 212, 182, 0.12)',
  turquoise15: 'rgba(64, 212, 182, 0.15)',
  turquoise20: 'rgba(64, 212, 182, 0.2)',
  light20: 'rgba(248, 250, 252, 0.2)',
  light30: 'rgba(248, 250, 252, 0.3)',
  light10: 'rgba(248, 250, 252, 0.1)',
  dark10: 'rgba(1, 22, 30, 0.10)',
  dark15: 'rgba(1, 22, 30, 0.15)',
} as const;

export const T2V_SHADOWS = {
  panel: `0 4px 24px ${T2V_ALPHA.dark10}` as const,
  dropdown: `0 4px 16px ${T2V_ALPHA.dark15}` as const,
} as const;

/* ── Themeable CSS Variables ──────────────────────────────────── */
/*
 * SDK components use these CSS-variable-backed tokens so that host apps
 * can override colors and fonts without forking component code.
 *
 * To theme, set CSS custom properties on a parent element:
 *
 *   .my-app {
 *     --t2v-accent: #5ACBCB;
 *     --t2v-text: #ffffff;
 *     --t2v-text-secondary: #a0a0a0;
 *     --t2v-bg: #1e1e2e;
 *     --t2v-border: #333;
 *     --t2v-error: #ff6b6b;
 *     --t2v-font: 'Inter', sans-serif;
 *   }
 */

export const T2V_VARS = {
  accent: `var(--t2v-accent, ${T2V_COLORS.turquoise})`,
  accentDark: `var(--t2v-accent-dark, ${T2V_COLORS.stormyTeal})`,
  accentSubtle: `var(--t2v-accent-subtle, rgba(64, 212, 182, 0.06))`,
  accentMuted: `var(--t2v-accent-muted, rgba(64, 212, 182, 0.10))`,
  accentBorder: `var(--t2v-accent-border, rgba(64, 212, 182, 0.20))`,
  accentBg: `var(--t2v-accent-bg, rgba(64, 212, 182, 0.08))`,
  text: `var(--t2v-text, ${T2V_COLORS.dark})`,
  textSecondary: `var(--t2v-text-secondary, ${T2V_COLORS.midGray})`,
  bg: `var(--t2v-bg, ${T2V_COLORS.light})`,
  border: `var(--t2v-border, ${T2V_COLORS.lightGray})`,
  error: `var(--t2v-error, ${T2V_COLORS.errorRed})`,
  font: `var(--t2v-font, 'IBM Plex Sans', sans-serif)`,
  fontMono: `var(--t2v-font-mono, 'IBM Plex Mono', monospace)`,
} as const;

/* ── Brand Fonts ───────────────────────────────────────────────── */

export const T2V_FONTS = {
  heading: "'IBM Plex Sans', sans-serif",
  body: "'IBM Plex Sans', sans-serif",
  mono: "'IBM Plex Mono', monospace",
} as const;

/* ── Google Fonts Loader (idempotent, SSR-safe) ────────────────── */

let fontsInjected = false;

export function injectT2VFonts(): void {
  if (fontsInjected) return;
  if (typeof document === 'undefined') return;

  const id = 't2v-google-fonts';
  if (document.getElementById(id)) {
    fontsInjected = true;
    return;
  }

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);

  fontsInjected = true;
}

/* ── Keyframe Injector (idempotent) ────────────────────────────── */

let stylesInjected = false;

export function injectT2VStyles(): void {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return;

  const id = 't2v-keyframes';
  if (document.getElementById(id)) {
    stylesInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
@keyframes t2v-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes t2v-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-4px); }
}
@keyframes t2v-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
@keyframes t2v-spin {
  to { transform: rotate(360deg); }
}
@keyframes t2v-shimmer {
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
}
/* Markdown content styles */
.t2v-markdown p { margin: 0 0 0.6em; }
.t2v-markdown p:last-child { margin-bottom: 0; }
.t2v-markdown h1, .t2v-markdown h2, .t2v-markdown h3,
.t2v-markdown h4, .t2v-markdown h5, .t2v-markdown h6 {
  margin: 0.8em 0 0.4em; font-weight: 600; line-height: 1.3;
}
.t2v-markdown h1 { font-size: 1.3em; }
.t2v-markdown h2 { font-size: 1.15em; }
.t2v-markdown h3 { font-size: 1.05em; }
.t2v-markdown ul, .t2v-markdown ol {
  margin: 0.4em 0; padding-left: 1.4em;
}
.t2v-markdown li { margin: 0.2em 0; }
.t2v-markdown code {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.88em; padding: 0.15em 0.35em;
  background: rgba(1, 22, 30, 0.06); border-radius: 4px;
}
.t2v-markdown pre {
  margin: 0.5em 0; padding: 0; border-radius: 6px;
  overflow: hidden; font-size: 0.88em;
  background: rgba(1, 22, 30, 0.04);
}
.t2v-markdown pre code {
  display: block; padding: 0.7em 0.9em;
  background: none; overflow-x: auto;
}
/* Code block header (language + copy) */
.t2v-code-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 10px;
  background: rgba(1, 22, 30, 0.08);
  font-family: 'IBM Plex Sans', sans-serif; font-size: 11px;
  color: ${T2V_COLORS.midGray};
}
.t2v-code-copy {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 6px; border: none; border-radius: 3px;
  background: transparent; color: ${T2V_COLORS.midGray};
  font-family: 'IBM Plex Sans', sans-serif; font-size: 10px;
  cursor: pointer; transition: all 0.15s ease;
}
.t2v-code-copy:hover { background: rgba(1, 22, 30, 0.08); color: ${T2V_COLORS.dark}; }
.t2v-code-copy[data-copied="true"] { color: ${T2V_COLORS.turquoise}; }
/* Message copy button */
.t2v-msg-copy {
  position: absolute; top: 6px; right: 6px;
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 6px;
  border: 1px solid ${T2V_COLORS.lightGray};
  background: ${T2V_COLORS.light}; color: ${T2V_COLORS.midGray};
  cursor: pointer; opacity: 0; transition: all 0.15s ease;
  z-index: 1;
}
.t2v-message:hover .t2v-msg-copy { opacity: 1; }
.t2v-msg-copy:hover { border-color: ${T2V_COLORS.turquoise}; color: ${T2V_COLORS.turquoise}; }
.t2v-msg-copy[data-copied="true"] { color: ${T2V_COLORS.turquoise}; border-color: ${T2V_COLORS.turquoise}; opacity: 1; }
/* Scroll-to-bottom button */
.t2v-scroll-btn {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid ${T2V_COLORS.lightGray};
  background: ${T2V_COLORS.light}; color: ${T2V_COLORS.midGray};
  cursor: pointer; z-index: 10;
  box-shadow: 0 2px 8px rgba(1, 22, 30, 0.12);
  transition: all 0.15s ease;
  animation: t2v-fade-in 0.2s ease-out;
}
.t2v-scroll-btn:hover { border-color: ${T2V_COLORS.turquoise}; color: ${T2V_COLORS.turquoise}; }
.t2v-markdown blockquote {
  margin: 0.5em 0; padding: 0.3em 0.8em;
  border-left: 3px solid ${T2V_COLORS.turquoise};
  color: ${T2V_COLORS.midGray};
}
.t2v-markdown strong { font-weight: 600; }
.t2v-markdown a { color: ${T2V_COLORS.stormyTeal}; text-decoration: underline; }
.t2v-markdown hr { border: none; border-top: 1px solid ${T2V_COLORS.lightGray}; margin: 0.6em 0; }
.t2v-markdown table { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 0.92em; }
.t2v-markdown th, .t2v-markdown td { border: 1px solid ${T2V_COLORS.lightGray}; padding: 0.35em 0.6em; text-align: left; }
.t2v-markdown th { background: rgba(1, 22, 30, 0.04); font-weight: 600; }
/* Plan step — inline checklist */
.t2v-plan-content ul { list-style: none; padding-left: 0; margin: 0; }
.t2v-plan-content li {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 3px 0; font-size: 13px; line-height: 1.45;
  color: ${T2V_COLORS.dark};
}
.t2v-plan-content li:has(input:checked) { color: ${T2V_COLORS.midGray}; text-decoration: line-through; }
.t2v-plan-content input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  width: 16px; height: 16px; min-width: 16px;
  border: 1.5px solid rgba(64, 212, 182, 0.35);
  border-radius: 4px; margin: 1px 0 0 0;
  background: transparent; position: relative;
  cursor: default; transition: all 0.15s ease;
}
.t2v-plan-content input[type="checkbox"]:checked {
  background: ${T2V_COLORS.turquoise}; border-color: ${T2V_COLORS.turquoise};
}
.t2v-plan-content input[type="checkbox"]:checked::after {
  content: ''; position: absolute; left: 4px; top: 1px;
  width: 5px; height: 9px;
  border: solid ${T2V_COLORS.light}; border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
/* Shimmer text animation */
.t2v-shimmer {
  background: linear-gradient(90deg, currentColor 0%, ${T2V_COLORS.turquoise} 50%, currentColor 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: t2v-shimmer 4s ease-in-out infinite;
}
`;
  document.head.appendChild(style);

  stylesInjected = true;
}

/* ── Logo Assets ──────────────────────────────────────────────── */

const T2V_ASSETS_BASE = 'https://db.talk2view.com/storage/v1/object/public/resources';

export const T2V_LOGOS = {
  icon: `${T2V_ASSETS_BASE}/talk2view_logo.png`,
  horizontalDark: `${T2V_ASSETS_BASE}/talk2view_horizontal_dark.png`,
  horizontalLight: `${T2V_ASSETS_BASE}/talk2view_horizontal_light.png`,
} as const;

export type T2VLogoVariant = 'icon' | 'horizontalDark' | 'horizontalLight';

export function T2VLogo({
  size = 28,
  variant = 'icon',
}: {
  size?: number;
  variant?: T2VLogoVariant;
}): React.ReactElement {
  const isHorizontal = variant !== 'icon';
  return React.createElement('img', {
    src: T2V_LOGOS[variant],
    height: size,
    width: isHorizontal ? undefined : size,
    alt: 'Talk2View',
    style: { objectFit: 'contain', display: 'block' },
  });
}
