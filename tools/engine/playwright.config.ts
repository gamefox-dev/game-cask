import { defineConfig } from '@playwright/test';
import { webglArgs } from '../../tests/e2e/browser-options';
export default defineConfig({
  testDir: '../../tests/engine', workers: 1, fullyParallel: false, timeout: 120000,
  outputDir: '../../reports/engine-artifacts', reporter: [['list'], ['json', { outputFile: 'reports/engine-results.json' }]],
  use: { viewport: { width: 640, height: 360 }, launchOptions: { args: webglArgs } },
});
