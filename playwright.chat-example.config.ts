import { defineConfig, devices } from '@playwright/test';

/**
 * The `examples/react-chat` smoke. The example installs the SDK by `file:`, so
 * its Vite server serves whatever is in `dist/` — run `npm run build` first
 * (the `test:e2e:chat-example` script does).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'chat-example.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'cd examples/react-chat && npx vite --port 5175 --strictPort',
    url: 'http://localhost:5175/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
