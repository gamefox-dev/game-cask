// The Win32 pipeline example in a real browser: lifted x86 code + Win32 profile drawing through
// BGT render targets on WebGPU and WebGL 2.
import { test, expect, openGame, assertBackend, diagnostics, step, input, readPixels, findColor, attachScreenshot, Pixels } from './fixtures';
import type { Page } from '@playwright/test';

const RED: [number, number, number] = [220, 40, 40];
const RED_INV: [number, number, number] = [35, 215, 215];
const metrics = async (page: Page) => (await diagnostics(page)).metrics as Record<string, number & string[]>;
/** logical px -> device px of the pixel readback */
async function toDevice(page: Page, x: number, y: number) {
  const d = await diagnostics(page);
  const s = d.letterbox.w / d.logical.width;
  return [Math.floor(d.letterbox.x + (x + 0.5) * s), Math.floor(d.letterbox.y + (y + 0.5) * s)];
}
async function at(page: Page, px: Pixels, x: number, y: number) {
  const [dx, dy] = await toDevice(page, x, y);
  const o = (dy * px.width + dx) * 4;
  return [px.data[o], px.data[o + 1], px.data[o + 2]];
}

test.describe('win32-hello (systematic pipeline)', () => {
  test.beforeEach(async ({ page, backendParam }, testInfo) => {
    expect(await openGame(page, backendParam, { game: 'win32-hello' })).toBe('ready');
    await assertBackend(page, backendParam, testInfo);
    await step(page, 3);
  });

  test('boots: lifted code creates its window, menu and paints through GDI on BGT', async ({ page, collector }, testInfo) => {
    void collector;
    const d = await diagnostics(page);
    expect(d.logical).toEqual({ width: 300, height: 245 });
    expect(d.errors).toEqual([]);
    expect(d.commandErrors.count).toBe(0);
    expect(d.suspended).toBe(true); // parked in GetMessage
    const m = await metrics(page);
    expect(m.interp_insns).toBe(0);
    expect(m.stubs).toEqual([]);
    expect(m.gdi_ops).toBeGreaterThan(30);
    const px = await readPixels(page);
    expect(findColor(px, RED, 3).count).toBeGreaterThan(500); // tiles from the bitmap resource
    await attachScreenshot(page, testInfo, 'win32-hello-boot.png');
  });

  test('a click selects a tile (InvertRect) and the timer keeps ticking', async ({ page, collector }, testInfo) => {
    void collector;
    // tile 0 is at client (8,30) -> desktop y + 19 (menu bar)
    const before = await at(page, await readPixels(page), 20, 19 + 42);
    await input(page, [{ type: 'pointer', x: 20, y: 19 + 42, buttons: 1 }]);
    await step(page, 2);
    await input(page, [{ type: 'pointer', x: 20, y: 19 + 42, buttons: 0 }]);
    await step(page, 2);
    const after = await at(page, await readPixels(page), 20, 19 + 42);
    for (let c = 0; c < 3; c++) expect(Math.abs(after[c] - (255 - before[c]))).toBeLessThanOrEqual(2);
    await step(page, 70);
    expect((await metrics(page)).timers_fired).toBeGreaterThanOrEqual(2);
    await attachScreenshot(page, testInfo, 'win32-hello-selected.png');
    void RED_INV;
  });

  test('menu bar opens and Help > About shows a modal message box', async ({ page, collector }, testInfo) => {
    void collector;
    // "Help" title in the menu bar (second popup)
    const helpX = 4 + (6 * 4 + 12) + 10;
    await input(page, [{ type: 'pointer', x: helpX, y: 8, buttons: 1 }]);
    await step(page, 1);
    await input(page, [{ type: 'pointer', x: helpX, y: 8, buttons: 0 }]);
    await step(page, 2);
    await attachScreenshot(page, testInfo, 'win32-hello-menu.png');
    await input(page, [{ type: 'pointer', x: helpX + 10, y: 19 + 10, buttons: 1 }]);
    await step(page, 1);
    await input(page, [{ type: 'pointer', x: helpX + 10, y: 19 + 10, buttons: 0 }]);
    await step(page, 3);
    await attachScreenshot(page, testInfo, 'win32-hello-about.png');
    const px = await readPixels(page);
    // message box caption uses the ACTIVECAPTION colour (0x00e35400 -> rgb(0,84,227))
    expect(findColor(px, [0, 84, 227], 3).count).toBeGreaterThan(200);
    expect((await metrics(page)).apis_hit).toContain('MessageBoxA');
  });
});
