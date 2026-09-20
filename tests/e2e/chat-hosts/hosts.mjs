/**
 * The hostile-host harness: five partner pages, each one a plausible way for
 * someone else's CSS to meet ours, and each generated three ways — without the
 * chat at all (the control), with the full pane, and with the launcher.
 *
 *   node tests/e2e/chat-hosts/hosts.mjs build         write out/
 *   node tests/e2e/chat-hosts/hosts.mjs serve [port]  build, then serve out/
 *
 * The pages are plain HTML and one esbuild bundle of `mount.jsx` — no Vite, no
 * Tailwind, no PostCSS, because that is the claim being tested. The vendor
 * stylesheets are committed under `vendor/` so the suite never touches the
 * network.
 *
 * Stylesheet order on every page is deliberately the worst case for us: the
 * framework's sheet, then ours, then the host's own rules last, so the host
 * wins every specificity tie.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDK = path.resolve(HERE, '../../..');
const OUT = path.join(HERE, 'out');

// ── The host page's own content ────────────────────────────────────────────
// Everything here belongs to the partner. If the chat's stylesheet leaks, one
// of these changes, and the spec compares them against the same page without
// the chat.

const HOST_CHROME = `
<header class="site-header">
  <h1>Northfield Imaging</h1>
  <p class="lede">This paragraph, the button, the form and the list below belong to the
     <em>host page</em>. If the packaged chat leaks, they change.</p>
  <nav><a href="#one" class="host-link">Docs</a> · <a href="#two">Pricing</a></nav>
  <button type="button" class="btn btn-primary host-btn">Host button</button>
  <ul class="host-list"><li>First host item</li><li>Second host item</li></ul>
  <form class="host-form" action="#">
    <label for="host-input">Study</label>
    <input id="host-input" class="form-control host-input" type="text" value="2026-0918-114">
    <textarea id="host-textarea" class="host-textarea" rows="2">Impression</textarea>
    <button type="submit" class="host-submit">Save</button>
  </form>
  <svg width="48" height="48" viewBox="0 0 48 48" class="host-svg" aria-hidden="true">
    <circle cx="24" cy="24" r="20" fill="#4A73F0"></circle>
  </svg>
  <hr>
</header>`;

/**
 * The frame the full pane is mounted in; the launcher needs no frame.
 * `#t2v-mount` takes the frame's height because `.t2v-chat` is `height: 100%`
 * and an auto-height parent would collapse it.
 */
const FRAME_CSS = `
  .host-page { font-family: Georgia, serif; padding: 24px; color: #123456; }
  #chat-frame { width: 460px; height: 620px; border: 1px solid #888; }
  #chat-frame > #t2v-mount { height: 100%; }
`;

// ── The six hosts ──────────────────────────────────────────────────────────

const HOSTS = {
  // 1. Nothing of their own: the rendering everything else is compared against.
  clean: { vendor: null, css: '' },

  // 2. Tailwind v3's preflight and a few utilities, plus shadcn-shaped token
  //    names that mean DIFFERENT things — this is what the Talk2View website
  //    itself does: `--muted` is a text colour there, `--accent` is Teal.
  tailwind3: {
    vendor: 'tailwind-3.4.19.css',
    css: `
      :root {
        --background: #1b1b1f;
        --foreground: #f5f5f5;
        --muted: #67777C;
        --accent: #26C8B8;
        --radius: 1.5rem;
        --border: #ff00ff;
        --popover: #330033;
        --primary: #ff6600;
        --card: #220022;
      }
      body { background: var(--background); color: var(--foreground); }
      .host-page a { color: var(--accent); }
    `,
  },

  // 3. Bootstrap 5, whose Reboot layer restyles button, input, textarea and a.
  bootstrap: { vendor: 'bootstrap-5.3.8.min.css', css: '' },

  // 3b. A host whose typography is set on `body` and INHERITED — the half of
  //     isolation that specificity cannot reach, because an inherited property
  //     never matches a selector for armour to outrank. The stock Vite React
  //     template really does ship `text-align: center` on body, so this is the
  //     ordinary case, not a contrived one.
  inherited: {
    vendor: null,
    css: `
      body {
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        word-spacing: 4px;
        line-height: 3;
        text-indent: 12px;
      }
    `,
  },

  // 4. A house style written entirely in element selectors, no !important.
  //    Armour beats all of this.
  aggressive: {
    vendor: null,
    css: `
      * { box-sizing: content-box; }
      button { all: unset; }
      svg { width: 16px; height: 16px; }
      a { color: red; }
      textarea, input { font: 11px monospace; border: 3px dashed lime; }
      p, div { line-height: 3; }
      [class] { letter-spacing: 0.08em; }
      form { display: grid; gap: 4px; border: 2px solid purple; }
    `,
  },

  // 5. The same, shouted. Armour marks OUR utilities !important too, so the
  //    winner is decided on specificity — and the launcher's own rules, which
  //    are hand-written and unlayered, are NOT armoured at all. The spec knows
  //    exactly which properties this host is expected to take, and fails if the
  //    list changes in either direction.
  bang: {
    vendor: null,
    css: `
      * { box-sizing: content-box !important; }
      button { all: unset !important; }
      svg { width: 16px !important; height: 16px !important; }
      textarea, input { border: 3px dashed lime !important; }
      .flex { display: block !important; }
      .rounded-lg { border-radius: 40px !important; }

      /* A house habit aimed at the host's own layout, which happens to catch
         the launcher: it is the one part of the chat that lives in the
         partner's page rather than inside the portal host, and its fixed
         corner is a hand-written rule that armour never reaches. */
      .host-page div { position: static !important; }
    `,
  },
};

/**
 * `full-dark` is the full pane with `className="dark"` — the only form the docs
 * give for dark mode, and the one no screenshot ever caught: a token re-declared
 * on an element inside the chat silently restored the LIGHT palette there, while
 * the launcher (whose panel sits one element deeper) rendered correctly. Only a
 * browser can see it; jsdom does not cascade.
 */
const MODES = {
  none: null,
  full: 'full',
  'full-dark': 'full-dark',
  launcher: 'launcher',
};

// ── Page template ──────────────────────────────────────────────────────────

function page(name, host, mode) {
  const vendor = host.vendor ? `<link rel="stylesheet" href="./${host.vendor}">` : '';
  // Ours BEFORE the host's own <style>: the host wins every tie it can.
  const chatCss = mode ? '<link rel="stylesheet" href="./chat.css">' : '';
  const mount = mode
    ? mode === 'launcher'
      ? `<div id="t2v-mount" data-mode="launcher"></div><script src="./demo.js"></script>`
      : `<div id="chat-frame"><div id="t2v-mount" data-mode="${mode}"></div></div><script src="./demo.js"></script>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>host: ${name} / ${mode ?? 'none'}</title>
${vendor}
${chatCss}
<style>${FRAME_CSS}${host.css}</style>
</head>
<body class="host-page">
${HOST_CHROME}
${mount}
</body></html>`;
}

// ── Build ──────────────────────────────────────────────────────────────────

async function buildAll() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const chatCss = path.join(SDK, 'dist/chat.css');
  if (!fs.existsSync(chatCss)) {
    throw new Error(`${chatCss} is missing — run \`npm run build\` first.`);
  }
  fs.copyFileSync(chatCss, path.join(OUT, 'chat.css'));

  for (const file of fs.readdirSync(path.join(HERE, 'vendor'))) {
    fs.copyFileSync(path.join(HERE, 'vendor', file), path.join(OUT, file));
  }

  await build({
    entryPoints: [path.join(HERE, 'mount.jsx')],
    outfile: path.join(OUT, 'demo.js'),
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    // A plain <script> tag: React has to be in the bundle.
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@talk2view/sdk': path.join(SDK, 'dist/index.js'),
      '@talk2view/sdk/chat': path.join(SDK, 'dist/chat/index.js'),
      '@talk2view/sdk/chat-css': path.join(SDK, 'dist/chat-css.js'),
    },
    absWorkingDir: SDK,
    logLevel: 'warning',
  });

  let n = 0;
  for (const [name, host] of Object.entries(HOSTS)) {
    for (const [label, mode] of Object.entries(MODES)) {
      fs.writeFileSync(path.join(OUT, `${name}--${label}.html`), page(name, host, mode));
      n++;
    }
  }
  return n;
}

// ── Serve ──────────────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serve(port) {
  createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname) || 'index.html';
    const file = path.join(OUT, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`chat-hosts on http://localhost:${port}/clean--none.html`));
}

// ── CLI ────────────────────────────────────────────────────────────────────

const [command = 'build', portArg] = process.argv.slice(2);
const count = await buildAll();
if (command === 'serve') {
  serve(Number(portArg ?? 5176));
} else {
  console.log(`wrote ${count} host pages to ${path.relative(SDK, OUT)}`);
}

export { HOSTS, MODES };
