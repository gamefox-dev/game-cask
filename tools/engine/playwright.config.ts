import { defineConfig } from '@playwright/test';
import { webgl2Gpu, webglArgs, webglGpuArgs } from '../../tests/e2e/browser-options';
// K59: BGT_WEBGL2_GPU=1 (the K51 switch) runs the engine specs on the native GPU (ANGLE Metal on macOS) instead of
// headless SwiftShader; the default stays the software CI gate.
export default defineConfig({
  testDir: '../../tests/engine', workers: 1, fullyParallel: false, timeout: 120000,
  outputDir: '../../reports/engine-artifacts', reporter: [['list'], ['json', { outputFile: '../../reports/engine-results.json' }]],
  use: { viewport: { width: 640, height: 360 }, launchOptions: { args: webgl2Gpu ? webglGpuArgs : webglArgs } },
});
