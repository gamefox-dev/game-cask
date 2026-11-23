// SPDX-License-Identifier: CC0-1.0
// K64: packaging metrics math, serving classification and precompression.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
// @ts-expect-error untyped kit tool module
import { artifactSizes, browserLaunch, classifyServing, compressedSizes, displayPath, kindOf, precompress, summarizeArtifacts } from '../../tools/report/package-metrics.mjs';

describe('package metrics', () => {
  it('classifies artifacts by kind', () => {
    expect(['game.wasm', 'game.jspi.wasm', 'index-abc.js', 'chunks/0001.bin', 'assets/level.dat', 'assets/x.json', 'manifest.json', 'game.pck', 'blob']
      .map(kindOf)).toEqual(['wasm', 'wasm', 'js', 'data', 'data', 'meta', 'meta', 'data', 'data']);
  });
  it('sums kinds and totals with ratios; largest file first', () => {
    const s = summarizeArtifacts([
      { path: 'a.wasm', kind: 'wasm', raw: 100, gzip: 40, brotli: 30 },
      { path: 'b.wasm', kind: 'wasm', raw: 300, gzip: 100, brotli: 90 },
      { path: 'm.json', kind: 'meta', raw: 50, gzip: 20, brotli: 10 }]);
    expect(s.kinds.wasm).toEqual({ files: 2, raw: 400, gzip: 140, brotli: 120, gzipRatio: 0.35, brotliRatio: 0.3 });
    expect(s.total).toMatchObject({ files: 3, raw: 450, gzip: 160, brotli: 130 });
    expect(s.files.map((f: { path: string }) => f.path)).toEqual(['b.wasm', 'a.wasm', 'm.json']);
    expect(summarizeArtifacts([]).total).toMatchObject({ raw: 0, gzipRatio: null, brotliRatio: null });
  });
  it('measures real gzip/brotli sizes', () => {
    const bytes = Buffer.alloc(64 * 1024, 'abcd');
    const s = compressedSizes(bytes, { gzip: 6, brotli: 5 });
    expect(s.raw).toBe(65536);
    expect(s.gzip).toBeLessThan(1024); expect(s.brotli).toBeLessThan(1024);
  });
  it('display paths are repo-relative inside the root and a basename outside it', () => {
    expect(displayPath('/r/web/public/games/x', '/r')).toBe('web/public/games/x');
    expect(displayPath('/elsewhere/bundle', '/r')).toBe('bundle');
    expect(displayPath('/r', '/r')).toBe('r');
  });
  it('serving: MIME decides streaming compilation, Content-Encoding decides compression', () => {
    expect(classifyServing({ 'content-type': 'application/wasm', 'content-encoding': 'br', 'content-length': '10' })).toMatchObject({
      streamingCompile: true, compressed: true, contentLength: 10, advice: [] });
    const bad = classifyServing({ 'content-type': 'application/octet-stream' });
    expect(bad).toMatchObject({ streamingCompile: false, compressed: false, contentLength: null, crossOriginIsolated: false });
    expect(bad.advice).toHaveLength(2);
    expect(classifyServing({ 'content-type': 'application/wasm; charset=binary', 'content-encoding': 'identity',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' })).toMatchObject({
      streamingCompile: true, compressed: false, crossOriginIsolated: true });
  });
  it('artifact sizes skip existing precompressed files; precompress writes decodable smaller copies only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'k64-pm-'));
    try {
      mkdirSync(join(dir, 'chunks'));
      writeFileSync(join(dir, 'game.wasm'), Buffer.alloc(8192, 'wasm'));
      writeFileSync(join(dir, 'chunks', 'r.bin'), randomBytes(4096));
      writeFileSync(join(dir, 'tiny.json'), '{}');
      const written = precompress(dir, { brotli: 5, gzip: 6 });
      expect(written.map((w: { path: string }) => w.path).sort()).toEqual(['game.wasm.br', 'game.wasm.gz']);
      expect(brotliDecompressSync(readFileSync(join(dir, 'game.wasm.br')))).toEqual(readFileSync(join(dir, 'game.wasm')));
      expect(gunzipSync(readFileSync(join(dir, 'game.wasm.gz')))).toEqual(readFileSync(join(dir, 'game.wasm')));
      expect(existsSync(join(dir, 'chunks', 'r.bin.br'))).toBe(false); // incompressible: no copy
      const a = artifactSizes(dir, { brotli: 5, gzip: 6 });
      // vK64: the report never carries a local absolute path (outside the repo: basename only).
      const text = JSON.stringify(a);
      expect(text).not.toContain(dir); expect(text).not.toContain(tmpdir());
      expect(a.dir).toBe(dir.split('/').pop());
      expect(JSON.stringify(artifactSizes(dir, { brotli: 5, gzip: 6 }, tmpdir()))).not.toMatch(/"\//);
      expect(a.total.files).toBe(3);
      expect(a.kinds.wasm.raw).toBe(8192);
      expect(a.kinds.data.raw).toBe(4096);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  // K70 (Q130). Breakage caught: --browser --backend webgl2 launching Chromium without GPU args (SwiftShader numbers
  // reported as GPU load metrics) or diverging from the chromium-webgl2 project's launch.
  it('launches WebGL2 like the chromium-webgl2 project (BGT_WEBGL2_GPU=1 = native GPU)', async () => {
    // @ts-expect-error plain ESM launch conventions
    const { webgl2Launch, webglGpuArgs } = await import('../../tools/build/browser-launch.mjs');
    const gpu = browserLaunch('webgl2', { BGT_WEBGL2_GPU: '1' });
    expect(gpu).toEqual({ options: { args: webglGpuArgs }, launch: 'gpu' });
    expect(gpu.options.args).toContain('--ignore-gpu-blocklist');
    if (process.platform === 'darwin') expect(gpu.options.args).toContain('--use-angle=metal');
    expect(gpu.options.args).toEqual(webgl2Launch({ BGT_WEBGL2_GPU: '1' }).launchOptions.args);
    expect(browserLaunch('webgl2', {})).toEqual({ options: { args: [] }, launch: 'default' });
    expect(browserLaunch('webgl2', { BGT_WEBGL2_GPU: '1', BGT_SOFTWARE_RENDERER: '1' }).launch).toBe('software');
    const webgpu = browserLaunch('webgpu', {});
    expect(webgpu.options.channel).toBe('chromium'); expect(webgpu.options.args).toContain('--enable-unsafe-webgpu');
  });
});
