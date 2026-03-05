import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:10100',
  },
  webServer: {
    command: 'PORT=10100 tsx src/server.ts',
    port: 10100,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
