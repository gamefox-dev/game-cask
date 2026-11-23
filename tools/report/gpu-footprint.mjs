#!/usr/bin/env node
/* global GPUTextureUsage, GPUBufferUsage, requestAnimationFrame, devicePixelRatio */
// K74 (Q137): what the browser's GPU process holds per byte of each kind of GPU resource, measured in isolation.
// Each scenario runs in its own tagged browser (K71 ownership: only this launch's processes count) on a page with no
// runtime: create a WebGL 2 / WebGPU context on a canvas, present, then allocate one kind of resource with a known
// logical size twice (two equal steps) and present again. macOS `footprint` of the GPU process is read after each
// phase (after a settle wait). `factor` is the marginal GPU-process bytes per logical byte (step 2 - step 1), `firstExtra`
// what the first step costs beyond its logical bytes (pools the driver allocates once). Staging scenarios upload one
// texture many times (whole-image calls, or `staging-chunked`: 2 MiB row bands) and read the retained bytes right after
// and after 4 s idle. These factors back `memory().gpu.overhead` (bgt/runtime/gpu-overhead.ts).
//
//   npm run bench:gpu-footprint -- [--engine chromium|webkit] [--api webgl2,webgpu] [--scenarios a,b,...] [--repeat N]
//                                   [--mib 64] [--out FILE]
//
// Scenarios: empty (no context), canvas-960, canvas-1920, canvas-3840 (context + presents only), rgba8, rgba8-mips,
// canvas-resize (one context resized 960 -> 1920 -> 3840 -> 960: the in-page slope), rgba8-target (rendered, never uploaded), r8, rg8, rgba16f, depth24s8, depth32f, buffers, staging (one 2048x2048 RGBA8
// texture re-uploaded whole many times), staging-chunked (the same bytes in 2 MiB row bands); executor-staging /
// executor-staging-whole (WebGPU only: the kit's own WebGPUCommands executor uploading the same texture through
// TEXTURE_UPDATE_EX with its default upload bands, or with whole writes (`uploadChunkBytes: Infinity`, pre-K74); needs
// the probe server, so a built game id via --game, default x64-gl).
// Desktop numbers are evidence for the model, not the iPhone: real-device memory stays a hardware gate.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchTagged, measureFootprint, ownedProcesses, summarizeFootprint } from './footprint.mjs';

const MB = 1024 * 1024;
export const SCENARIOS = ['empty', 'canvas-960', 'canvas-1920', 'canvas-3840', 'canvas-resize', 'executor-staging', 'executor-staging-whole', 'rgba8', 'rgba8-mips', 'rgba8-target', 'r8', 'rg8',
  'rgba16f', 'depth24s8', 'depth32f', 'buffers', 'staging', 'staging-chunked'];
const PAGE = 'http://localhost:48123/bgt-gpu-footprint.html';

/** Logical bytes a scenario allocates (the denominator of its factor); 0 for context-only scenarios. */
export function scenarioPlan(name, mib = 64) {
  const bytes = mib * MB, side = 1024;
  const tex = (bpp, mips = false) => {
    const level = side * side * bpp, per = mips ? Math.round(level * 4 / 3) : level;
    return { count: Math.max(1, Math.round(bytes / per)), side, bpp, mips, perBytes: mips ? mipChainBytes(side, bpp) : level };
  };
  const canvas = /^canvas-(\d+)$/.exec(name);
  if (name === 'empty') return { kind: 'empty', logicalBytes: 0 };
  // One context, resized 960 -> 1920 -> 3840 -> 960 wide (16:9): bytes per canvas pixel from in-page differences,
  // each state the median of 3 samples (the browser's own GPU-process memory drifts by tens of MB between launches).
  if (name === 'canvas-resize') return { kind: 'canvas-resize', widths: [960, 1920, 3840, 960], logicalBytes: 0 };
  if (canvas) { const w = Number(canvas[1]); return { kind: 'canvas', width: w, height: Math.round(w * 9 / 16), logicalBytes: 0 }; }
  const t = { rgba8: tex(4), 'rgba8-mips': tex(4, true), 'rgba8-target': tex(4), r8: tex(1), rg8: tex(2), rgba16f: tex(8),
    depth24s8: tex(4), depth32f: tex(4) }[name];
  if (t) return { kind: 'texture', format: name, ...t, logicalBytes: t.count * t.perBytes };
  if (name === 'buffers') return { kind: 'buffers', count: 16, size: bytes / 16, logicalBytes: bytes };
  if (name === 'executor-staging' || name === 'executor-staging-whole') return { kind: 'executor-staging', side: 2048, uploads: 32,
    whole: name === 'executor-staging-whole', logicalBytes: 2048 * 2048 * 4 };
  if (name === 'staging' || name === 'staging-chunked') return { kind: 'staging', side: 2048, uploads: 32,
    bandRows: name === 'staging-chunked' ? 256 : 2048, logicalBytes: 2048 * 2048 * 4 };
  throw new Error(`unknown scenario ${name}`);
}

function mipChainBytes(side, bpp) { let n = 0; for (let s = side; s >= 1; s >>= 1) n += s * s * bpp; return n; }

// Runs inside the page. Keeps every object reachable from `window.__k74` so nothing is collected between phases.
async function pageSetup({ api, width, height }) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  c.style.cssText = `width:${width / devicePixelRatio}px;height:${height / devicePixelRatio}px;display:block`;
  document.body.appendChild(c);
  const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const s = window.__k74 = { api, canvas: c, keep: [], frames };
  if (api === 'webgl2') {
    const gl = c.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL 2');
    s.gl = gl;
    s.present = async (n) => { for (let i = 0; i < n; i++) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(i & 1, 0.5, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); await frames(1); } };
  } else {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const device = await adapter.requestDevice();
    const ctx = c.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
    // The runtime's configuration (bgt/renderers/webgpu/webgpu.ts).
    ctx.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    s.device = device; s.ctx = ctx;
    s.present = async (n) => {
      for (let i = 0; i < n; i++) {
        const e = device.createCommandEncoder();
        e.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: i & 1, g: 0.5, b: 0, a: 1 } }] }).end();
        device.queue.submit([e.finish()]); await frames(1);
      }
      await device.queue.onSubmittedWorkDone();
    };
  }
  await s.present(8);
  return true;
}

async function pageAllocate(plan) {
  const s = window.__k74;
  const fill = (n, half) => { const a = half ? new Uint16Array(n / 2) : new Uint8Array(n); for (let i = 0; i < a.length; i += 2048) a[i] = (i >> 11) & 255; return a; };
  if (s.api === 'webgl2') {
    const gl = s.gl;
    const fmt = { rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE], 'rgba8-mips': [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
      'rgba8-target': [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE], r8: [gl.R8, gl.RED, gl.UNSIGNED_BYTE], rg8: [gl.RG8, gl.RG, gl.UNSIGNED_BYTE],
      rgba16f: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT], depth24s8: [gl.DEPTH24_STENCIL8], depth32f: [gl.DEPTH_COMPONENT32F] };
    if (plan.kind === 'texture') {
      const [internal, format, type] = fmt[plan.format], levels = plan.mips ? Math.log2(plan.side) + 1 : 1;
      const depth = plan.format.startsWith('depth'), target = depth || plan.format === 'rgba8-target';
      const half = plan.format === 'rgba16f', data = target ? null : fill(plan.side * plan.side * plan.bpp, half);
      const fb = gl.createFramebuffer();
      for (let i = 0; i < plan.count; i++) {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, levels, internal, plan.side, plan.side);
        if (data) for (let l = 0; l < levels; l++) { const sz = plan.side >> l; gl.texSubImage2D(gl.TEXTURE_2D, l, 0, 0, sz, sz, format, type, data.subarray(0, sz * sz * plan.bpp / (half ? 2 : 1))); }
        else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          const point = plan.format === 'depth24s8' ? gl.DEPTH_STENCIL_ATTACHMENT : depth ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0;
          gl.framebufferTexture2D(gl.FRAMEBUFFER, point, gl.TEXTURE_2D, t, 0);
          if (depth) { gl.drawBuffers([gl.NONE]); gl.clearDepth(0.5); gl.clearStencil(1); gl.clear(gl.DEPTH_BUFFER_BIT | (plan.format === 'depth24s8' ? gl.STENCIL_BUFFER_BIT : 0)); }
          else { gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
          gl.framebufferTexture2D(gl.FRAMEBUFFER, point, gl.TEXTURE_2D, null, 0);
        }
        s.keep.push(t);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else if (plan.kind === 'buffers') {
      const data = fill(plan.size);
      for (let i = 0; i < plan.count; i++) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); s.keep.push(b); }
    } else if (plan.kind === 'staging') {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, plan.side, plan.side); s.keep.push(t);
      for (let i = 0; i < plan.uploads; i++) {
        const d = fill(plan.side * plan.bandRows * 4); d[0] = i;
        for (let y = 0; y < plan.side; y += plan.bandRows) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, plan.side, plan.bandRows, gl.RGBA, gl.UNSIGNED_BYTE, d);
        if (i % 4 === 3) await s.frames(1);
      }
    }
    gl.finish();
  } else {
    const d = s.device;
    const fmt = { rgba8: 'rgba8unorm', 'rgba8-mips': 'rgba8unorm', 'rgba8-target': 'rgba8unorm', r8: 'r8unorm', rg8: 'rg8unorm',
      rgba16f: 'rgba16float', depth24s8: 'depth24plus-stencil8', depth32f: 'depth32float' };
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
    if (plan.kind === 'texture') {
      const levels = plan.mips ? Math.log2(plan.side) + 1 : 1, depth = plan.format.startsWith('depth'), target = depth || plan.format === 'rgba8-target';
      const data = target ? null : fill(plan.side * plan.side * plan.bpp);
      for (let i = 0; i < plan.count; i++) {
        const t = d.createTexture({ size: [plan.side, plan.side], format: fmt[plan.format], mipLevelCount: levels, usage: depth ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING : usage });
        if (data) for (let l = 0; l < levels; l++) { const sz = plan.side >> l; d.queue.writeTexture({ texture: t, mipLevel: l }, data, { bytesPerRow: sz * plan.bpp }, [sz, sz]); }
        else {
          const e = d.createCommandEncoder();
          const view = t.createView();
          e.beginRenderPass(depth ? { colorAttachments: [], depthStencilAttachment: { view, depthClearValue: 0.5, depthLoadOp: 'clear', depthStoreOp: 'store',
            ...(plan.format === 'depth24s8' ? { stencilClearValue: 1, stencilLoadOp: 'clear', stencilStoreOp: 'store' } : {}) } }
            : { colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 } }] }).end();
          d.queue.submit([e.finish()]);
        }
        s.keep.push(t);
      }
    } else if (plan.kind === 'buffers') {
      const data = fill(plan.size);
      for (let i = 0; i < plan.count; i++) {
        const b = d.createBuffer({ size: plan.size, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.UNIFORM });
        d.queue.writeBuffer(b, 0, data); s.keep.push(b);
      }
    } else if (plan.kind === 'staging') {
      const t = d.createTexture({ size: [plan.side, plan.side], format: 'rgba8unorm', usage }); s.keep.push(t);
      for (let i = 0; i < plan.uploads; i++) {
        const x = fill(plan.side * plan.bandRows * 4); x[0] = i;
        for (let y = 0; y < plan.side; y += plan.bandRows) d.queue.writeTexture({ texture: t, origin: [0, y] }, x, { bytesPerRow: plan.side * 4 }, [plan.side, plan.bandRows]);
        if (i % 4 === 3) await s.frames(1);
      }
    }
    await d.queue.onSubmittedWorkDone();
  }
  await s.present(8);
  return true;
}

// The kit's WebGPU executor in the page (served by the probe server's Vite): one 2048x2048 RGBA8 texture uploaded
// `uploads` times through TEXTURE_UPDATE_EX, with the default upload bands or whole writes.
async function pageExecutorStaging({ path, plan }) {
  const { WebGPUCommands } = await import(/* @vite-ignore */ path);
  const device = await (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })).requestDevice();
  const errors = [], gpu = new WebGPUCommands(device, (m) => errors.push(m), null, {});
  if (plan.whole) gpu.uploadChunkBytes = Infinity;
  const screen = device.createTexture({ size: [8, 8], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  gpu.frame(screen);
  const op = (code, words, data) => { if (gpu.execute({ kind: 'gpu', op: code, words, data })) throw new Error(errors.join('; ') || `op ${code}`); };
  op(0x59 /* TEXTURE_CREATE_EX */, [1, 0, plan.side, plan.side, 1, 1, 0, 3]);
  const data = new Uint8Array(plan.side * plan.side * 4);
  for (let i = 0; i < plan.uploads; i++) {
    data[0] = i; op(0x5a /* TEXTURE_UPDATE_EX */, [1, 0, 0, 0, 0, plan.side, plan.side, 1, 0, data.length], data);
    gpu.flush?.(); if (i % 4 === 3) { await device.queue.onSubmittedWorkDone(); await new Promise((r) => requestAnimationFrame(r)); }
  }
  await device.queue.onSubmittedWorkDone();
  window.__k74 = { device, gpu, screen, present: async () => { await device.queue.onSubmittedWorkDone(); } };
  if (errors.length) throw new Error(errors.join('; '));
  return gpu.memory().uploads;
}

async function gpuSample(tag) {
  const { rows, pids } = await ownedProcesses(tag);
  const fp = await measureFootprint(pids);
  if (!fp.available) return { unavailable: fp.reason };
  const sum = summarizeFootprint(fp.processes, rows);
  const gpu = sum.processes.find((p) => p.role === 'gpu'), renderer = sum.processes.find((p) => p.role === 'renderer');
  const cats = (pid) => Object.fromEntries((fp.processes.find((p) => p.pid === pid)?.categories ?? []).filter((c) => c.dirty >= MB).map((c) => [c.name, c.dirty]));
  return { gpuBytes: gpu?.bytes ?? null, rendererBytes: renderer?.bytes ?? null, gpuCategories: gpu ? cats(gpu.pid) : {}, totalBytes: sum.totalBytes };
}

export function deltaCategories(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const d = (b?.[k] ?? 0) - (a?.[k] ?? 0);
    if (Math.abs(d) >= MB) out[k] = d;
  }
  return out;
}

async function runScenario(engine, api, name, mib, server) {
  const plan = scenarioPlan(name, mib);
  const { browser, tag } = await launchTagged(engine);
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    if (plan.kind === 'executor-staging') {
      if (api !== 'webgpu') return { scenario: name, api, engine, plan, skipped: 'WebGPU executor scenario' };
      await page.goto(new URL('games/index.json', server.url).href);
      await settle(3000);
      const samples = { page: await gpuSample(tag) };
      const uploads = await page.evaluate(pageExecutorStaging, { path: `/@fs${server.root}/bgt/renderers/webgpu/gpu.ts`, plan });
      await settle(1500); samples.step1 = await gpuSample(tag);
      await settle(4000); samples.idle = await gpuSample(tag);
      const g = (k) => samples[k]?.gpuBytes ?? null;
      return { scenario: name, api, engine, plan, samples, uploads, gpuDeltaBytes: g('step1') - g('page'),
        retainedBytes: g('step1') - g('page') - plan.logicalBytes, retainedIdleBytes: g('idle') - g('page') - plan.logicalBytes, categoryDelta: {} };
    }
    await page.route('http://localhost:48123/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><title>gpu footprint</title><body style="margin:0;background:#000">' }));
    await page.goto(PAGE);
    await settle(3000);
    const samples = { page: await gpuSample(tag) };
    // The GPU process trims startup memory a few seconds after launch: the base is the settled sample.
    if (plan.kind === 'empty') { await settle(8000); samples.settled = await gpuSample(tag);
      return { scenario: name, api, engine, plan, samples, baseBytes: samples.settled.gpuBytes, canvasPixels: null, categoryDelta: {} }; }
    if (plan.kind === 'canvas-resize') {
      const median = async () => { const v = []; for (let k = 0; k < 3; k++) { if (k) await settle(1000); v.push(await gpuSample(tag)); }
        return v.sort((a, b) => (a.gpuBytes ?? 0) - (b.gpuBytes ?? 0))[1]; };
      await page.evaluate(pageSetup, { api, width: plan.widths[0], height: plan.widths[0] * 9 / 16 });
      const states = [];
      for (const [k, w] of plan.widths.entries()) {
        if (k) await page.evaluate(async ([cw, ch]) => { const s = window.__k74; s.canvas.width = cw; s.canvas.height = ch;
          s.canvas.style.width = `${cw / devicePixelRatio}px`; s.canvas.style.height = `${ch / devicePixelRatio}px`; await s.present(8); }, [w, w * 9 / 16]);
        await settle(2000);
        states.push({ width: w, height: w * 9 / 16, sample: await median() });
      }
      const pts = states.slice(0, 3).map((x) => ({ x: x.width * x.height, y: x.sample.gpuBytes }));
      const slope = (pts[2].y - pts[0].y) / (pts[2].x - pts[0].x);
      return { scenario: name, api, engine, plan, samples: { page: samples.page, states }, canvasPixels: null,
        bytesPerCanvasPixel: slope, fixedBytes: pts[0].y - slope * pts[0].x - (samples.page.gpuBytes ?? 0),
        returnDeltaBytes: states[3].sample.gpuBytes - states[0].sample.gpuBytes, categoryDelta: {} };
    }
    if (plan.kind !== 'empty') {
      const size = plan.kind === 'canvas' ? { width: plan.width, height: plan.height } : { width: 960, height: 540 };
      await page.evaluate(pageSetup, { api, ...size });
      await settle(2000);
      samples.context = await gpuSample(tag);
      if (plan.kind === 'staging') {
        await page.evaluate(pageAllocate, plan); await settle(1500); samples.step1 = await gpuSample(tag);
        await settle(4000); await page.evaluate(() => window.__k74.present(4)); await settle(500); samples.idle = await gpuSample(tag);
      } else if (plan.kind !== 'canvas') {
        await page.evaluate(pageAllocate, plan); await settle(1500); samples.step1 = await gpuSample(tag);
        await page.evaluate(pageAllocate, plan); await settle(1500); samples.step2 = await gpuSample(tag);
      }
    }
    const g = (k) => samples[k]?.gpuBytes ?? null, diff = (a, b) => g(a) !== null && g(b) !== null ? g(b) - g(a) : null;
    const r = { scenario: name, api, engine, plan, samples, canvasPixels: plan.kind === 'canvas' ? plan.width * plan.height : null };
    if (plan.kind === 'canvas') r.gpuDeltaBytes = diff('page', 'context');
    else if (plan.kind === 'staging') {
      r.gpuDeltaBytes = diff('context', 'step1');
      r.retainedBytes = r.gpuDeltaBytes === null ? null : r.gpuDeltaBytes - plan.logicalBytes;
      r.retainedIdleBytes = diff('context', 'idle') === null ? null : diff('context', 'idle') - plan.logicalBytes;
    } else if (plan.kind !== 'empty') {
      r.gpuDeltaBytes = diff('context', 'step2');
      const marginal = diff('step1', 'step2');
      r.factor = marginal === null ? null : marginal / plan.logicalBytes;
      r.firstExtra = diff('context', 'step1') === null ? null : diff('context', 'step1') - plan.logicalBytes;
    }
    r.categoryDelta = deltaCategories(samples[plan.kind === 'canvas' ? 'page' : 'context']?.gpuCategories,
      samples.step2?.gpuCategories ?? samples.idle?.gpuCategories ?? samples.context?.gpuCategories);
    return r;
  } finally { await browser.close(); }
}

/** Median of repeats per (api, scenario). */
export function summarize(results) {
  const groups = new Map();
  for (const r of results) { const k = `${r.api}:${r.scenario}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const med = (xs) => { const v = xs.filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  return [...groups.values()].map((rs) => ({ api: rs[0].api, scenario: rs[0].scenario, runs: rs.length, logicalBytes: rs[0].plan.logicalBytes,
    gpuDeltaBytes: med(rs.map((r) => r.gpuDeltaBytes ?? null)), factor: med(rs.map((r) => r.factor ?? null)),
    firstExtra: med(rs.map((r) => r.firstExtra ?? null)), retainedBytes: med(rs.map((r) => r.retainedBytes ?? null)),
    retainedIdleBytes: med(rs.map((r) => r.retainedIdleBytes ?? null)), baseBytes: med(rs.map((r) => r.baseBytes ?? null)),
    pageGpuBytes: med(rs.map((r) => r.samples.page?.gpuBytes ?? null)),
    bytesPerCanvasPixel: rs[0].canvasPixels ? med(rs.map((r) => r.gpuDeltaBytes)) / rs[0].canvasPixels : med(rs.map((r) => r.bytesPerCanvasPixel ?? null)),
    returnDeltaBytes: med(rs.map((r) => r.returnDeltaBytes ?? null)) }));
}

function parseArgs(argv) {
  const a = { engine: 'chromium', apis: ['webgl2', 'webgpu'], scenarios: SCENARIOS, repeat: 2, mib: 64, game: 'x64-gl' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--engine') a.engine = v(); else if (k === '--api') a.apis = v().split(',');
    else if (k === '--scenarios') a.scenarios = v().split(','); else if (k === '--repeat') a.repeat = Number(v());
    else if (k === '--mib') a.mib = Number(v()); else if (k === '--out') a.out = v();
    else if (k === '--game') a.game = v(); else if (k === '--port') a.port = Number(v());
    else throw new Error(`unknown option ${k}`);
  }
  for (const s of a.scenarios) scenarioPlan(s, a.mib);
  if (!['chromium', 'webkit'].includes(a.engine)) throw new Error('--engine must be chromium or webkit');
  if (a.apis.some((x) => !['webgl2', 'webgpu'].includes(x))) throw new Error('--api takes webgl2,webgpu');
  if (!(Number.isInteger(a.repeat) && a.repeat >= 1)) throw new Error('--repeat must be a positive integer');
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const { ROOT } = await import('../build/toolchain.mjs');
  const results = [];
  let server = null;
  if (a.scenarios.some((n) => n.startsWith('executor-')) && a.apis.includes('webgpu')) {
    const { startServer } = await import('../probe/server.mjs');
    const s = await startServer(a.port ?? Number(process.env.BGT_E2E_PORT ?? 5199), a.game);
    server = { ...s, root: ROOT };
  }
  try {
  for (let rep = 0; rep < a.repeat; rep++) for (const api of a.apis) for (const name of a.scenarios) {
    if (name === 'empty' && api !== a.apis[0]) continue;
    if (name.startsWith('executor-') && api !== 'webgpu') continue;
    try {
      const r = await runScenario(a.engine, api, name, a.mib, server);
      results.push(r);
      const mb = (b) => b === null || b === undefined ? 'n/a' : `${(b / MB).toFixed(1)} MB`;
      console.log(`${a.engine}/${api} ${name} #${rep + 1}: page GPU ${mb(r.samples.page?.gpuBytes ?? null)}, delta ${mb(r.gpuDeltaBytes ?? null)}` +
        (r.factor != null ? `, marginal ${r.factor.toFixed(3)} per logical byte, first step extra ${mb(r.firstExtra)}` : '') +
        (r.baseBytes != null ? `, settled after 8 s ${mb(r.baseBytes)}` : '') +
        (r.retainedBytes != null ? `, retained beyond the texture ${mb(r.retainedBytes)}, after 4 s idle ${mb(r.retainedIdleBytes)}` : '') +
        (r.canvasPixels ? `, ${(r.gpuDeltaBytes / r.canvasPixels).toFixed(1)} B per canvas pixel` : '') +
        (r.bytesPerCanvasPixel != null && !r.canvasPixels ? `, in-page slope ${r.bytesPerCanvasPixel.toFixed(1)} B per canvas pixel, states ${r.samples.states.map((x) => `${x.width}:${mb(x.sample.gpuBytes)}`).join(' ')}` : '') +
        ` | ${Object.entries(r.categoryDelta).map(([k, v]) => `${k} ${(v / MB).toFixed(1)}`).join(', ')}`);
    } catch (e) { console.log(`${a.engine}/${api} ${name}: failed: ${String(e.message ?? e).split('\n')[0]}`); results.push({ scenario: name, api, engine: a.engine, error: String(e.message ?? e) }); }
  }
  } finally { if (server) { const { stopServer } = await import('../probe/server.mjs'); await stopServer(server.child); } }
  const ok = results.filter((r) => !r.error);
  const report = { schema: 'game-cask/gpu-footprint/1', generated: new Date().toISOString(), host: { platform: process.platform, arch: process.arch },
    engine: a.engine, mib: a.mib, summary: summarize(ok), results };
  const out = resolve(a.out ?? join(ROOT, 'reports', `gpu-footprint-${a.engine}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${out.startsWith(ROOT) ? out.slice(ROOT.length + 1) : out.split('/').pop()}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
