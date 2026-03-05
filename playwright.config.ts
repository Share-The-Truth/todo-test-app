import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3005',
  },
  webServer: {
    command: 'PORT=3005 tsx src/server.ts',
    port: 3005,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
