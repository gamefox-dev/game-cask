// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-frame), never game assets.
// K60 (Q115/Q117): an engine-shaped 2D frame (48 items with their own uniforms and a generic current colour,
// per-frame capability resets, one validation error, stream re-specification, feedback captures, blits) is one
// ABI submit and one WebGPU queue submit per frame; uniform/current-attribute uploads write disjoint ring
// slots, so WebGPU renames only buffers rewritten in place; capture translations are cached. Breakage caught:
// synchronous current-attribute uploads and error flushes (K57: 2 submits per item draw), per-draw renames of
// program uniform buffers, per-capture GLSL re-translation, and any reordering (merged pixels must equal the
// per-pass native path's pixels).
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';

const steady = async (page: Page) => {
  for (let i = 0; i < 200; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).logs.some(l => l.message.includes('x64-gl-frame PASS frame state'))) break;
  }
  await step(page, 3);
};
test('x64-gl-frame: per-item constants, capability resets and a GL error keep one submit and exact pixels', async ({ page, backendParam }, info) => {
  const run = async (batch: string) => {
    expect(await openGame(page, backendParam, { game: 'x64-gl-frame', gpubatch: batch })).toBe('ready');
    await assertBackend(page, backendParam, info);
    await steady(page);
    await step(page, 1);
    const d = await diagnostics(page);
    return { d, pixels: await readPixels(page) };
  };
  const merged = await run('1'), split = await run('0');
  for (const { d } of [merged, split]) {
    expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
    expect(d.logs.filter(l => /FAIL|error/.test(l.message))).toEqual([]);
    expect(d.logs.some(l => l.message.includes('x64-gl-frame PASS frame state'))).toBe(true);
    expect(d.lastFrame.drawCalls).toBe(48 + 8 + 8 + 4 + 1);
    expect(d.lastFrame.submits).toBe(1); expect(d.lastFrame.continuationSubmits).toBe(1);
  }
  const m = merged.d.lastFrame;
  if (backendParam === 'webgpu') {
    expect(m.nativeSubmits).toBe(1);
    // 24 in-place stream re-specifications of buffers the previous batch reads; ring slots never rename.
    expect(m.bufferRenames).toBeLessThanOrEqual(24);
    expect(m.captureTranslations).toBe(0); // steady frame: every capture reuses its cached translation
  } else {
    expect(m.nativeSyncQueries?.getError).toBe(1);
  }
  expect(merged.pixels.width).toBe(split.pixels.width);
  if (hardwarePixels()) expect(Buffer.compare(merged.pixels.data, split.pixels.data)).toBe(0);
  // Not a cleared screen: item quads with their per-item constant colours reach the default framebuffer.
  const b = merged.d.letterbox, px = merged.pixels, colours = new Set<string>();
  let lit = 0;
  for (let y = 0; y < 224; y += 4) for (let x = 0; x < 256; x += 4) {
    const at = (Math.floor(b.y + (y + 0.5) * b.h / 224) * px.width + Math.floor(b.x + (x + 0.5) * b.w / 256)) * 4;
    if (px.data[at] + px.data[at + 1] + px.data[at + 2] > 120) { lit++; colours.add(`${px.data[at] >> 4},${px.data[at + 1] >> 4},${px.data[at + 2] >> 4}`); }
  }
  expect(lit).toBeGreaterThan(40); expect(colours.size).toBeGreaterThan(12);
});
