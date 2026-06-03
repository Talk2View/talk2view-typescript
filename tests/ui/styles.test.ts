describe('injectComponentStyles', () => {
  beforeEach(() => { document.head.innerHTML = ''; vi.resetModules(); });

  it('injects a focus ring for the composer and never globally freezes animations', async () => {
    const { injectComponentStyles } = await import('../../src/ui/styles');
    injectComponentStyles();
    const el = document.getElementById('t2v-component-styles');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('.t2v-composer:focus-within');
    // Loading indicators (spinner/shimmer/typing) must keep animating — guard
    // against re-introducing a blanket rule that freezes them under reduced motion.
    expect(el?.textContent).not.toContain('animation-duration: 0.001ms');
  });

  it('is idempotent', async () => {
    const { injectComponentStyles } = await import('../../src/ui/styles');
    injectComponentStyles();
    injectComponentStyles();
    expect(document.querySelectorAll('#t2v-component-styles').length).toBe(1);
  });
});
