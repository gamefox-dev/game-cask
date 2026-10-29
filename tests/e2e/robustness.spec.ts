import { CommandEncoder, rgba } from '../../bgt/runtime/commands';
import { CMD_MAGIC, E_BOUNDS, E_INVALID, E_LIMIT, E_NOT_FOUND, E_UNSUPPORTED, OP } from '../../bgt/runtime/abi';
import { test, expect, openGame, assertBackend, diagnostics, step, readPixels, findColor, attachScreenshot, PLAYER_CYAN, WALL_BLUE, debugState } from './fixtures';

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function malformed(): Array<{ name: string; bytes: Uint8Array; expect: number }> {
  const good = new CommandEncoder().clear(rgba(1, 2, 3)).finish();
  const badMagic = good.slice();
  new DataView(badMagic.buffer).setUint32(0, CMD_MAGIC ^ 1, true);
  const truncated = good.slice(0, good.length - 4);
  const lenMismatch = good.slice();
  new DataView(lenMismatch.buffer).setUint32(8, good.length + 64, true);
  const hugeCount = good.slice();
  new DataView(hugeCount.buffer).setUint32(12, 1 << 30, true);
  const payloadOverrun = new CommandEncoder().raw(OP.CLEAR, [0, 0, 0, 0]).finish();
  new DataView(payloadOverrun.buffer).setUint32(16 + 4, 4096, true);
  return [
    { name: 'bad magic', bytes: badMagic, expect: E_INVALID },
    { name: 'truncated', bytes: truncated, expect: E_INVALID },
    { name: 'byte_len mismatch', bytes: lenMismatch, expect: E_INVALID },
    { name: 'cmd_count over limit', bytes: hugeCount, expect: E_LIMIT },
    { name: 'payload past end', bytes: payloadOverrun, expect: E_BOUNDS },
    { name: 'unknown opcode', bytes: new CommandEncoder().raw(0x7f, [1, 2, 3, 4]).finish(), expect: E_UNSUPPORTED },
    { name: 'tex update out of memory range', bytes: new CommandEncoder().texCreate(77, 2, 2).texUpdate(77, 0, 0, 2, 2, 0x7ffffff0, 16).finish(), expect: E_BOUNDS },
    { name: 'unknown texture', bytes: new CommandEncoder().texture(999).finish(), expect: E_NOT_FOUND },
    { name: 'sprite count/payload mismatch', bytes: new CommandEncoder().raw(OP.SPRITES, [5, 0, 0, 0]).finish(), expect: E_INVALID },
    { name: 'oversized texture', bytes: new CommandEncoder().texCreate(78, 100000, 4).finish(), expect: E_LIMIT },
    { name: 'NaN transform', bytes: new CommandEncoder().transform(NaN, 0, 0, 1, 0, 0).finish(), expect: E_INVALID },
    { name: 'empty buffer', bytes: new Uint8Array(8), expect: E_INVALID },
  ];
}

test('malformed command streams are rejected with explicit errors and the game keeps running', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  const results: Record<string, number> = {};
  for (const m of malformed()) {
    const r = await page.evaluate((s) => (window as any).__BGT_TEST__.injectCommands(s), b64(m.bytes));
    results[m.name] = r.status;
  }
  const expected = Object.fromEntries(malformed().map((m) => [m.name, m.expect]));
  expect(results).toEqual(expected);
  await step(page, 5);
  const d = await diagnostics(page);
  expect(d.failed).toBe(false);
  expect(d.errors).toEqual([]);
  expect(d.commandErrors.count).toBeGreaterThanOrEqual(malformed().length);
  const px = await readPixels(page);
  expect(findColor(px, WALL_BLUE, 4).count).toBeGreaterThan(5000); // still rendering normally
});

test('resize, orientation change and DPR keep the game correctly letterboxed', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  for (const vp of [{ width: 960, height: 540 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 333, height: 777 }]) {
    await page.setViewportSize(vp);
    await expect.poll(async () => (await diagnostics(page)).canvas.cssWidth).toBe(vp.width);
    await step(page, 1);
    const d = await diagnostics(page);
    expect(d.canvas.width).toBe(Math.round(vp.width * d.canvas.dpr));
    expect(d.letterbox.w).toBeLessThanOrEqual(d.canvas.width);
    expect(d.letterbox.h).toBeLessThanOrEqual(d.canvas.height);
    expect(Math.abs(d.letterbox.w / d.letterbox.h - 320 / 180)).toBeLessThan(0.02);
    const px = await readPixels(page);
    expect(findColor(px, WALL_BLUE, 4).count).toBeGreaterThan(500);
    await attachScreenshot(page, testInfo, `resize-${vp.width}x${vp.height}.png`);
  }
});

test('high-DPR display uses a device-pixel backing store', async ({ browser, backendParam, collector }, testInfo) => {
  void collector;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    expect(await openGame(page, backendParam)).toBe('ready');
    await assertBackend(page, backendParam, testInfo);
    const d = await diagnostics(page);
    expect(d.canvas.dpr).toBe(3);
    expect(d.canvas.width).toBe(390 * 3);
    // integer scaling: 1170 px wide / 320 logical = 3.65 -> 3
    expect(d.letterbox.scale).toBe(3);
    await expect(page.getByRole('button', { name: 'start' })).toBeVisible(); // coarse pointer -> overlay
  } finally {
    await ctx.close();
  }
});

test('GPU device/context loss is recovered and textures are restored', async ({ page, backendParam, collector }, testInfo) => {
  collector.allow(/device lost|context lost/i);
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await page.evaluate(() => (window as any).__BGT_TEST__.pause());
  await step(page, 2);
  const before = findColor(await readPixels(page), WALL_BLUE, 4).count;
  await page.evaluate(() => (window as any).__BGT_TEST__.simulateDeviceLoss());
  await expect.poll(async () => (await diagnostics(page)).deviceResets, { timeout: 10_000 }).toBe(1);
  await step(page, 2);
  const after = await readPixels(page);
  expect(findColor(after, WALL_BLUE, 4).count).toBe(before); // atlas re-uploaded from shadow copy
  expect(findColor(after, PLAYER_CYAN, 4).count).toBeGreaterThan(200);
  const d = await diagnostics(page);
  expect(d.errors.map((e) => e.kind)).toEqual(['device-lost']);
  expect((await debugState(page)).state).toBe('title'); // simulation untouched
});
