/**
 * What gets bundled into the host pages' `demo.js` — the partner's own code,
 * as small as it can be: import, mount, nothing else.
 *
 * `hosts.mjs` bundles this with esbuild against `dist/`, with React bundled in
 * (a host page has no module resolver), and the mode read from the mount
 * element so one bundle serves every page.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Talk2View } from '@talk2view/sdk';
import { Talk2ViewChat, Talk2ViewChatLauncher } from '@talk2view/sdk/chat';

const el = document.getElementById('t2v-mount');
const mode = el.getAttribute('data-mode');

// A client the spec can drive from the page, and a base URL the Playwright
// route handlers intercept.
const client = new Talk2View({ partnerKey: 'pk_test_hosts', baseUrl: '/api' });
window.__t2v = client;

const props = {
  client,
  welcome: {
    heading: 'How can I help you today?',
    suggestions: ['What can you do?'],
  },
};

createRoot(el).render(
  mode === 'launcher' ? (
    <Talk2ViewChatLauncher {...props} visitorColourway />
  ) : (
    // `className="dark"` on the chat's own element: the only form docs/chat.md
    // gives, and the one the dark-mode assertions in the spec read back.
    <Talk2ViewChat {...props} className={mode === 'full-dark' ? 'dark' : undefined} />
  ),
);
