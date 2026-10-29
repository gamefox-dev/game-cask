#!/usr/bin/env node
// Browser benchmark: batched command buffer vs direct per-sprite import calls,
// across sprite counts and backends. Writes reports/bench.json and bench.md.
//   node tools/bench/bench.mjs [--backends webgl2,webgpu] [--counts 1000,10000,50000]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const backends = arg('--backends', 'webgl2,webgpu').split(',');
const counts = arg('--counts', '1000,10000,50000').split(',').map(Number);
const PORT = 5199;

const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite did not start');
}

await waitServer();
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const env = await (async () => {
  const p = await browser.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/conformance.html?backend=webgl2`);
  const info = await p.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const a = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
    return { userAgent: navigator.userAgent, webgl2Renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, webgpuAdapter: a ? a.info?.vendor + '/' + a.info?.architecture : null };
  });
  await p.close();
  return info;
})();

const results = [];
for (const backend of backends) {
  for (const n of counts) {
    for (const mode of [0, 1]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${PORT}/?game=bench&bench=1&backend=${backend}&arg0=${n}&arg1=${mode}&frames=120`);
      await page.waitForFunction(() => window.__BGT_BENCH__?.done || window.__BGT_TEST__?.failed?.(), null, { timeout: 120000 });
      const r = await page.evaluate(() => window.__BGT_BENCH__ ?? { error: 'runtime failed' });
      const got = await page.evaluate(() => window.__BGT_TEST__?.backend());
      await page.close();
      if (r.error || got !== backend) {
        results.push({ backend, sprites: n, mode: mode ? 'direct' : 'batched', error: r.error ?? `got backend ${got}` });
        continue;
      }
      results.push({ backend, sprites: n, mode: mode ? 'direct' : 'batched', ...r.result });
      console.log(`${backend} ${String(n).padStart(6)} ${mode ? 'direct ' : 'batched'}  wasmRender ${r.result.wasmRenderMs.toFixed(3)}  jsBridge ${r.result.jsBridgeMs.toFixed(3)}  gpuSubmit ${r.result.gpuSubmitMs.toFixed(3)}  update ${r.result.updateMs.toFixed(3)}  frame ${r.result.frameMsAvg.toFixed(2)} ms`);
    }
  }
}
await browser.close();
stop();

mkdirSync(join(ROOT, 'reports'), { recursive: true });
const out = { generated: new Date().toISOString(), environment: env, note: 'medians over 120 stepped frames; frameMs measured free-running (vsync-bound, headless)', results };
writeFileSync(join(ROOT, 'reports', 'bench.json'), JSON.stringify(out, null, 2) + '\n');
const rows = results.map((r) => r.error ? `| ${r.backend} | ${r.sprites} | ${r.mode} | error: ${r.error} |||||` :
  `| ${r.backend} | ${r.sprites} | ${r.mode} | ${r.wasmRenderMs.toFixed(3)} | ${r.jsBridgeMs.toFixed(3)} | ${(r.wasmRenderMs + r.jsBridgeMs).toFixed(3)} | ${r.gpuSubmitMs.toFixed(3)} | ${r.frameMsAvg.toFixed(2)} |`);
writeFileSync(join(ROOT, 'reports', 'bench.md'), [
  '# BGT benchmark', '', `Generated ${out.generated}. ${out.note}.`, '', `Environment: ${JSON.stringify(env)}`, '',
  '| backend | sprites | path | wasm render ms (direct: incl. import calls) | submit/decode ms | render total ms | GPU submit ms | frame interval ms |',
  '|---|---:|---|---:|---:|---:|---:|---:|', ...rows, ''].join('\n'));
console.log('wrote reports/bench.json, reports/bench.md');
