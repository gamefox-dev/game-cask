import { test, expect, openGame, diagnostics, step, readPixels, findColor, WALL_BLUE } from './fixtures';

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
  void collector;
  expect(await openGame(page, 'auto')).toBe('ready');
  const d = await diagnostics(page);
  const hasAdapter = await page.evaluate(async () => !!(navigator.gpu && (await navigator.gpu.requestAdapter())));
  expect(d.backend).toBe(hasAdapter ? 'webgpu' : 'webgl2');
  if (!hasAdapter) expect(d.backendNotes.length).toBeGreaterThan(0);
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
