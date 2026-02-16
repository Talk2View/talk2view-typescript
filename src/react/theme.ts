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
`;
  document.head.appendChild(style);

  stylesInjected = true;
}

/* ── Logo Assets (hosted on Supabase Storage) ─────────────────── */

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
