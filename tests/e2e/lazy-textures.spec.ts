// SPDX-License-Identifier: CC0-1.0
// K71 (Q128): §13 texture storage is committed on first use; (Q129) `gpu.recoveryShadows: false` keeps no texture
// upload shadows and turns a later GPU loss into a reported fatal error.
// Catches: storage allocated at TEXTURE_CREATE/ALLOCATE_MIPS (lazy bytes stay 0), a first use that does not
// materialize (sampling/attachment/readback/mip generation read garbage or GL errors), a depth level that is not
// initialized to 1 on materialization, a mid-pass materialization that leaves the wrong framebuffer bound (the draw
// goes elsewhere), reservation accounting that no longer adds up, pixels that differ from eager allocation, and a
// shadow opt-out that keeps shadows or silently "restores" missing texels.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels, stateHash, debugState, hardwarePixels } from './fixtures';
import type { Page } from '@playwright/test';
import type { BGTDiagnostics } from '../../bgt/runtime/runtime';

type ProbeResult = Awaited<ReturnType<typeof import('./lazy-texture-probe').lazyTextureProbe>>;
const probe = (page: Page, backend: string, opts: { lazy: boolean; shadows: boolean }): Promise<ProbeResult> =>
  page.evaluate(async ({ path, backend, opts }) => {
    const { lazyTextureProbe } = await import(/* @vite-ignore */ path);
    return lazyTextureProbe(backend, opts);
  }, { path: `/@fs${resolve('tests/e2e/lazy-texture-probe.ts')}`, backend, opts });

const one = [0, 0, 128, 63], half = [0, 0, 0, 63]; // little-endian binary32 1.0 and 0.5
const level = (n: number, texel: number[]) => Array.from({ length: n }, () => texel).flat();
const created = { t26: level(64, [0, 0, 0, 0]), t25: level(64, one), t22: level(64, [0, 0, 0, 0]), t22m1: level(16, [0, 0, 0, 0]),
  t20: level(64, one), t24: level(16, [0, 0, 0, 0]), t28: level(16, [0, 0, 0, 0]), t29: level(64, one) };
const expected = { ...created, t28: level(16, [64, 128, 191, 255]), t29: level(64, half) };
// Reserved bytes per texture (8x8 RGBA8/depth = 256 B; 4x4 RGBA8 = 64 B; 8x8 RGBA8 with 4 levels = 340 B).
const B = { t20: 256, t21: 256, t22: 340, t23: 64, t24: 64, t25: 256, t26: 256, t28: 64, t29: 256 };
const total = Object.values(B).reduce((a, b) => a + b, 0);

test('lazy texture storage: creation values, eager-identical pixels and readbacks, exact accounting', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const lazy = await probe(page, backendParam, { lazy: true, shadows: true });
  const eager = await probe(page, backendParam, { lazy: false, shadows: true });
  await info.attach('lazy-textures.json', { body: JSON.stringify({ lazy, eager }, null, 2), contentType: 'application/json' });
  for (const r of [lazy, eager]) {
    expect(r.errors).toEqual([]);
    expect(r.recovery).toBe('');
    expect(r.refused).toBe('');
    // Never-materialized RGBA8 samples 0, the clear-only-pass constant (0.5 green) and DEPTH32F 1.0 materialized
    // inside the screen pass sample their values.
    if (hardwarePixels()) for (const [i, v] of [64, 128, 191, 255].entries()) expect(Math.abs(r.sampled[i] - v), `channel ${i}`).toBeLessThanOrEqual(1);
    expect(r.before).toEqual(expected);
    // Recovery: uploaded levels are replayed (none here); rendered/cleared contents are lost, as before K71.
    expect(r.after).toEqual(created);
  }
  expect(lazy.sampled).toEqual(eager.sampled);
  // Lazy: nothing is allocated at creation (mips included); each first use commits exactly that texture.
  const s = lazy.steps;
  expect(s.created).toMatchObject({ bytes: 0, lazy: total, lazyCount: 9, lazyDepth: B.t20 + B.t21 + B.t25 + B.t29, shadows: 0 });
  // Clear-only passes over storage-less attachments only record constants.
  expect(s.cleared).toMatchObject({ bytes: 0, lazy: total });
  expect(s.sampled).toMatchObject({ bytes: B.t20 + B.t24 + B.t28, depth: B.t20, lazy: total - B.t20 - B.t24 - B.t28 });
  // A LOAD-only pass over storage-less attachments ends without an in-pass op: still nothing to allocate.
  expect(s.attached).toMatchObject({ bytes: B.t20 + B.t24 + B.t28, depth: B.t20 });
  expect(lazy.lazyStats.deferredPasses).toBe(3);
  // Readback materializes the generated chain; the never-used depth/stencil and color textures stay unallocated.
  expect(s.readback).toMatchObject({ bytes: total - B.t21 - B.t23, lazy: B.t21 + B.t23, lazyCount: 2, lazyDepth: B.t21 });
  // Recovery recreates every texture lazily (uploaded levels would be replayed; none here): no storage until reuse.
  expect(s.restored).toMatchObject({ bytes: 0, lazy: total, shadows: 0 });
  expect(s.uploaded.bytes + s.uploaded.lazy).toBe(total + 16);
  // Eager (`?lazytextures=0`): every texture holds storage from creation, as before K71.
  for (const k of ['created', 'cleared', 'sampled', 'attached', 'readback', 'restored'] as const)
    expect(eager.steps[k], k).toMatchObject({ bytes: total, depth: B.t20 + B.t21 + B.t25 + B.t29, lazy: 0, lazyCount: 0 });
  expect(eager.lazyStats.deferredPasses).toBe(0);
});

test('recovery shadows off: uploads keep no texture shadow and the next GPU loss refuses to restore', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const off = await probe(page, backendParam, { lazy: true, shadows: false });
  const on = await probe(page, backendParam, { lazy: true, shadows: true });
  expect(off.errors).toEqual([]);
  // Losses before any upload still restore exactly (nothing was dropped).
  expect(off.recovery).toBe('');
  expect(off.after).toEqual(created);
  expect(off.steps.uploaded.shadows).toBe(0);
  expect(off.refused).toContain('texture recovery shadows are disabled (gpu.recoveryShadows: false): 1 uploaded texture(s)');
  expect(on.steps.uploaded.shadows).toBe(16);
  expect(on.refused).toBe('');
});

// vK71 review: WebGPU generates 3D mips on the CPU from the upload shadow. Catches an opt-out that drops that
// load-bearing shadow (generated levels become 0 instead of the box-filtered base).
test('recovery shadows off: 3D GENERATE_MIPS still produces the filtered levels', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (const shadows of [true, false]) {
    const r = await page.evaluate(async ({ path, backend, shadows }) => {
      const { mip3dProbe } = await import(/* @vite-ignore */ path);
      return mip3dProbe(backend, shadows);
    }, { path: `/@fs${resolve('tests/e2e/lazy-texture-probe.ts')}`, backend: backendParam, shadows });
    expect(r.errors, `shadows ${shadows}`).toEqual([]);
    expect(r.level1, `shadows ${shadows}`).toEqual(level(8, [200, 100, 50, 255]));
    expect(r.level2, `shadows ${shadows}`).toEqual(level(1, [200, 100, 50, 255]));
  }
});

// Catches a manifest/URL opt-out that is not applied to the live executor, not reported, or that lets a loss after
// uploads continue with blank textures instead of the documented device-lost stop.
test('runtime: ?recoveryshadows=0 is reported, keeps no texture shadows, and a device loss stops the game', async ({ page, backendParam, collector }, info) => {
  collector.allow(/device-lost: .*texture recovery shadows are disabled/);
  for (const shadows of ['1', '0']) {
    expect(await openGame(page, backendParam, { game: 'gpu-scenes', arg0: '1', recoveryshadows: shadows })).toBe('ready');
    await assertBackend(page, backendParam, info);
    for (let i = 0; i < 8; i++) { await step(page, 1); if ((await debugState<{ read: number }>(page))?.read) break; }
    const d = await diagnostics(page), m = d.memory;
    expect(m.gpu!.recoveryShadows).toEqual({ enabled: shadows === '1', source: 'url' });
    if (shadows === '1') {
      expect(m.gpu!.native!.shadows.textureBytes).toBeGreaterThan(0);
      continue;
    }
    expect(m.gpu!.native!.shadows.textureBytes).toBe(0);
    expect(d.backendNotes.some((n) => n.includes('texture recovery shadows disabled (url)'))).toBe(true);
    await page.evaluate(() => { void (window as unknown as { __BGT_TEST__: { simulateDeviceLoss(): Promise<void> } }).__BGT_TEST__.simulateDeviceLoss(); });
    await page.waitForFunction(() => (window as unknown as { __BGT_TEST__: { failed(): boolean } }).__BGT_TEST__.failed(), null, { timeout: 20000 });
    const after = await diagnostics(page);
    const lost = after.errors.filter((e) => e.kind === 'device-lost').map((e) => e.message).join('\n');
    expect(lost).toContain('texture recovery shadows are disabled (gpu.recoveryShadows: false)');
  }
});

// Real fixtures through the Win32 GL profile and the §13 C fixture: identical guest-visible results with lazy and
// eager storage, and the reservation is exactly materialized + lazy bytes.
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);
async function run(page: Page, backend: string, params: Record<string, string>, frames: number) {
  expect(await openGame(page, backend, params)).toBe('ready');
  await step(page, frames);
  // gpu-scenes: its ordered GPU readback completes asynchronously on WebGPU; wait for it (as gpu-webgl2.spec boots).
  if (params.game === 'gpu-scenes') for (let i = 0; i < 20 && !(await debugState<{ read: number }>(page))?.read; i++) await step(page, 1);
  const d: BGTDiagnostics = await diagnostics(page), px = await readPixels(page);
  return { hash: await stateHash(page), pixels: sha(px.data), errors: d.errors, commandErrors: d.commandErrors.count, memory: d.memory };
}
for (const [game, params, frames] of [['gpu-scenes', { arg0: '2' }, 6], ['gpu-scenes', { arg0: '3' }, 6], ['gpu-scenes', { arg0: '7' }, 6],
  ['x64-gl-fbo', {}, 40], ['x64-gl-blit', {}, 40], ['x64-gl', {}, 60]] as const) {
  test(`lazy vs eager texture storage: ${game} ${JSON.stringify(params)} is unchanged`, async ({ page, backendParam, collector }, info) => {
    void collector;
    const eager = await run(page, backendParam, { game, ...params, lazytextures: '0' }, frames);
    await assertBackend(page, backendParam, info);
    const lazy = await run(page, backendParam, { game, ...params }, frames);
    await info.attach('memory.json', { body: JSON.stringify({ eager: eager.memory, lazy: lazy.memory }, null, 2), contentType: 'application/json' });
    for (const r of [eager, lazy]) { expect(r.errors).toEqual([]); expect(r.commandErrors).toBe(0); }
    expect(lazy.hash).toBe(eager.hash);
    if (hardwarePixels()) expect(lazy.pixels).toBe(eager.pixels);
    for (const r of [eager, lazy]) {
      const g = r.memory.gpu!, t = g.native!.textures;
      expect(t.bytes + (t.lazy?.bytes ?? 0)).toBe(g.reserved.textures);
    }
    expect(eager.memory.gpu!.native!.textures.lazy?.bytes ?? 0).toBe(0);
    expect(lazy.memory.gpu!.native!.textures.bytes).toBeLessThanOrEqual(eager.memory.gpu!.native!.textures.bytes);
  });
}
