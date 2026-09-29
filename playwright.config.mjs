import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8792', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `"${process.env.BNR_TEST_PYTHON || 'python'}" tools/fixture_server.py`,
    url: 'http://127.0.0.1:8792/ping',
    reuseExistingServer: false
  }
});
