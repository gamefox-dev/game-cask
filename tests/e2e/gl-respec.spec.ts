// SPDX-License-Identifier: CC0-1.0. Original fixture (examples/x64-gl-respec), never game assets.
// K57: varying-size glBufferData reuses native capacity, and allocations, transform-feedback draws and blits are
// ordinary batched commands: one ABI submit per frame, one WebGPU queue submit (blits and captures encoded into the
// frame encoder), one production WebGL getError per frame. Breakage caught: allocation/feedback/blit batch splits
// (K53 shape: 181 submits, 45 WebGPU submits, 201 getError per frame), per-op native polls, and reordered captures,
// blits or streamed uploads (merged pixels would differ from the per-pass native path).
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';

const counter = (d: Awaited<ReturnType<typeof diagnostics>>, key: string) => (d.metrics as Record<string, number>)[key];
const steady = async (page: Page) => {
  for (let i = 0; i < 200; i++) {
    await step(page, 1);
    if ((await diagnostics(page)).lastFrame.drawCalls === 57) break;
  }
  await step(page, 3);
  return diagnostics(page);
};
test('x64-gl-respec: capacity reuse, batched feedback/blits and one native sync per frame keep exact pixels', async ({ page, backendParam }, info) => {
  const run = async (batch: string) => {
    expect(await openGame(page, backendParam, { game: 'x64-gl-respec', gpubatch: batch })).toBe('ready');
    await assertBackend(page, backendParam, info);
    const before = await steady(page);
    await step(page, 1);
    const d = await diagnostics(page);
    return { before, d, pixels: await readPixels(page) };
  };
  const merged = await run('1'), split = await run('0');
  for (const { before, d } of [merged, split]) {
    expect(d.commandErrors.count).toBe(0); expect(d.errors).toEqual([]);
    expect(d.logs.filter(l => /FAIL|error/.test(l.message))).toEqual([]);
    // 39 draws plus 18 feedback captures; 60 varying-size re-specifications all fit the live capacity.
    expect(d.lastFrame.drawCalls).toBe(57);
    expect(d.lastFrame.submits).toBe(1); expect(d.lastFrame.continuationSubmits).toBe(1);
    expect(counter(d, 'gl_sync_submits') - counter(before, 'gl_sync_submits')).toBe(0);
    expect(counter(d, 'gl_buffer_capacity_reused') - counter(before, 'gl_buffer_capacity_reused')).toBe(60);
    expect(counter(d, 'gl_buffer_capacity_grown') - counter(before, 'gl_buffer_capacity_grown')).toBe(0);
  }
  const m = merged.d.lastFrame, s = split.d.lastFrame;
  if (backendParam === 'webgpu') {
    // Blits and compute-emulated captures are encoded into the frame encoder: one GPUQueue.submit per frame.
    expect(m.nativeSubmits).toBe(1); expect(s.nativeSubmits).toBeGreaterThan(40);
  } else {
    // Production: only the deferred frame-end poll (no BUFFER_CREATE/BLIT/feedback polls).
    expect(m.nativeSyncQueries?.getError).toBe(1);
    expect(Object.keys(m.nativeSyncQueryOps ?? {})).toEqual(['frameEnd']);
  }
  expect(merged.pixels.width).toBe(split.pixels.width);
  if (hardwarePixels()) expect(Buffer.compare(merged.pixels.data, split.pixels.data)).toBe(0);
  // Not a cleared screen: tiles, canvas quads, particles and the inset blit reach the default framebuffer.
  const b = merged.d.letterbox, px = merged.pixels;
  let lit = 0;
  for (let y = 0; y < 224; y += 8) for (let x = 0; x < 256; x += 8) {
    const at = (Math.floor(b.y + (y + 0.5) * b.h / 224) * px.width + Math.floor(b.x + (x + 0.5) * b.w / 256)) * 4;
    if (px.data[at] + px.data[at + 1] + px.data[at + 2] > 120) lit++;
  }
  expect(lit).toBeGreaterThan(20);
});
