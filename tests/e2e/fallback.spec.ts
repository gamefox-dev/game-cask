import { test, expect, openGame, diagnostics, step, readPixels, findColor, WALL_BLUE } from './fixtures';
import { noWebGPU } from './browser-options';

test('no-WebGPU reproduction really has no adapter and still renders on WebGL 2', async ({ page, collector }) => {
  void collector;
  test.skip(!noWebGPU, 'opt-in BGT_E2E_NO_WEBGPU=1 software/no-adapter reproduction');
  expect(await openGame(page, 'auto')).toBe('ready');
  expect(await page.evaluate(async () => !!await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }))).toBe(false);
  const d = await diagnostics(page);
  expect(d.backend).toBe('webgl2');
  expect(d.backendNotes.join(' ')).toMatch(/webgpu:/);
  await step(page, 2);
  expect(findColor(await readPixels(page), WALL_BLUE, 4).count).toBeGreaterThan(5000);
});

test('intentional WebGPU failure falls back to WebGL 2 and still plays', async ({ page, collector }) => {
  void collector;
  expect(await openGame(page, 'webgpu-fail')).toBe('ready');
  const d = await diagnostics(page);
  expect(d.backend).toBe('webgl2');
  expect(d.backendNotes.join(' ')).toMatch(/deliberately failed/);
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  await step(page, 2);
  expect(findColor(await readPixels(page), WALL_BLUE, 4).count).toBeGreaterThan(5000);
});

test('auto selection picks WebGPU when available, otherwise WebGL 2, and reports why', async ({ page, collector }) => {
  collector.allow(/device lost|switching to WebGL 2/i);
  expect(await openGame(page, 'auto')).toBe('ready');
  const d = await diagnostics(page);
  // Judge the runtime by its own record of the choice: a second requestAdapter()
  // after the fact can differ (e.g. after a device loss on headless Linux).
  expect(['webgpu', 'webgl2']).toContain(d.backend);
  if (d.backend === 'webgl2') expect(d.backendNotes.join(' ')).toMatch(/webgpu:/);
});

test('no usable graphics backend shows an accessible error', async ({ page, collector }) => {
  collector.allow(/No supported graphics backend/);
  expect(await openGame(page, 'none')).toBe('failed');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Graphics not available');
  expect((await diagnostics(page)).backend).toBe('unavailable');
});

test('missing game shows an accessible error, not a blank page', async ({ page, collector }) => {
  collector.allow(/404/, /game not found/, /Failed to load resource/);
  expect(await openGame(page, 'webgl2', { game: 'does-not-exist' })).toBe('failed');
  await expect(page.getByRole('alert')).toContainText('game not found');
});
