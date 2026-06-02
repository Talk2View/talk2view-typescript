import type { Talk2ViewTheme } from '../types';

export const THEME_DEFAULTS: Required<Talk2ViewTheme> = {
  accent: '#40D4B6',
  accentForeground: '#FFFFFF',
  bg: '#F8FAFC',
  foreground: '#01161E',
  muted: '#9F9AA4',
  border: '#E5E7EB',
  // assistant-ui used a light neutral-gray user bubble (--aui-muted) with dark text.
  userBubble: '#F4F4F5',
  userForeground: '#01161E',
  error: '#DC2626',
  radius: 12,
  font: "'IBM Plex Sans', sans-serif",
  fontMono: "'IBM Plex Mono', monospace",
  // Real, visible neutral surfaces (was near-transparent rgba(0,0,0,0.02)).
  surface: '#F4F4F5',
  surfaceHover: '#ECECEE',
  shadow: '0 1px 2px rgba(1,22,30,0.04), 0 2px 12px rgba(1,22,30,0.05)',
};

export function generateThemeCSS(theme: Talk2ViewTheme): string {
  const t = { ...THEME_DEFAULTS, ...theme };
  return `[data-talk2view] {
  --t2v-accent: ${t.accent};
  --t2v-accent-foreground: ${t.accentForeground};
  --t2v-bg: ${t.bg};
  --t2v-foreground: ${t.foreground};
  --t2v-muted: ${t.muted};
  --t2v-border: ${t.border};
  --t2v-user-bubble: ${t.userBubble};
  --t2v-user-foreground: ${t.userForeground};
  --t2v-error: ${t.error};
  --t2v-radius: ${t.radius}px;
  --t2v-radius-sm: ${t.radius * 0.5}px;
  --t2v-radius-md: ${t.radius * 0.75}px;
  --t2v-radius-lg: ${t.radius}px;
  --t2v-radius-xl: ${t.radius * 1.5}px;
  --t2v-radius-pill: 9999px;
  --t2v-font: ${t.font};
  --t2v-font-mono: ${t.fontMono};
  --t2v-surface: ${t.surface};
  --t2v-surface-hover: ${t.surfaceHover};
  --t2v-shadow: ${t.shadow};
}`;
}

export function injectTheme(theme: Talk2ViewTheme): void {
  if (typeof document === 'undefined') return;
  const id = 't2v-theme';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = generateThemeCSS(theme);
}

let fontsInjected = false;
export function injectFonts(): void {
  if (fontsInjected || typeof document === 'undefined') return;
  const id = 't2v-fonts';
  if (document.getElementById(id)) { fontsInjected = true; return; }
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
  document.head.appendChild(link);
  fontsInjected = true;
}

const ASSETS_BASE = 'https://db.talk2view.com/storage/v1/object/public/resources';
export const LOGOS = {
  icon: `${ASSETS_BASE}/talk2view_logo.png`,
  horizontalDark: `${ASSETS_BASE}/talk2view_horizontal_dark.png`,
  horizontalLight: `${ASSETS_BASE}/talk2view_horizontal_light.png`,
} as const;
