import { defineConfig, devices } from '@playwright/test';

/**
 * The hostile-host suite: five partner pages built by
 * `tests/e2e/chat-hosts/hosts.mjs`, served as plain static files. No Vite, no
 * Tailwind, no PostCSS anywhere in the host — that is the claim under test.
 *
 * The server builds before it listens, so `dist/chat.css` and `dist/chat/` have
 * to exist: run `npm run build` first (the `test:e2e:chat-hosts` script does).
 */
export default defineConfig({
  testDir: './tests/e2e/chat-hosts',
  testMatch: 'chat-hosts.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/e2e/chat-hosts/hosts.mjs serve 5176',
    url: 'http://localhost:5176/clean--none.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
