// SPDX-License-Identifier: CC0-1.0
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BACKEND_HEADLESS, CAP_DIRECT_DRAW, CAP_GPU, CAP_RENDER_TARGETS, GPU_OP } from '../../bgt/runtime/abi';
import { GameHost } from '../../bgt/runtime/host';
import { jspiApi } from '../../bgt/runtime/jspi';
import { Vfs } from '../../bgt/runtime/vfs';
import { ROOT } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it.skipIf(!jspiApi())('submits the same GL work after a worker presents in either JSPI resume path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-worker-present-'));
  try {
    const id = 'jspi-worker-present', outRoot = join(dir, 'out');
    cpSync(join(ROOT, 'tests/fixtures/c/jspi-worker-present.c'), join(dir, 'guest.c'));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 worker presentations', suspensionBuild: 'jspi', pipeline: {
      platform: 'win32', fixture: { target: 'x86_64-windows-gnu', crt: true, sources: ['guest.c'], out: 'guest.exe', libs: ['kernel32', 'user32', 'gdi32', 'opengl32'] },
      modules: [{ from: './build/guest.exe', main: true }], width: 16, height: 16,
    } }));
    const manifest = buildGame(dir, { quiet: true, outRoot });
    const wasm = readFileSync(join(outRoot, id, manifest.wasm.url.split('?')[0]));
    const run = async (checkpointBoundaries: boolean) => {
      const stream = glStream(), logs: string[] = [], vfs = new Vfs();
      for (const a of manifest.assets) vfs.add(a.path, readFileSync(join(outRoot, id, a.url.split('?')[0])));
      const host = await GameHost.create(wasm, { vfs, log: (_, m) => logs.push(m), now: () => 0 }, {
        backend: BACKEND_HEADLESS, caps: CAP_GPU | CAP_DIRECT_DRAW | CAP_RENDER_TARGETS, displayWidth: 16, displayHeight: 16, seed: 1, arg0: 0, arg1: 0,
        suspensionMode: 'jspi', checkpointBoundaries, gpuBackend: stream.gpuBackend,
      });
      host.init();
      const step = async () => {
        await host.update();
        const frame = host.render();
        const clears = frame.items.filter(i => i.kind === 'gpu' && i.op === GPU_OP.PASS_BEGIN);
        stream.executeFrame!(frame);
        host.consume();
        return clears;
      };
      await step();
      expect(host.suspended).toBe(true);
      expect(!!host['jspiResume']).toBe(!checkpointBoundaries);
      expect(logs.filter(l => l.includes('resumed from SwapBuffers'))).toEqual([]);
      const renders = await step();
      expect(logs.filter(l => l.includes('resumed from SwapBuffers'))).toEqual([
        'guest: worker resumed from SwapBuffers', 'guest: main resumed from SwapBuffers',
      ]);
      expect(host.commandErrorCount, JSON.stringify(host.commandErrors)).toBe(0);
      const { guest_time } = host.metrics() as { guest_time: { deferred_gl_lists: number } };
      return {clears:renders.map(i=>i.words.slice(10,14)), deferred:Number(guest_time.deferred_gl_lists)};
    };
    const conventional = await run(false);
    const one=0x3f800000;
    expect(conventional).toEqual({clears:[[0,one,0,one],[0,0,one,one]], deferred:0});
    expect(await run(true)).toEqual(conventional);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);
