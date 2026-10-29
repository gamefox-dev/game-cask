import { test, expect, openGame, assertBackend, diagnostics, step, readPixels, findColor, attachScreenshot, PLAYER_CYAN, WALL_BLUE } from './fixtures';

test('sample boots to its title screen with no errors', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  const backend = await assertBackend(page, backendParam, testInfo);
  expect(['webgpu', 'webgl2']).toContain(backend);

  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  await step(page, 2);
  const d = await diagnostics(page);
  expect(d.abi).toBe('0.1');
  expect(d.game?.id).toBe('sample2d');
  expect(d.logical).toEqual({ width: 320, height: 180 });
  expect(d.textures.count).toBe(1);
  expect(d.assets.count).toBe(2);
  expect(d.assets.missing).toEqual([]);
  expect(d.errors).toEqual([]);
  expect(d.commandErrors.count).toBe(0);
  expect(d.stateHashAvailable).toBe(true);
  expect(d.logs.map((l) => l.message)).toContain('coin cave ready');
  expect(d.wasmMemoryBytes).toBeGreaterThan(0);

  const px = await readPixels(page);
  expect(px.width).toBe(d.canvas.width);
  // title text is drawn in the player's cyan; walls come from the texture atlas
  expect(findColor(px, PLAYER_CYAN, 4).count).toBeGreaterThan(200);
  expect(findColor(px, WALL_BLUE, 4).count).toBeGreaterThan(5000);
  await attachScreenshot(page, testInfo, `title-${backend}.png`);
});
