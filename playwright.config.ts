import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3010',
  },
  webServer: {
    command: 'PORT=3010 tsx src/server.ts',
    port: 3010,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
