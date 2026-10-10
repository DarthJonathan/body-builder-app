import { defineConfig } from '@playwright/test';

const production = process.env.PW_PREVIEW === '1';
const port = production ? 4175 : 5175;
// On the macOS test host, WebKit loads localhost but stalls numeric loopback HTTP bodies.
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  testIgnore: production ? ['**/live/**'] : ['**/live/**', '**/pwa.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
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
    { name: 'mobile-chromium', use: { browserName: 'chromium', isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
    { name: 'mobile-webkit', use: { browserName: 'webkit', isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }
  ],
  webServer: {
    command: production
      ? `npm run build && npm run preview -- --port ${port} --strictPort`
      : `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !production,
    timeout: production ? 120_000 : 30_000,
    env: { PUBLIC_API_MODE: 'mock', BACKEND_API_URL: 'http://127.0.0.1:8081' }
  }
});
