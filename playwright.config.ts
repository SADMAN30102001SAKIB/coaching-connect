import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...(!process.env['CI'] ? { channel: 'chrome' } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm db:test && pnpm exec wrangler dev --config dist/coaching_connect/wrangler.json --port 4173 --persist-to .wrangler/browser-state --var SMS_MODE:mock --var DISPATCH_ENABLED:true --var BOOTSTRAP_TOKEN:local-browser-test-setup-key-not-for-production-2026',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    {
      name: 'mobile-dark',
      use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', colorScheme: 'dark' },
    },
  ],
});
