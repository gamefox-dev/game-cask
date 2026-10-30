import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Projects:
//   chromium-webgl2  forced WebGL 2 fallback (software-friendly; the CI gate)
//   chromium-webgpu  WebGPU; tests requiring it skip unless available, or fail
//                    when BGT_REQUIRE_WEBGPU=1 (hardware gate, reported separately)
//   chromium-auto    default backend selection, as a user would get it
//   port-webgl2/-webgpu  port/tests/*.spec.ts, only with BGT_PORT_TESTS=1 (npm run test:port sets it),
//                    so `npm run test:e2e` never runs or reports port tests
//
// Result files: reports/<prefix>-results.json, <prefix>-artifacts/, <prefix>-html/. The npm scripts set
// the prefix (test:e2e -> e2e, test:port -> e2e-port). A direct `npx playwright test` without
// BGT_RESULTS_PREFIX writes e2e-adhoc-* so it never overwrites the kit's or the port's results.
//   webkit / firefox opt-in with BGT_ALL_BROWSERS=1 (desktop engines only; this is
//                    NOT iPhone Safari verification)
const PORT = Number(process.env.BGT_E2E_PORT ?? 5179);
const PREFIX = process.env.BGT_RESULTS_PREFIX ?? 'e2e-adhoc';
const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: `reports/${PREFIX}-artifacts`,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: `reports/${PREFIX}-results.json` }],
    ['html', { outputFolder: `reports/${PREFIX}-html`, open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 960, height: 540 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    // A kit-specific URL: an unrelated app on this port answers 404 here, so it is never mistaken for
    // the kit's server (Playwright then fails to bind the port instead of testing the wrong app).
    url: `http://127.0.0.1:${PORT}/games/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-webgl2',
      testDir: 'tests/e2e',
      use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 }, backendParam: 'webgl2' } as never,
    },
    {
      name: 'chromium-webgpu',
      testDir: 'tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 540 },
        channel: 'chromium',
        launchOptions: { args: webgpuArgs },
        backendParam: 'webgpu',
      } as never,
    },
    {
      name: 'chromium-auto',
      testDir: 'tests/e2e',
      testMatch: /(boot|fallback)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 }, channel: 'chromium', launchOptions: { args: webgpuArgs }, backendParam: 'auto' } as never,
    },
    // Private, game-specific tests written by the porter (port/ is git-ignored).
    ...(process.env.BGT_PORT_TESTS === '1' && existsSync('port/tests')
      ? [
          { name: 'port-webgl2', testDir: 'port/tests', use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 }, backendParam: 'webgl2' } as never },
          {
            name: 'port-webgpu',
            testDir: 'port/tests',
            use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 540 }, channel: 'chromium', launchOptions: { args: webgpuArgs }, backendParam: 'webgpu' } as never,
          },
        ]
      : []),
    ...(process.env.BGT_ALL_BROWSERS
      ? [
          { name: 'webkit-webgl2', use: { ...devices['Desktop Safari'], backendParam: 'webgl2' } as never },
          { name: 'firefox-webgl2', use: { ...devices['Desktop Firefox'], backendParam: 'webgl2' } as never },
        ]
      : []),
  ],
});
