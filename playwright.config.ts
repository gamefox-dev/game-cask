import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Projects:
//   chromium-webgl2  forced WebGL 2 fallback (software-friendly; the CI gate)
//   chromium-webgpu  WebGPU; tests requiring it skip unless available, or fail
//                    when BGT_REQUIRE_WEBGPU=1 (hardware gate, reported separately)
//   chromium-auto    default backend selection, as a user would get it
//   port-webgl2/-webgpu  port/tests/*.spec.ts when present (npm run test:port)
//   webkit / firefox opt-in with BGT_ALL_BROWSERS=1 (desktop engines only; this is
//                    NOT iPhone Safari verification)
const PORT = Number(process.env.BGT_E2E_PORT ?? 5179);
const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  // test:port sets BGT_RESULTS_PREFIX=e2e-port so kit and port runs don't overwrite each other.
  outputDir: `reports/${process.env.BGT_RESULTS_PREFIX ?? 'e2e'}-artifacts`,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: `reports/${process.env.BGT_RESULTS_PREFIX ?? 'e2e'}-results.json` }],
    ['html', { outputFolder: `reports/${process.env.BGT_RESULTS_PREFIX ?? 'e2e'}-html`, open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 960, height: 540 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
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
    ...(existsSync('port/tests')
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
