import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3005',
  },
  projects: [
    {
      name: 'chromium',
      use: {},
    },
  ],
  webServer: {
    command: 'tsx src/server.ts',
    port: 3005,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    env: {
      PORT: '3005',
    },
  },
});
