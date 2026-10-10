import { defineConfig } from '@playwright/test';

const production = process.env.PW_PREVIEW === '1';
const port = production ? 4176 : 5176;
// Dedicated live origins prevent fixture-mode data and service workers from mixing.
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/live',
  testIgnore: production ? undefined : '**/offline.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-live-report', open: 'never' }]],
  outputDir: 'test-results-live',
  use: {
    baseURL,
    viewport: { width: 393, height: 852 },
    locale: 'en-GB',
    timezoneId: 'Asia/Singapore',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'live-chromium', use: { browserName: 'chromium', isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'live-webkit', use: { browserName: 'webkit', isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }
  ],
  webServer: {
    command: production
      ? `npm run build && npm run preview -- --port ${port} --strictPort`
      : `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !production,
    timeout: production ? 120_000 : 30_000,
    env: {
      PUBLIC_API_MODE: 'live',
      BACKEND_API_URL: process.env.BACKEND_API_URL ?? 'http://127.0.0.1:8082'
    }
  }
});
