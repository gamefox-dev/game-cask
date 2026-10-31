import { test, expect, openGame, assertBackend, step, input, readPixels, diagnostics, debugState, attachScreenshot } from './fixtures';
import { hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';

async function key(page: Page, code: string) {
  await input(page, [{ type: 'key', code, down: true }]); await step(page, 1);
  await input(page, [{ type: 'key', code, down: false }]); await step(page, 3);
}

// Pixel assertions deliberately distinguish radio corners/dots from squares, and ticks from solid fills.
test('Phase 0: virtual waits, shared font metrics, multi-rect parent clipping, prefixes and styled controls', async ({ page, backendParam, collector }, info) => {
  collector.allow(/guest: conformance|guest: phase0/);
  const logs: string[] = []; page.on('console', (m) => logs.push(m.text()));
  expect(await openGame(page, backendParam, { game: 'win32-conformance' })).toBe('ready');
  await assertBackend(page, backendParam, info); await step(page, 20);
  await key(page, 'KeyT');
  expect(logs.find((s) => s.includes('phase0 checks='))).toContain('00000fff');
  const d = await diagnostics(page), px = await readPixels(page);
  const at = (x: number, y: number) => {
    const scale = d.letterbox.w / d.logical.width;
    const o = 4 * (Math.floor(d.letterbox.y + (y + 0.5) * scale) * px.width + Math.floor(d.letterbox.x + (x + 0.5) * scale));
    return [...px.data.subarray(o, o + 3)];
  };
  if (hardwarePixels()) {
  expect(at(50,125)).toEqual([255,255,255]);
  expect(at(170,125)).toEqual([255,255,255]);
  expect(at(41,120)).toEqual([0,0,0]); // WS_BORDER, client inset is checked by the guest
  expect(at(10,63)).toEqual([236,233,216]); // radio corner is face, NOT square border
  expect(at(16,69)).toEqual([0,0,0]); // radio dot
  expect(at(163,66)).toEqual([255,255,255]); // check interior remains white (not a solid square)
  expect(at(163,69)).toEqual([0,0,0]); // tick stroke
  }
  const ui = (await debugState(page)).ui;
  expect(ui.windows.find((w: any) => w.id === 912)).toMatchObject({ class: 'static', exstyle: 0, style: 0x50000080 });
  // Prefix statics differ by the literal ampersands, not just metadata.
  const countDark = (y: number) => { let n = 0; for (let yy = y; yy < y + 16; yy++) for (let x = 160; x < 250; x++) if (at(x,yy).every((v) => v < 30)) n++; return n; };
  expect(countDark(35)).toBeGreaterThan(countDark(10));
  await attachScreenshot(page, info, 'phase0-controls.png');
  const before = (d.metrics as any).gdi_ops;
  await page.evaluate(() => (window as any).__BGT_TEST__.screenshot());
  expect(((await diagnostics(page)).metrics as any).gdi_ops).toBe(before);
});

test('Phase 0: MessageBox icons/default button and ShellAboutW are modal and dismissible', async ({ page, backendParam, collector }, info) => {
  collector.allow(/guest: conformance|guest: phase0/);
  const logs: string[] = []; page.on('console', (m) => logs.push(m.text()));
  expect(await openGame(page, backendParam, { game: 'win32-conformance' })).toBe('ready');
  await assertBackend(page, backendParam, info); await step(page, 20);
  await key(page, 'KeyI');
  const mb = (await debugState(page)).ui.messagebox;
  expect(mb).toMatchObject({ caption: 'Icon contract', type: 0x134 });
  const d = await diagnostics(page), px = await readPixels(page);
  const x = mb.rect[0] + 23, y = mb.rect[1] + 40, sc = d.letterbox.w / d.logical.width;
  const o = 4 * (Math.floor(d.letterbox.y + (y + 0.5) * sc) * px.width + Math.floor(d.letterbox.x + (x + 0.5) * sc));
  if (hardwarePixels()) expect([...px.data.subarray(o, o + 3)]).toEqual([255,216,0]);
  await attachScreenshot(page, info, 'phase0-icon.png');
  await key(page, 'Enter');
  expect((await debugState(page)).ui.messagebox).toBeNull();
  expect(logs.some((s) => s.includes('phase0 default=No'))).toBe(true);
  await key(page, 'KeyA');
  expect((await debugState(page)).ui.messagebox).toMatchObject({ caption: 'About Fixture', text: 'Kit profile CC0 contract test' });
  await key(page, 'Enter');
  expect((await debugState(page)).ui.messagebox).toBeNull();
  expect((await diagnostics(page)).errors).toEqual([]);
});
