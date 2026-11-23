// SPDX-License-Identifier: CC0-1.0. Original fixture (x64-gl-programs), never game assets.
// K73 (Q139): `__BGT_TEST__.step(n)` is the same as n x step(1) on every backend.
// Catches: a step(n) that waits for host I/O before each update but for renderer results (shader compile status,
// stage modules, readbacks: asynchronous on WebGPU) only after the whole chunk, so every update of the chunk polls the
// same 0 (MMX8 r30: step(25) reached update 7000 with 1893 presents vs 5567 for 25 x step(1); WebGL 2 identical).
// The guest polls 120 blocking results (24 programs x 2 compiles, 2 link stage modules, 1 glReadPixels).
// BGT_K73_IOWAIT=0 (`?iowait=0`) runs the pre-K73 step for the negative control (fails on WebGPU).
import { test, expect, openGame, assertBackend } from './fixtures';

test.beforeEach(async ({ collector }) => { void collector; });

const CHUNK = 25, UPDATES = 250;
interface Row { frame: number; swaps: number | null; virtualUs: string | null; hash: string | null; done: boolean }

test('x64-gl-programs: step(25) chunks and 25 x step(1) give the same presents, guest time and state hash', async ({ page, backendParam }, info) => {
  test.setTimeout(240_000);
  const wait = process.env.BGT_K73_IOWAIT;
  const series = async (single: boolean) => {
    expect(await openGame(page, backendParam, { game: 'x64-gl-programs', ...(wait === undefined ? {} : { iowait: wait }) })).toBe('ready');
    await assertBackend(page, backendParam, info);
    return page.evaluate(async ({ single, CHUNK, UPDATES }) => {
      const api = (window as any).__BGT_TEST__, rows: Row[] = [];
      for (let f = 0; f < UPDATES; f += CHUNK) {
        if (single) for (let i = 0; i < CHUNK; i++) await api.step(1); else await api.step(CHUNK);
        const d = api.diagnostics(), m = d.metrics;
        if (api.failed() || d.errors.length) throw new Error(JSON.stringify(d.errors));
        rows.push({ frame: d.frame, swaps: m.execution_summary?.guest_frames?.swaps ?? null,
          virtualUs: m.guest_time?.virtual_us == null ? null : String(m.guest_time.virtual_us), hash: api.stateHash(),
          done: d.logs.some((l: { message: string }) => l.message.includes('gl-programs done')) });
      }
      return { rows, loop: api.pageLoop() };
    }, { single, CHUNK, UPDATES });
  };
  const chunked = await series(false), single = await series(true);
  console.log('K73 step-chunks', JSON.stringify({ backend: backendParam, wait: wait ?? 'default',
    chunked: chunked.rows.at(-1), single: single.rows.at(-1), chunkedLoop: chunked.loop, singleLoop: single.loop }));
  await info.attach('step-chunks.json', { contentType: 'application/json', body: JSON.stringify({ chunked, single }, null, 1) });
  // The fixture finishes its 120 blocking results inside the window, so the comparison covers the polling startup.
  expect(single.rows.find(r => r.done), JSON.stringify(single.rows)).toBeTruthy();
  expect(single.rows.at(-1)!.frame).toBe(UPDATES);
  // Same guest timeline at every chunk boundary: frame, guest presents, virtual time, state hash.
  expect(chunked.rows).toEqual(single.rows);
  // The guest presents after startup (otherwise equal presents would prove nothing about the polling updates).
  expect(single.rows.at(-1)!.swaps).toBeGreaterThan(single.rows.find(r => r.done)!.swaps ?? 0);
  // On WebGPU the chunked run really waited (results resolve outside the render); WebGL 2 results complete in it.
  if (backendParam === 'webgpu' && wait === undefined) expect(chunked.loop.stepRequestWaits).toBeGreaterThan(0);
  expect(chunked.loop.stepRequestWaitTimeouts).toBe(0);
});
