'use client';

/**
 * The launcher's colourway, and whether the visitor has met it before.
 *
 * The three colourways are the brand's own logomark pairings (brand book,
 * "Logo" — each is named for its background):
 *
 * | value        | tile   | mark   |
 * |--------------|--------|--------|
 * | `smoke-teal` | Teal   | Smoke  |
 * | `teal-smoke` | Smoke  | Teal   |
 * | `teal-white` | white  | Teal   |
 *
 * The integrator picks one with `colourway`. With `visitorColourway` they also
 * let the end-user pick, from Settings; that choice is remembered in
 * localStorage and broadcast on a DOM event, so the launcher repaints the moment
 * it changes. The paint itself is in `styles/chat.src.css`, keyed on the
 * `data-launcher-variant` attribute this module's value is written to.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';

export const LAUNCHER_COLOURWAYS = ['smoke-teal', 'teal-smoke', 'teal-white'] as const;
export type LauncherColourway = (typeof LAUNCHER_COLOURWAYS)[number];
export const DEFAULT_LAUNCHER_COLOURWAY: LauncherColourway = 'smoke-teal';

export const LAUNCHER_COLOURWAY_LABELS: Record<LauncherColourway, string> = {
  'smoke-teal': 'Smoke on Teal',
  'teal-smoke': 'Teal on Smoke',
  'teal-white': 'Teal on white',
};

const COLOURWAY_KEY = 't2v-launcher-colourway';
const COLOURWAY_EVENT = 't2v-launcher-colourway-changed';

const isColourway = (value: unknown): value is LauncherColourway =>
  typeof value === 'string' && (LAUNCHER_COLOURWAYS as readonly string[]).includes(value);

/** The visitor's own choice, or null: they have not made one, or cannot. */
function readColourway(): LauncherColourway | null {
  try {
    const stored = localStorage.getItem(COLOURWAY_KEY);
    return isColourway(stored) ? stored : null;
  } catch {
    // A private window, or storage the host page has blocked.
    return null;
  }
}

function subscribeColourway(onChange: () => void): () => void {
  window.addEventListener(COLOURWAY_EVENT, onChange);
  window.addEventListener('storage', onChange); // another tab
  return () => {
    window.removeEventListener(COLOURWAY_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Remember the visitor's choice and repaint every launcher on the page. */
export function setLauncherColourway(colourway: LauncherColourway): void {
  try {
    localStorage.setItem(COLOURWAY_KEY, colourway);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  window.dispatchEvent(new Event(COLOURWAY_EVENT));
}

/**
 * The colourway to paint: the visitor's, when the integrator allows one, else
 * the integrator's. A remembered choice is ignored — not deleted — when the
 * integrator takes the option away, so turning it back on restores it.
 */
export function useLauncherColourway(
  fallback: LauncherColourway,
  visitorChoice: boolean,
): LauncherColourway {
  const stored = useSyncExternalStore(subscribeColourway, readColourway, () => null);
  return (visitorChoice && stored) || fallback;
}

/* The label beside the mark is an introduction, not furniture: once the visitor
   has opened the chat they know what the mark is, and the launcher shrinks back
   to the tile. */
const OPENED_KEY = 't2v-launcher-opened';
const OPENED_EVENT = 't2v-launcher-opened-changed';

function readOpened(): boolean {
  try {
    return localStorage.getItem(OPENED_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeOpened(onChange: () => void): () => void {
  window.addEventListener(OPENED_EVENT, onChange);
  return () => window.removeEventListener(OPENED_EVENT, onChange);
}

export function markLauncherOpened(): void {
  try {
    localStorage.setItem(OPENED_KEY, '1');
  } catch {
    // Without storage the label comes back on the next page.
  }
  window.dispatchEvent(new Event(OPENED_EVENT));
}

/**
 * True once this visitor has opened the chat. Renders as true on a server, so a
 * returning visitor never sees the label flash in and back out on hydration.
 */
export function useLauncherOpened(): boolean {
  return useSyncExternalStore(subscribeOpened, readOpened, () => true);
}

/**
 * What the launcher tells the rest of the chat about itself. Settings reads it
 * to decide whether to offer the colour picker — and it lives here, not in
 * `launcher.tsx`, so `views/settings.tsx` can import it without a cycle.
 */
export interface LauncherOptions {
  /** The integrator's colourway: where the picker starts, and the fallback. */
  colourway: LauncherColourway;
  /** Whether the end-user may change it. */
  visitorColourway: boolean;
}

const NO_LAUNCHER: LauncherOptions = {
  colourway: DEFAULT_LAUNCHER_COLOURWAY,
  visitorColourway: false,
};

export const LauncherOptionsContext = createContext<LauncherOptions>(NO_LAUNCHER);

/** The launcher around this chat. The defaults mean "there isn't one". */
export const useLauncherOptions = (): LauncherOptions => useContext(LauncherOptionsContext);
