/**
 * Tailwind CSS preset for Talk2View SDK consumers.
 *
 * Extends the Tailwind theme with Talk2View brand colors and fonts.
 *
 * @example
 * ```js
 * // tailwind.config.js
 * import { t2vPreset } from '@talk2view/sdk/assistant-ui';
 *
 * export default {
 *   presets: [t2vPreset],
 *   content: [
 *     './src/**\/*.{ts,tsx}',
 *     './node_modules/@talk2view/sdk/dist/assistant-ui/**\/*.js',
 *     './node_modules/@assistant-ui/react-ui/dist/**\/*.js',
 *   ],
 * };
 * ```
 */

export const t2vPreset = {
  theme: {
    extend: {
      colors: {
        t2v: {
          dark: '#01161E',
          light: '#F8FAFC',
          turquoise: '#40D4B6',
          accent: '#40D4B6',
          teal: '#037171',
          gray: '#9F9AA4',
          border: '#E5E7EB',
          error: '#DC2626',
        },
      },
      fontFamily: {
        t2v: ['IBM Plex Sans', 'sans-serif'],
        't2v-mono': ['IBM Plex Mono', 'monospace'],
      },
    },
  },
} as const;
