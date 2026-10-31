// Win32 profile conformance in a real browser: the pixel values the profile answers to GetPixel/GetDIBits by CPU
// replay of the recorded GDI ops must equal what the GPU actually drew, for every op kind, on both backends.
// The fixture (examples/win32-conformance) draws every op kind, reads the pixels back in the guest and reports
// them in guest memory; the test reads that report with the read-only peek and the GPU pixels with readPixels.
import { test, expect, openGame, assertBackend, diagnostics, step, readPixels, attachScreenshot, catches, peekBytes } from './fixtures';
import { hardwarePixels } from './fixtures';
import { CW, RH, LOADER_CHECKS, REPORT_BYTES, parseReport, reportAddress, rgbOf } from '../support/conformance';

test('CPU replay of GDI ops matches GPU output for every recorded op kind; loader follows Win32', async ({ page, backendParam, collector }, testInfo) => {
  catches('GetPixel/GetDIBits answers that differ from what the GPU shows (any op kind), or LoadLibrary/GetProcAddress semantics regressing');
  collector.allow(/guest: conformance/);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  expect(await openGame(page, backendParam, { game: 'win32-conformance' })).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  for (let i = 0; i < 60 && reportAddress(logs) === null; i++) await step(page, 1);
  const addr = reportAddress(logs);
  expect(addr, 'fixture reported its result address').not.toBeNull();
  await step(page, 2);
  const r = parseReport(new Uint8Array((await peekBytes(page, addr!, REPORT_BYTES))!));
  expect(LOADER_CHECKS.filter((_, i) => r.loader[i] !== 1)).toEqual([]);
  expect(r.gdiDone).toBe(1);
  const d = await diagnostics(page);
  const m = d.metrics as Record<string, number>;
  expect(m.gdi_getpixel_noread).toBe(0);
  expect(m.gdi_cpu_replays).toBeGreaterThanOrEqual(CW * RH);
  expect(d.errors).toEqual([]);
  await attachScreenshot(page, testInfo, 'win32-conformance.png');

  // All loader/CPU replay/guest checks above run on software too.
  if (!hardwarePixels()) return;
  // GPU pixels at logical pixel centres
  const px = await readPixels(page);
  const s = d.letterbox.w / d.logical.width;
  const gpu = (x: number, y: number) => {
    const o = (Math.floor(d.letterbox.y + (y + 0.5) * s) * px.width + Math.floor(d.letterbox.x + (x + 0.5) * s)) * 4;
    return [px.data[o], px.data[o + 1], px.data[o + 2]];
  };
  let exact = 0, offByOne = 0;
  const bad: string[] = [];
  const perCell: Record<string, number> = {};
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < CW; x++) {
      const cpu = rgbOf(r.screen[y * CW + x]), g = gpu(x, y);
      const delta = Math.max(...cpu.map((c, k) => Math.abs(c - g[k])));
      if (delta === 0) exact++;
      else if (delta === 1) offByOne++;
      else {
        const cell = x < 256 ? `cell ${Math.floor(y / 32) * 8 + Math.floor(x / 32)}` : 'memory bitmap';
        perCell[cell] = (perCell[cell] ?? 0) + 1;
        if (bad.length < 12) bad.push(`(${x},${y}) cpu ${cpu} gpu ${g}`);
      }
    }
  }
  await testInfo.attach('replay-vs-gpu.json', { body: JSON.stringify({ exact, offByOne, mismatches: perCell, examples: bad }, null, 2), contentType: 'application/json' });
  // blends of non-0/255 colours may round differently by one step on different GPU stacks; anything else is a bug
  expect(perCell, `CPU replay vs GPU mismatches: ${bad.join('; ')}`).toEqual({});
  expect(offByOne).toBeLessThan(CW * RH * 0.02);
  // the memory bitmap read with GetPixel on its own DC and with GetDIBits equals its 1:1 blit on the screen
  for (const [x, y] of [[5, 5], [40, 10], [33, 33], [10, 45], [63, 0]]) {
    expect(rgbOf(r.mem[y * 64 + x])).toEqual(gpu(256 + x, y));
  }
});
