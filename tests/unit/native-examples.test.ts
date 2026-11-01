// @bgt-examples: gpu-readback gpu-scenes
// Native BGT games have no guest interpreter/oracle. Keep their package/ABI build
// coverage in the unit suite as well as their real-backend browser assertions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ROOT } from '../support/headless';

for (const id of ['gpu-readback', 'gpu-scenes']) it(`${id}: native package exposes the BGT lifecycle without WASI`, () => {
  const dir = join(ROOT, 'web/public/games', id);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest.id).toBe(id);
  expect(manifest.pipeline).toBeUndefined();
  const wasm = new WebAssembly.Module(readFileSync(join(dir, 'game.wasm')));
  expect(WebAssembly.Module.imports(wasm).every((i) => i.module === 'bgt')).toBe(true);
  expect(WebAssembly.Module.exports(wasm).map((e) => e.name)).toEqual(expect.arrayContaining(['bgt_init', 'bgt_update', 'bgt_render', 'memory']));
});
