#!/usr/bin/env node
/* global ImageData */
// Standalone streaming replay: captured data stays in the caller's private directory.
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { startServer, stopServer } from './server.mjs';
import { ROOT } from '../build/toolchain.mjs';

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const input = opt('--input'), out = resolve(opt('--out') ?? 'reports/replay');
if (!input) throw new Error('usage: npm run probe:replay -- --input FILE.ndjson --out DIR [--port N] [--save-targets]');
let server; const browsers = [], pages = [];
const report = { schema: 'game-cask/renderer-diff/1', frames: 0, snapshots: [], firstDivergence: null, errors: [] };
mkdirSync(out, { recursive: true });
try {
  server = await startServer(Number(opt('--port') ?? 5198), 'sample2d');
  const { chromium } = await import('@playwright/test');
  // Use each backend's production probe launch settings. ANGLE/Metal may expose a
  // WebGL context without the complete CAP_GPU limits; do not silently replay there.
  for (const kind of ['webgl2', 'webgpu']) {
    const browser = await chromium.launch(kind === 'webgpu' ? { channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'] } : {});
    browsers.push(browser);
    const page = await browser.newPage(); pages.push(page);
    page.on('pageerror', error => report.errors.push(kind + ': ' + error.message));
    await page.route('**/__renderer_replay__', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto(server.url + '__renderer_replay__');
    await page.evaluate(async ({ root, kind }) => {
      const { WebGPURenderer } = await import(root + '/renderers/webgpu/webgpu.ts');
      const { WebGL2Renderer } = await import(root + '/renderers/webgl2/webgl2.ts');
      const { FrameReplay } = await import(root + '/renderers/frame-replay.ts');
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const renderer = kind === 'webgpu' ? await WebGPURenderer.create(canvas, { debug: true }) : WebGL2Renderer.create(canvas, { debug: true });
      if (!renderer || !renderer.gpu?.languages) throw new Error(kind + ' unavailable');
      window.replay = new FrameReplay(renderer);
    }, { root: '/@fs' + join(ROOT, 'bgt'), kind });
  }
  let header, ended = false, previousUpdate = -1;
  for await (const line of createInterface({ input: createReadStream(resolve(input)), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (ended) throw new Error('Records after end marker');
    if (!header) {
      if (entry.schema !== 'game-cask/renderer-recording/1' || entry.type !== 'header' || entry.fromStartup !== true || !Number.isSafeInteger(entry.targetUpdate) || entry.targetUpdate < 0) throw new Error('Unsupported/incomplete recording header');
      header = entry; continue;
    }
    if (entry.type === 'end') {
      if (entry.frames !== report.frames || entry.targetUpdate !== header.targetUpdate || previousUpdate !== header.targetUpdate) throw new Error('Invalid recording end marker');
      ended = true; continue;
    }
    if (entry.type !== 'frame' || entry.sequence !== report.frames || entry.update < previousUpdate || entry.update > header.targetUpdate) throw new Error('Missing/unordered startup frame');
    previousUpdate = entry.update;
    const inspect = entry.update === header.targetUpdate;
    const pair = await Promise.all(pages.map(page => page.evaluate(
      ({ entry, inspect }) => window.replay.draw(entry, inspect), { entry, inspect })));
    report.frames++;
    if (report.frames % 250 === 0) console.log('replay frames=' + report.frames + ' update=' + entry.update);
    if (!inspect) continue;
    const [gl, gpu] = pair;
    if (gl.length !== gpu.length) throw new Error('Snapshot count mismatch');
    for (let i = 0; i < gl.length; i++) {
      const a = gl[i], b = gpu[i];
      if (a.label !== b.label || a.format !== b.format || a.width !== b.width || a.height !== b.height) throw new Error('Snapshot identity mismatch');
      const x = Buffer.from(a.data, 'base64'), y = Buffer.from(b.data, 'base64');
      if (x.length !== y.length) throw new Error('Snapshot byte length mismatch');
      let differingBytes = 0, maxByteDelta = 0, differingPixels = 0;
      const bytesPerPixel = x.length / (a.width * a.height);
      for (let j = 0; j < x.length; j += bytesPerPixel) {
        let different = false;
        for (let k = 0; k < bytesPerPixel; k++) if (x[j+k] !== y[j+k]) {
          differingBytes++; different = true; maxByteDelta = Math.max(maxByteDelta, Math.abs(x[j+k] - y[j+k]));
        }
        if (different) differingPixels++;
      }
      const diff = { frame: entry.update, sequence: entry.sequence, label: a.label, format: a.format,
        width: a.width, height: a.height, differingPixels, differingBytes, maxByteDelta };
      report.snapshots.push(diff);
      if (differingBytes && !report.firstDivergence) report.firstDivergence = diff;
      const stem = entry.sequence + '-' + a.label.replaceAll(':', '-');
      if (args.includes('--save-targets') || a.label === 'screen') {
        writeFileSync(join(out, stem + '-webgl2.bin'), x); writeFileSync(join(out, stem + '-webgpu.bin'), y);
      }
      if (a.label === 'screen') for (const [kind, shot] of [['webgl2', a], ['webgpu', b]]) {
        const png = await pages[0].evaluate(({ shot }) => {
          const bytes = Uint8Array.from(atob(shot.data), c => c.charCodeAt(0)), cv = document.createElement('canvas');
          cv.width = shot.width; cv.height = shot.height;
          cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer), cv.width, cv.height), 0, 0);
          return cv.toDataURL('image/png').split(',')[1];
        }, { shot });
        writeFileSync(join(out, stem + '-' + kind + '.png'), Buffer.from(png, 'base64'));
      }
    }
  }
  if (!ended) throw new Error('Truncated recording: no complete end marker');
} catch (error) { report.errors.push(error.message); }
finally { await Promise.all(browsers.map(browser => browser.close())); await stopServer(server?.child); }
writeFileSync(join(out, 'diff.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ frames: report.frames, snapshots: report.snapshots.length, firstDivergence: report.firstDivergence, errors: report.errors }));
process.exitCode = report.errors.length || report.firstDivergence ? 1 : 0;
