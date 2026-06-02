describe('injectComponentStyles', () => {
  beforeEach(() => { document.head.innerHTML = ''; vi.resetModules(); });

  it('injects a focus ring for the composer and a reduced-motion guard', async () => {
    const { injectComponentStyles } = await import('../../src/ui/styles');
    injectComponentStyles();
    const el = document.getElementById('t2v-component-styles');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('.t2v-composer:focus-within');
    expect(el?.textContent).toContain('prefers-reduced-motion');
  });

  it('is idempotent', async () => {
    const { injectComponentStyles } = await import('../../src/ui/styles');
    injectComponentStyles();
    injectComponentStyles();
    expect(document.querySelectorAll('#t2v-component-styles').length).toBe(1);
  });
});
