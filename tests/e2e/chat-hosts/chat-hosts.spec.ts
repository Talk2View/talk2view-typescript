/**
 * The packaged chat, mounted in five hostile partner pages.
 *
 * Two promises are made to anyone who installs `@talk2view/sdk/chat`:
 *
 *   OUTWARD  nothing of ours reaches the host's own page.
 *   INWARD   the host's own CSS does not reach into the chat.
 *
 * Both are kept by the build, not by the components: `scripts/chat/isolate.mjs`
 * scopes every rule under `.t2v-chat` and marks the utility and component
 * layers `!important` ("armour"). Nothing in `tsc`, `vitest` or the audit can
 * tell whether that actually worked — the failure mode is a rule that quietly
 * does nothing, and the only witness is a browser.
 *
 * The one thing armour does NOT cover is the hand-written rules in the
 * unlayered origin: the launcher's fixed anchor, the phone sheet and the three
 * colourways. A host's `!important` beats those on specificity or on source
 * order, and the tests at the bottom of this file say exactly which of them
 * hold and which do not. That trap — armour versus an unarmoured or inline
 * declaration — has bitten three tasks in three disguises, so this suite is the
 * fence.
 *
 * `hosts.mjs` generates the pages; run it by hand to look at one:
 *   node tests/e2e/chat-hosts/hosts.mjs serve 5176
 */
import { expect, test, type Page } from '@playwright/test';
import { mockAllApiRoutes } from '../fixtures/api-mocks';

const HOSTS = ['clean', 'tailwind3', 'bootstrap', 'inherited', 'aggressive', 'bang'] as const;
type Host = (typeof HOSTS)[number];

/** What the chat should look like on a host that has no opinions of its own. */
const EXPECTED_CHAT = {
  rootBoxSizing: 'border-box',
  rootFillsMount: true,
  headerHeight: '44px',
  threadDisplay: 'flex',
  composerBorderColor: 'oklab(0.211152 -0.026515 -0.0255326 / 0.25)',
  composerBorderWidth: '1px',
  composerRadius: '0px',
  composerDisplay: 'flex',
  sendBackground: 'rgb(38, 200, 184)',
  sendRadius: '3.35544e+07px',
  sendWidth: '28px',
  sendHeight: '28px',
  // The voice button reads `--primary` / `--primary-foreground` rather than
  // brand hexes, so a partner who rethemes the chat gets a voice button that
  // follows. Teal on Smoke is simply what those tokens are by default.
  dictateBackground: 'rgb(38, 200, 184)',
  dictateColor: 'rgb(2, 28, 37)',
  portalHostHeight: '0px',
  // Inherited typography stops at the chat's own element. Nothing else in this
  // file can catch a host that sets these on `body`: an inherited property
  // matches no selector, so armour and specificity never come into it.
  rootTextAlign: 'start',
  rootTextTransform: 'none',
  rootLetterSpacing: 'normal',
  rootWordSpacing: '0px',
  rootTextIndent: '0px',
};

/** And the launcher, which lives in the host's own page rather than the portal. */
const EXPECTED_LAUNCHER = {
  anchorPosition: 'fixed',
  anchorZIndex: '999998',
  anchorHeight: '64px',
  anchorBottom: '16px',
  anchorRight: '16px',
  buttonBackground: 'rgb(38, 200, 184)',
  buttonColor: 'rgb(2, 28, 37)',
  beamAnimation: 't2v-beam',
};

/**
 * Properties a given host is KNOWN to take, with the reason. The tests compare
 * the whole record, so these lists are exhaustive in both directions: a new
 * break fails, and a break that gets fixed fails too and has to be removed from
 * here.
 */
const KNOWN_CHAT_BREAKS: Partial<Record<Host, Partial<typeof EXPECTED_CHAT>>> = {
  aggressive: {
    // `[class] { letter-spacing: 0.08em }` — a SELECTOR, not inheritance, and
    // it matches the chat's own root, which carries a class. It ties with our
    // `.t2v-chat` declaration on specificity, and our stylesheet is linked
    // first on purpose so the host wins every tie. The `inherited` host is the
    // case this one cannot cover: there the same property arrives with no
    // selector at all, and the chat's own declaration is the only thing
    // standing between it and the text.
    rootLetterSpacing: '1.28px',
  },
  bang: {
    // `* { box-sizing: content-box !important }`. Tailwind's preflight sets
    // box-sizing on `*`, which isolates to `.t2v-chat *` — a descendant
    // selector that cannot match the `.t2v-chat` element itself. So the chat's
    // own root box is the one element in the chat with no declaration of ours
    // behind it, and the host's shout lands. Nothing inside the chat moves.
    rootBoxSizing: 'content-box',
  },
};

const KNOWN_LAUNCHER_BREAKS: Partial<Record<Host, Partial<typeof EXPECTED_LAUNCHER>>> = {
  bang: {
    // `.host-page div { position: static !important }`. The launcher's fixed
    // corner is `:root.aui-modal-anchor { position: fixed }` — hand-written,
    // unlayered, and NOT armoured, because it is a chat root and a Tailwind
    // utility on it would compile to `.t2v-chat .fixed` and match nothing.
    // A normal author declaration always loses to an important one, whatever
    // the specificity. The launcher then lands in the flow of the host's page
    // instead of the corner, which is the worst of these to hit and the reason
    // the docs tell integrators to keep the launcher out of a styled container.
    anchorPosition: 'static',
  },
};

// ── Probes ──────────────────────────────────────────────────────────────────
// Everything is read back with getComputedStyle: what the browser resolved,
// not what a screenshot suggests.

const hostProbe = () => {
  const g = (sel: string, p: string) => {
    const el = document.querySelector(sel);
    return el ? (getComputedStyle(el) as unknown as Record<string, string>)[p] ?? null : null;
  };
  return {
    bodyFont: g('body', 'fontFamily'),
    bodyColor: g('body', 'color'),
    bodyMargin: g('body', 'marginTop'),
    bodyBackground: g('body', 'backgroundColor'),
    h1Size: g('.site-header h1', 'fontSize'),
    h1Weight: g('.site-header h1', 'fontWeight'),
    ledeLineHeight: g('.lede', 'lineHeight'),
    linkColor: g('.host-link', 'color'),
    linkDecoration: g('.host-link', 'textDecorationLine'),
    buttonBackground: g('.host-btn', 'backgroundColor'),
    buttonPadding: g('.host-btn', 'paddingTop'),
    buttonRadius: g('.host-btn', 'borderTopLeftRadius'),
    buttonFont: g('.host-btn', 'fontFamily'),
    inputBorder: g('.host-input', 'borderTopWidth'),
    inputFont: g('.host-input', 'fontFamily'),
    textareaBorder: g('.host-textarea', 'borderTopWidth'),
    formDisplay: g('.host-form', 'display'),
    formBorder: g('.host-form', 'borderTopWidth'),
    listStyle: g('.host-list li', 'listStyleType'),
    svgWidth: g('.host-svg', 'width'),
    headerBoxSizing: g('.site-header', 'boxSizing'),
    hrHeight: g('.site-header hr', 'height'),
    // An inline style attribute is the one thing no stylesheet can explain:
    // if either of these grows, something ran JavaScript against the host DOM.
    htmlInlineStyle: document.documentElement.getAttribute('style') ?? '',
    bodyInlineStyle: document.body.getAttribute('style') ?? '',
  };
};

const chatProbe = () => {
  const g = (sel: string, p: string) => {
    const el = document.querySelector(sel);
    return el ? (getComputedStyle(el) as unknown as Record<string, string>)[p] ?? null : null;
  };
  const root = document.querySelector('#t2v-mount > .t2v-chat');
  const mount = document.getElementById('t2v-mount');
  return {
    rootBoxSizing: g('#t2v-mount > .t2v-chat', 'boxSizing'),
    // An absolute height would only measure the host's frame; what matters is
    // that the chat fills whatever box it is given.
    rootFillsMount:
      !!root &&
      !!mount &&
      Math.abs(root.getBoundingClientRect().height - mount.getBoundingClientRect().height) < 1,
    headerHeight: g('.t2v-chat-header', 'height'),
    threadDisplay: g('.aui-thread-root', 'display'),
    composerBorderColor: g('[data-slot="aui_composer-shell"]', 'borderTopColor'),
    composerBorderWidth: g('[data-slot="aui_composer-shell"]', 'borderTopWidth'),
    composerRadius: g('[data-slot="aui_composer-shell"]', 'borderTopLeftRadius'),
    composerDisplay: g('[data-slot="aui_composer-shell"]', 'display'),
    sendBackground: g('.aui-composer-send', 'backgroundColor'),
    sendRadius: g('.aui-composer-send', 'borderTopLeftRadius'),
    sendWidth: g('.aui-composer-send', 'width'),
    sendHeight: g('.aui-composer-send', 'height'),
    rootTextAlign: g('#t2v-mount > .t2v-chat', 'textAlign'),
    rootTextTransform: g('#t2v-mount > .t2v-chat', 'textTransform'),
    rootLetterSpacing: g('#t2v-mount > .t2v-chat', 'letterSpacing'),
    rootWordSpacing: g('#t2v-mount > .t2v-chat', 'wordSpacing'),
    rootTextIndent: g('#t2v-mount > .t2v-chat', 'textIndent'),
    dictateBackground: g('.aui-composer-dictate', 'backgroundColor'),
    dictateColor: g('.aui-composer-dictate', 'color'),
    portalHostHeight: g('.t2v-chat.t2v-portal-host', 'height'),
  };
};

/**
 * Dark mode, read as COMPUTED values rather than as classes on elements.
 *
 * Every other dark-mode assertion in this repo checks that `dark` reached the
 * right element. That is not the same question: the chat declares its tokens on
 * its own element (`.t2v-chat.dark`) and every surface inside inherits them, so
 * one token re-declared on an inner element pins that whole subtree to the light
 * palette while the class plumbing still looks perfect. It shipped exactly once,
 * as `.aui-root { --muted: … }`, and the launcher hid it: the launcher's panel
 * sits inside the portal host, which supplies the extra ancestor the dark twin's
 * selector needed. That is why the readings below are taken on the SHELL, one
 * element inside the root, and not only on the root.
 */
const darkProbe = () => {
  const token = (sel: string, name: string) => {
    const el = document.querySelector(sel);
    // Lower-cased: these are colours, and lightningcss decides the hex casing.
    return el ? getComputedStyle(el).getPropertyValue(name).trim().toLowerCase() : null;
  };
  const g = (sel: string, p: string) => {
    const el = document.querySelector(sel);
    return el ? (getComputedStyle(el) as unknown as Record<string, string>)[p] ?? null : null;
  };
  return {
    // The root's own compound wins here, and did even while the bug was live.
    rootMuted: token('#t2v-mount > .t2v-chat', '--muted'),
    // …and the shell has to inherit it rather than re-declare a light value.
    shellMuted: token('.t2v-chat-shell', '--muted'),
    shellAccent: token('.t2v-chat-shell', '--accent'),
    shellAccentForeground: token('.t2v-chat-shell', '--accent-foreground'),
    shellForeground: token('.t2v-chat-shell', '--foreground'),
    // What the end-user actually sees: the shell's own ground and text.
    shellBackground: g('.t2v-chat-shell', 'backgroundColor'),
    shellColor: g('.t2v-chat-shell', 'color'),
    // Teal in both palettes, because `--primary` is.
    dictateBackground: g('.aui-composer-dictate', 'backgroundColor'),
  };
};

/**
 * A real `bg-muted` + `text-foreground` surface: the header button of whichever
 * view is open, which carries `aria-pressed:bg-muted aria-pressed:text-foreground`.
 * With the bug live this resolved to Mist under Ivory — about 1.1:1, invisible.
 */
const pressedProbe = () => {
  const el = document.querySelector('.t2v-chat-header button[aria-pressed="true"]');
  if (!el) return null;
  const s = getComputedStyle(el);
  return { background: s.backgroundColor, color: s.color };
};

const launcherProbe = () => {
  const g = (sel: string, p: string) => {
    const el = document.querySelector(sel);
    return el ? (getComputedStyle(el) as unknown as Record<string, string>)[p] ?? null : null;
  };
  const button = document.querySelector('.aui-modal-button');
  return {
    anchorPosition: g('.aui-modal-anchor', 'position'),
    anchorZIndex: g('.aui-modal-anchor', 'zIndex'),
    anchorHeight: g('.aui-modal-anchor', 'height'),
    anchorBottom: g('.aui-modal-anchor', 'bottom'),
    anchorRight: g('.aui-modal-anchor', 'right'),
    buttonBackground: g('.aui-modal-button', 'backgroundColor'),
    buttonColor: g('.aui-modal-button', 'color'),
    beamAnimation: button ? getComputedStyle(button, '::before').animationName : null,
  };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function open(page: Page, host: Host, mode: 'none' | 'full' | 'full-dark' | 'launcher') {
  await mockAllApiRoutes(page);
  await page.goto(`/${host}--${mode}.html`, { waitUntil: 'load' });
  if (mode === 'full' || mode === 'full-dark') {
    await expect(page.locator('.aui-thread-root')).toBeVisible();
  }
  if (mode === 'launcher') await expect(page.locator('.aui-modal-button')).toBeVisible();
}

/** The expected reading for a host: the clean one, with its known breaks applied. */
function expectedFor<T extends Record<string, unknown>>(
  base: T,
  breaks: Partial<Record<Host, Partial<T>>>,
  host: Host,
): T {
  return { ...base, ...(breaks[host] ?? {}) };
}

// ── OUTWARD ─────────────────────────────────────────────────────────────────

test.describe('nothing of the chat reaches the host page', () => {
  for (const host of HOSTS) {
    for (const mode of ['full', 'launcher'] as const) {
      test(`${host}: the ${mode} chat leaves every host property alone`, async ({ page }) => {
        await open(page, host, 'none');
        const before = await page.evaluate(hostProbe);

        await open(page, host, mode);
        const after = await page.evaluate(hostProbe);

        // Byte-identical: the same page, with and without the chat's stylesheet
        // and bundle. The chat's sheet is linked BEFORE the host's own <style>,
        // so the host wins every tie it could want.
        expect(after).toEqual(before);
      });
    }
  }
});

// ── INWARD: the full pane ───────────────────────────────────────────────────

test.describe('the host page does not reach into the chat', () => {
  for (const host of HOSTS) {
    test(`${host}: the full pane renders as designed`, async ({ page }) => {
      await open(page, host, 'full');
      // Polled, not read once: the composer's border colour transitions over
      // 150 ms when the composer takes focus on mount, and a single read
      // catches it mid-flight.
      await expect
        .poll(() => page.evaluate(chatProbe))
        .toEqual(expectedFor(EXPECTED_CHAT, KNOWN_CHAT_BREAKS, host));
    });
  }

  for (const host of HOSTS) {
    test(`${host}: a tooltip is portaled into the chat's own host, and styled`, async ({ page }) => {
      await open(page, host, 'full');
      // Portals default to <body>, where the stylesheet does not reach. The
      // provider appends one `.t2v-chat.t2v-portal-host` element instead, and
      // every portal in the chat is pointed at it.
      await page.locator('.t2v-chat-header button').first().hover();
      const tooltip = page.locator('[data-slot="tooltip-content"]');
      await expect(tooltip).toBeVisible();

      expect(
        await tooltip.evaluate((el) => ({
          inPortalHost: !!el.closest('.t2v-portal-host'),
          background: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
        })),
      ).toEqual({
        inPortalHost: true,
        background: 'rgb(2, 28, 37)',
        color: 'rgb(255, 255, 255)',
      });
    });
  }
});

// ── INWARD: dark mode, which only a browser can judge ───────────────────────

test.describe('the full pane in dark mode', () => {
  /** The dark palette, from chat.src.css `:root.dark`. */
  const ASH = '#354951'; //   --muted / --accent / --secondary
  const IVORY = '#f2f0ec'; // --foreground / --accent-foreground
  const EXPECTED_DARK = {
    rootMuted: ASH,
    shellMuted: ASH,
    shellAccent: ASH,
    shellAccentForeground: IVORY,
    shellForeground: IVORY,
    shellBackground: 'rgb(11, 39, 49)', //  --popover
    shellColor: 'rgb(242, 240, 236)', //    --popover-foreground
    dictateBackground: 'rgb(38, 200, 184)',
  };

  for (const host of HOSTS) {
    test(`${host}: every token inside the chat is the dark one`, async ({ page }) => {
      await open(page, host, 'full-dark');
      // The host pages declare shadcn-shaped tokens of their own on `:root`
      // (tailwind3 sets `--muted`, `--accent`, `--popover`, `--primary`), so
      // this is two assertions at once: the dark palette reaches the shell, and
      // the host's same-named tokens do not.
      await expect.poll(() => page.evaluate(darkProbe)).toEqual(EXPECTED_DARK);
    });
  }

  test('a muted surface is readable: the pressed header button', async ({ page }) => {
    await open(page, 'clean', 'full-dark');
    await page.getByRole('button', { name: 'Settings' }).click();
    // Off the button: the ghost variant's own `dark:hover:bg-muted/50` would
    // otherwise be what is read, and the flat pressed surface is the one a user
    // looks at for as long as the view is open.
    await page.mouse.move(900, 400);
    await expect
      .poll(() => page.evaluate(pressedProbe))
      // Ash under Ivory. The regression put Mist (#caebeb) under Ivory here,
      // which is a contrast ratio of about 1.1:1 — text on an invisible field.
      .toEqual({ background: 'rgb(53, 73, 81)', color: 'rgb(242, 240, 236)' });
  });

  test('the light pane is unchanged by any of this', async ({ page }) => {
    await open(page, 'clean', 'full');
    expect(await page.evaluate(darkProbe)).toEqual({
      rootMuted: '#caebeb', //  Mist
      shellMuted: '#caebeb',
      shellAccent: '#caebeb',
      shellAccentForeground: '#021c25', // Smoke
      shellForeground: '#021c25',
      shellBackground: 'rgb(255, 255, 255)',
      shellColor: 'rgb(2, 28, 37)',
      dictateBackground: 'rgb(38, 200, 184)',
    });
  });
});

// ── INWARD: the launcher, which is the unarmoured part ──────────────────────

test.describe('the launcher in the host page', () => {
  for (const host of HOSTS) {
    test(`${host}: the anchor, the colourway and the beam`, async ({ page }) => {
      await open(page, host, 'launcher');
      await expect
        .poll(() => page.evaluate(launcherProbe))
        .toEqual(expectedFor(EXPECTED_LAUNCHER, KNOWN_LAUNCHER_BREAKS, host));
    });
  }

  test('a host that shouts at every element cannot repaint the colourway', async ({ page }) => {
    await open(page, 'clean', 'launcher');
    // The colourways ARE `!important`, at `.aui-modal-button[data-…]` —
    // specificity (0,2,0). An element selector cannot reach that, however loudly
    // it shouts.
    await page.addStyleTag({
      content: 'button { background-color: #ff00ff !important; color: #00ff00 !important; }',
    });
    const button = page.locator('.aui-modal-button');
    await expect(button).toHaveCSS('background-color', 'rgb(38, 200, 184)');
    await expect(button).toHaveCSS('color', 'rgb(2, 28, 37)');
  });

  test('…but an id-scoped !important does, and that is the documented limit', async ({ page }) => {
    await open(page, 'clean', 'launcher');
    // `#t2v-mount button` is (1,0,1): an id beats any number of classes. A
    // partner whose app root carries an id and paints every button inside it
    // repaints the launcher too. There is no CSS answer to this — an
    // integrator who hits it scopes their own rule, or picks a colourway that
    // matches. Recorded here so it is a known limit rather than a surprise.
    await page.addStyleTag({
      content: '#t2v-mount button { background-color: #ff00ff !important; }',
    });
    await expect(page.locator('.aui-modal-button')).toHaveCSS('background-color', 'rgb(255, 0, 255)');
  });

  test('the phone sheet holds against a host that shouts at every div', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await open(page, 'bang', 'launcher');
    // The sheet's rules are hand-written like the anchor's, but unlike the
    // anchor they carry `!important` — they have to, because Base UI positions
    // the popup with inline styles. `.aui-modal-positioner[data-sheet]` is
    // (0,2,0), so `.host-page div { position: static !important }` loses. If
    // anyone takes that `!important` away, this goes red.
    await page.locator('.aui-modal-button').click();
    const content = page.locator('.aui-modal-content');
    await expect(content).toBeVisible();

    expect(
      await page.evaluate(() => {
        const g = (sel: string, p: string) => {
          const el = document.querySelector(sel);
          return el ? (getComputedStyle(el) as unknown as Record<string, string>)[p] ?? null : null;
        };
        return {
          sheetOn: !!document.querySelector('.aui-modal-content[data-sheet]'),
          positionerPosition: g('.aui-modal-positioner', 'position'),
          positionerTop: g('.aui-modal-positioner', 'insetBlockStart'),
          contentWidth: g('.aui-modal-content', 'width'),
          contentRadius: g('.aui-modal-content', 'borderTopLeftRadius'),
          // Raised above the sheet so it stays tappable.
          anchorZIndex: g('.aui-modal-anchor', 'zIndex'),
        };
      }),
    ).toEqual({
      sheetOn: true,
      positionerPosition: 'fixed',
      positionerTop: '0px',
      contentWidth: '390px',
      contentRadius: '0px',
      anchorZIndex: '1000000',
    });
  });
});

// ── The chat still works, not just looks right ──────────────────────────────

test.describe('the chat still runs on a hostile host', () => {
  for (const host of ['aggressive', 'bang'] as const) {
    test(`${host}: a message round trip`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await open(page, host, 'full');

      const input = page.getByPlaceholder('Send a message...');
      await input.fill('Does this still work?');
      await page.getByRole('button', { name: 'Send message' }).click();

      await expect(page.getByText('Hello! How can I help?')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});
