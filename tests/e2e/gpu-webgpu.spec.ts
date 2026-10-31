import { test, expect, openGame, assertBackend, step, stateHash, diagnostics, readPixels } from './fixtures';

const scenes = [
  'indexed coloured triangle', 'mipmapped alpha quad', 'two colour attachments', 'depth and stencil',
  '1000 instanced sprites', 'uniform animation', 'GLSL blocks samplers varyings FragCoord discard',
  '2D GPU interleaving',
];
for (const [scene, name] of scenes.entries()) test(`WebGPU §13 native: ${name}`,
  async ({ page, backendParam, collector }, info) => {
  void collector;
  test.skip(backendParam !== 'webgpu', 'WebGPU lane fixture; WebGL has its own equivalent fixture');
  await openGame(page, backendParam, { game: 'gpu-scenes', arg1: '2', arg0: String(scene) });
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 40 && await stateHash(page) !== '00000003'; i++) {
    await step(page, 1); await page.waitForTimeout(10);
  }
  expect(await stateHash(page), JSON.stringify(await diagnostics(page))).toBe('00000003');
  const d = await diagnostics(page);
  expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
  const pixels = await readPixels(page);
  const at = (x: number, y: number) => {
    const sx = Math.floor(d.letterbox.x + (x + 0.5) * d.letterbox.w / 64);
    const sy = Math.floor(d.letterbox.y + (y + 0.5) * d.letterbox.h / 64);
    return [...pixels.data.subarray((sy * pixels.width + sx) * 4, (sy * pixels.width + sx) * 4 + 3)];
  };
  if (scene === 0) {
    const c = at(32, 32); expect(c[2]).toBeGreaterThan(100); expect(c[0]).toBeGreaterThan(30);
    expect(at(0, 0)).toEqual([0, 0, 0]);
  }
  if (scene === 1) { expect(at(32, 32)).toEqual([0, 128, 0]); }
  if (scene === 2) { expect(at(32, 32)).toEqual([128, 0, 128]); }
  if (scene === 3) { expect(at(20, 32)).toEqual([0, 255, 0]); expect(at(48, 32)).toEqual([0, 0, 0]); }
  if (scene === 4) {
    let green = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (at(x, y)[1] === 255) green++;
    expect(green).toBeGreaterThan(700); expect(green).toBeLessThan(3000);
  }
  if (scene === 5) {
    const before = at(32, 32); await step(page, 1);
    const after = await readPixels(page);
    expect(after.data.equals(pixels.data), 'uniform update changes rendered pixels').toBe(false);
    expect(before[0] + before[1]).toBe(255);
  }
  if (scene === 6) { expect(at(8, 32)).toEqual([0, 0, 0]); expect(at(32, 32)).toEqual([255, 0, 0]); }
  if (scene === 7) { expect(at(4, 32)).toEqual([255, 255, 0]); expect(at(60, 32)).toEqual([255, 255, 255]); }
});

for (const recoveryScene of [1, 2, 3, 6])
  test(`WebGPU §13 scene ${recoveryScene}: resources and pipelines survive device loss`,
  async ({ page, backendParam, collector }, info) => {
  void collector;
  test.skip(backendParam !== 'webgpu');
  await openGame(page, backendParam, { game: 'gpu-scenes', arg1: '2', arg0: String(recoveryScene) });
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 30 && await stateHash(page) !== '00000003'; i++) {
    await step(page, 1); await page.waitForTimeout(10);
  }
  expect(await stateHash(page)).toBe('00000003');
  const before = await readPixels(page);
  await page.evaluate(() => (window as any).__BGT_TEST__.simulateDeviceLoss());
  await step(page, 2);
  const after = await readPixels(page);
  expect(after.data.equals(before.data)).toBe(true);
  const d = await diagnostics(page);
  expect(d.deviceResets).toBe(1);
  expect(d.errors.filter(e => e.kind !== 'device-lost')).toEqual([]);
});
