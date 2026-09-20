import { generateThemeCSS, THEME_DEFAULTS, injectTheme } from '../../src/ui/theme';

describe('theme', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  describe('THEME_DEFAULTS', () => {
    it('has all required tokens', () => {
      expect(THEME_DEFAULTS.accent).toBe('#40D4B6');
      expect(THEME_DEFAULTS.bg).toBe('#F8FAFC');
      expect(THEME_DEFAULTS.foreground).toBe('#01161E');
      expect(THEME_DEFAULTS.font).toBe("'IBM Plex Sans', sans-serif");
    });
  });

  describe('generateThemeCSS', () => {
    it('generates CSS with defaults when no overrides', () => {
      const css = generateThemeCSS({});
      expect(css).toContain('--t2v-accent: #40D4B6');
      expect(css).toContain('--t2v-bg: #F8FAFC');
      expect(css).toContain('[data-talk2view]');
    });

    it('applies overrides', () => {
      const css = generateThemeCSS({ accent: '#FF0000', radius: 8 });
      expect(css).toContain('--t2v-accent: #FF0000');
      expect(css).toContain('--t2v-radius: 8px');
    });
  });

  describe('injectTheme', () => {
    it('injects a style tag into document head', () => {
      injectTheme({});
      const style = document.getElementById('t2v-theme');
      expect(style).not.toBeNull();
      expect(style?.textContent).toContain('--t2v-accent');
    });

    it('updates existing style tag on re-inject', () => {
      injectTheme({ accent: '#111' });
      injectTheme({ accent: '#222' });
      const styles = document.querySelectorAll('#t2v-theme');
      expect(styles.length).toBe(1);
      expect(styles[0]?.textContent).toContain('#222');
    });
  });

  describe('injectFonts', () => {
    it('injects Google Fonts link', async () => {
      vi.resetModules();
      const { injectFonts } = await import('../../src/ui/theme');
      injectFonts();
      const link = document.getElementById('t2v-fonts');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toContain('IBM+Plex+Sans');
    });

    it('is idempotent', async () => {
      vi.resetModules();
      const { injectFonts } = await import('../../src/ui/theme');
      injectFonts();
      injectFonts();
      expect(document.querySelectorAll('#t2v-fonts').length).toBe(1);
    });
  });

  describe('radius scale', () => {
    it('emits a derived radius scale with valid px values (no length*length calc)', () => {
      const css = generateThemeCSS({ radius: 12 });
      expect(css).toContain('--t2v-radius: 12px');
      expect(css).toContain('--t2v-radius-sm: 6px');
      expect(css).toContain('--t2v-radius-md: 9px');
      expect(css).toContain('--t2v-radius-lg: 12px');
      expect(css).toContain('--t2v-radius-xl: 18px');
      expect(css).toContain('--t2v-radius-pill: 9999px');
      // No invalid `<length> * <length>` expressions anywhere.
      expect(css).not.toMatch(/\*\s*[\d.]+px/);
    });

    it('scales the radius tokens from the radius knob', () => {
      const css = generateThemeCSS({ radius: 8 });
      expect(css).toContain('--t2v-radius-sm: 4px');
      expect(css).toContain('--t2v-radius-md: 6px');
      expect(css).toContain('--t2v-radius-xl: 12px');
    });
  });

  describe('assistant-ui-aligned defaults', () => {
    it('defaults the user bubble to a light neutral gray with dark text', () => {
      expect(THEME_DEFAULTS.userBubble).toBe('#F4F4F5');
      expect(THEME_DEFAULTS.userForeground).toBe('#01161E');
    });

    it('defaults surface to a real (opaque) neutral surface', () => {
      expect(THEME_DEFAULTS.surface).toBe('#F4F4F5');
    });

    it('exposes a shadow token', () => {
      expect(THEME_DEFAULTS.shadow).toContain('rgba');
      expect(generateThemeCSS({})).toContain('--t2v-shadow:');
    });
  });
});
