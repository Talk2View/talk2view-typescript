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

/* ── Brand Fonts ───────────────────────────────────────────────── */

export const T2V_FONTS = {
  heading: "'IBM Plex Sans', sans-serif",
  body: "'IBM Plex Sans', sans-serif",
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
  margin: 0.5em 0; padding: 0.7em 0.9em;
  background: rgba(1, 22, 30, 0.06); border-radius: 6px;
  overflow-x: auto; font-size: 0.88em;
}
.t2v-markdown pre code {
  padding: 0; background: none;
}
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
