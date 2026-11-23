/* global AudioNode, AudioDestinationNode, requestAnimationFrame, Performance, queueMicrotask */
// K59: performance evidence for engine-runtime pages (tests and engine:probe). Observation only: the wasm memory is
// read from what the official loader instantiates (the original instantiate/instantiateStreaming still run, so
// streaming compilation is kept), and audio is observed by fanning each node that feeds the destination into an
// extra AnalyserNode. Nothing the game hears, renders or computes changes. Production shells never install this.
import { execFileSync } from 'node:child_process';

/** Same classification as bgt/renderers/types.ts softwareRenderer (K51); a unit test keeps them equal. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|microsoft basic render|\bwarp\b/i;
export const softwareRenderer = s => !!s && SOFTWARE_RENDERER.test(s);

/** Chromium launch options for engine pages, the same conventions as K51's BGT probe/WebGL2 project. */
export const chromiumSoftwareArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const chromiumGpuArgs = [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--ignore-gpu-blocklist'];
/** BGT_WEBGL2_GPU=1 / BGT_SOFTWARE_RENDERER=1 semantics of tests/e2e/browser-options.ts; the probe defaults to the GPU. */
export const chromiumLaunch = ({ software = false } = {}) => ({ args: software ? chromiumSoftwareArgs : chromiumGpuArgs });

/**
 * K68 Q12: is one canvas sample (RGBA bytes, e.g. a downscaled readback) still a cleared screen? It is 'blank' when
 * every pixel has the same color (per channel within `tolerance`) and that color is transparent, black or one of the
 * colors the page passed to gl.clearColor; anything else (any variation, or a uniform color nobody cleared to, such as
 * a full-screen rectangle) is 'content'. Runs in the page too (serialized into the init script): no outer references.
 */
export function classifyFrameSample(data, clearColors = [], tolerance = 2) {
  if (!data || data.length < 4) return 'blank';
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  const r = data[0], g = data[1], b = data[2], a = data[3];
  for (let i = 4; i + 3 < data.length; i += 4)
    if (!near(data[i], r) || !near(data[i + 1], g) || !near(data[i + 2], b) || !near(data[i + 3], a)) return 'content';
  if (a <= tolerance || (r <= tolerance && g <= tolerance && b <= tolerance)) return 'blank';
  return clearColors.some(c => near(c[0], r) && near(c[1], g) && near(c[2], b)) ? 'blank' : 'content';
}

/**
 * K68 Q12: first frame with non-clear content (installed by installEnginePerf, in the page before any engine code).
 * Wraps WebGL draw calls (drawArrays/drawElements and their instanced/range variants, blitFramebuffer) to see which
 * rAF callbacks drew into a canvas's DEFAULT framebuffer, and samples that canvas right after such a callback, in the
 * same task (the drawing buffer is still the frame being presented). The first sample classifyFrameSample calls
 * 'content' sets firstFrameMs = performance.now() at that moment, i.e. milliseconds since navigation start (the real
 * clock, also under the frame pacer's virtual time). Observation only: every wrapper calls the original with the same
 * arguments, and all wrappers are removed once the frame is found.
 */
function firstFrameObserver(classify) {
  if (window.__ENGINE_FIRST_FRAME__) return;
  const now = () => Performance.prototype.now.call(performance);
  const state = window.__ENGINE_FIRST_FRAME__ = { schema: 'game-cask/engine-first-frame/1', firstFrameMs: null, firstDrawMs: null, loadStartMs: null,
    sinceLoadStartMs: null, drawFrames: 0, sampledFrames: 0, drawCalls: 0, sampleErrors: 0, sample: null, done: false,
    // vK68: the observer's own cost until it removes itself: readback/classification time (total, max per frame).
    overhead: { sampleMs: 0, maxSampleMs: 0, wrappedDrawCalls: 0 }, previousSampleMs: null, skippedDrawFrames: 0,
    definition: 'navigation start -> end of the first rAF callback (or other task) that drew (a draw call, not a clear) into the canvas default framebuffer AND left a sample that is not a uniform transparent/black/clearColor screen' };
  const target = new WeakMap(), clears = [], restore = [];
  let drew = new Set(), inCallback = 0, queued = false;
  const patch = (proto, name, wrap) => {
    const original = proto[name];
    if (typeof original !== 'function') return;
    proto[name] = wrap(original);
    restore.push(() => { proto[name] = original; });
  };
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype].filter(Boolean)) {
    patch(proto, 'bindFramebuffer', original => function (kind, fb) {
      if (kind === 0x8D40 || kind === 0x8CA9) target.set(this, fb); // FRAMEBUFFER, DRAW_FRAMEBUFFER
      return original.call(this, kind, fb);
    });
    patch(proto, 'clearColor', original => function (r, g, b, a) {
      const c = [r, g, b].map(x => Math.round(Math.min(1, Math.max(0, Number(x) || 0)) * 255));
      if (clears.length < 64 && !clears.some(d => d[0] === c[0] && d[1] === c[1] && d[2] === c[2])) clears.push(c);
      return original.call(this, r, g, b, a);
    });
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'blitFramebuffer'])
      patch(proto, name, original => function (...args) {
        if (!target.get(this)) {
          drew.add(this); state.drawCalls++;
          // A draw outside a rAF callback (e.g. a boot splash drawn during startup) is sampled at the end of its task.
          if (!inCallback && !queued) { queued = true; queueMicrotask(() => { queued = false; check(); }); }
        }
        return original.apply(this, args);
      });
  }
  const realRequest = window.requestAnimationFrame;
  const loadStart = () => {
    // The shell's runtime wasm request: the closest engine-path analog of BGTRuntime.load() starting.
    const wasm = performance.getEntriesByType('resource').find(e => /\.wasm(\?|$)/.test(e.name));
    return wasm ? wasm.startTime : null;
  };
  const check = () => {
    if (state.done || !drew.size) return;
    const contexts = drew; drew = new Set();
    const t = now();
    try { sample(contexts, t); } finally {
      const spent = now() - t;
      state.overhead.sampleMs += spent; state.overhead.maxSampleMs = Math.max(state.overhead.maxSampleMs, spent); state.overhead.wrappedDrawCalls = state.drawCalls;
    }
  };
  // vK68: a readback costs ~2 ms per frame on a GPU (it synchronizes with the GPU) and ~13 ms on SwiftShader, so the
  // observer samples every drawing frame only for the first 30, then every 2nd (to 60), 4th (to 120) and then every 8th
  // drawing frame. firstFrameMs is then an upper bound: the first content frame lies after previousSampleMs
  // (skippedDrawFrames drawing frames were not sampled in between). One scratch canvas is reused.
  let scratch = null, ctx = null;
  const interval = n => n <= 30 ? 1 : n <= 60 ? 2 : n <= 120 ? 4 : 8;
  let sinceSample = 0;
  const sample = (contexts, t) => {
    state.drawFrames++; state.firstDrawMs ??= t;
    if (++sinceSample < interval(state.drawFrames)) return;
    const skipped = sinceSample - 1; sinceSample = 0;
    for (const gl of contexts) {
      const canvas = gl.canvas;
      if (!canvas?.width || !canvas.height) continue;
      try {
        const w = Math.min(64, canvas.width), h = Math.max(1, Math.round(canvas.height * w / canvas.width));
        if (!scratch) { scratch = document.createElement('canvas'); ctx = scratch.getContext('2d', { willReadFrequently: true }); }
        if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; } else ctx.clearRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        state.sampledFrames++;
        if (classify(data, clears) !== 'content') { state.previousSampleMs = t; continue; }
        Object.assign(state, { firstFrameMs: t, done: true, loadStartMs: loadStart(), skippedDrawFrames: skipped, sample: { width: canvas.width, height: canvas.height, sampleWidth: w, sampleHeight: h,
          firstPixel: Array.from(data.slice(0, 4)), clearColors: clears.map(c => [...c]) } });
        if (state.loadStartMs !== null) state.sinceLoadStartMs = t - state.loadStartMs;
        for (const undo of restore.splice(0)) undo();
        if (window.requestAnimationFrame === observed) window.requestAnimationFrame = realRequest;
        return;
      } catch (e) { state.sampleErrors++; state.lastSampleError = String(e); }
    }
  };
  const observed = function requestAnimationFrame(callback) {
    if (state.done || typeof callback !== 'function') return realRequest.call(window, callback);
    return realRequest.call(window, function (time) { inCallback++; try { return callback.call(this, time); } finally { inCallback--; if (!inCallback) check(); } });
  };
  window.requestAnimationFrame = observed;
}

/** Install BEFORE navigation (installEnginePerf does): records the first non-clear frame (see firstFrameObserver). */
export async function installEngineFirstFrame(page) {
  await page.addInitScript({ content: `(${firstFrameObserver.toString()})(${classifyFrameSample.toString()});` });
}
/** The page's first-frame record (null when installEngineFirstFrame/installEnginePerf was not installed). */
export const engineFirstFrame = page => page.evaluate(() => {
  const s = window.__ENGINE_FIRST_FRAME__;
  return s ? JSON.parse(JSON.stringify(s)) : null;
});

/** Install BEFORE navigation to observe wasm memories and audio output (measureEngine works without it, with less). */
export async function installEnginePerf(page) {
  await installEngineFirstFrame(page);
  await page.addInitScript(() => {
    if (window.__ENGINE_PERF__) return;
    const state = window.__ENGINE_PERF__ = { memories: [], contexts: [], taps: [] };
    const remember = value => {
      if (value instanceof WebAssembly.Memory && !state.memories.some(r => r.deref() === value)) state.memories.push(new WeakRef(value));
    };
    const scan = (imports, result) => {
      try { for (const mod of Object.values(imports ?? {})) for (const value of Object.values(mod ?? {})) remember(value); } catch { /* observation only */ }
      try { for (const value of Object.values((result?.instance ?? result)?.exports ?? {})) remember(value); } catch { /* observation only */ }
    };
    for (const name of ['instantiate', 'instantiateStreaming']) {
      const original = WebAssembly[name];
      if (typeof original !== 'function') continue;
      WebAssembly[name] = function (source, imports, ...rest) {
        const result = original.call(this, source, imports, ...rest);
        result.then(r => scan(imports, r), () => {});
        return result;
      };
    }
    const Original = window.AudioContext ?? window.webkitAudioContext;
    if (Original) {
      const Observed = class AudioContext extends Original {
        constructor(...args) { super(...args); state.contexts.push(this); }
      };
      if (window.AudioContext) window.AudioContext = Observed;
      if (window.webkitAudioContext) window.webkitAudioContext = Observed;
    }
    if (typeof AudioNode !== 'undefined') {
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (target, ...rest) {
        const result = connect.call(this, target, ...rest);
        try {
          if (target instanceof AudioDestinationNode) {
            let tap = state.taps.find(t => t.context === this.context);
            if (!tap) {
              const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
              tap = { context: this.context, analyser, sources: 0 }; state.taps.push(tap);
            }
            connect.call(this, tap.analyser); tap.sources++;
          }
        } catch { /* observation only */ }
        return result;
      };
    }
  });
}

/** The page's WebGL renderer (from a scratch canvas: same GPU process/ANGLE backend as the game's context). */
export function engineRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    for (const type of ['webgl2', 'webgl']) {
      const gl = canvas.getContext(type);
      if (!gl) continue;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const result = { context: type, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION) };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return result;
    }
    return { context: null, renderer: null, vendor: null, version: null };
  // vK59: fail closed. An unreadable renderer cannot prove a GPU, so it counts as software (rendererUnknown says why).
  }).then(r => ({ ...r, software: r.renderer ? softwareRenderer(r.renderer) : true, rendererUnknown: !r.renderer }));
}

const metricsOf = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
async function processInfo(browserSession) {
  if (!browserSession) return null;
  try {
    const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
    return processInfo.map(p => ({ type: p.type, pid: p.id, cpuTime: p.cpuTime }));
  } catch { return null; }
}
function rssBytes(pids) {
  if (!pids.length || process.platform === 'win32') return {};
  try {
    const out = execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 5000 });
    return Object.fromEntries(out.trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(([p, r]) => p && r >= 0).map(([p, r]) => [p, r * 1024]));
  } catch { return {}; }
}
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] : null;
const round = (x, d = 3) => x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

/**
 * One measurement window of `ms` wall milliseconds on a booted engine page: RAF frame rate, main-thread CPU per
 * frame (Chromium CDP Performance.getMetrics TaskDuration/ScriptDuration), memory (JS heap, wasm memories, renderer/GPU
 * process RSS where the OS reports it), audio output presence and the renderer. Fields that a browser cannot report
 * are null with a note (WebKit has no CDP).
 */
export async function measureEngine(page, { ms = 2000, label = null } = {}) {
  if (!Number.isFinite(ms) || ms < 100 || ms > 120000) throw new Error('measureEngine: ms must be 100..120000');
  const browser = page.context().browser(), browserName = browser?.browserType().name() ?? 'unknown', notes = [];
  let session = null, browserSession = null;
  if (browserName === 'chromium') {
    session = await page.context().newCDPSession(page); await session.send('Performance.enable');
    browserSession = await browser.newBrowserCDPSession().catch(() => null);
  } else notes.push(`${browserName}: no CDP; main-thread CPU, JS heap and process figures unavailable`);
  const renderer = await engineRenderer(page);
  const [m0, p0] = session ? [await metricsOf(session), await processInfo(browserSession)] : [null, null];
  const page_ = await page.evaluate(async ms => {
    const st = window.__ENGINE_PERF__, times = [], buf = new Float32Array(2048);
    // Real browser frames even under the K59 frame pacer (which only advances the engine on step()).
    const raf = window.__ENGINE_PACER__?.realRequestAnimationFrame ?? (cb => requestAnimationFrame(cb));
    const audio0 = st ? st.contexts.map(c => c.currentTime) : null;
    let peak = 0, sumSq = 0, samples = 0;
    await new Promise(resolve => {
      let start = null;
      const tick = t => {
        times.push(t); start ??= t;
        if (st) for (const tap of st.taps) {
          tap.analyser.getFloatTimeDomainData(buf);
          for (const x of buf) { const a = Math.abs(x); if (a > peak) peak = a; sumSq += x * x; samples++; }
        }
        if (t - start >= ms) resolve(); else raf(tick);
      };
      raf(tick);
    });
    const memories = st ? st.memories.map(r => r.deref()).filter(Boolean).map(m => ({ bytes: m.buffer.byteLength, shared: typeof SharedArrayBuffer !== 'undefined' && m.buffer instanceof SharedArrayBuffer })) : null;
    const heap = performance.memory ? { usedBytes: performance.memory.usedJSHeapSize, totalBytes: performance.memory.totalJSHeapSize } : null;
    const audio = st ? { installed: true, contexts: st.contexts.map((c, i) => ({ state: c.state, sampleRate: c.sampleRate, advancedSec: c.currentTime - (audio0[i] ?? 0) })),
      destinationSources: st.taps.reduce((n, t) => n + t.sources, 0), peak, rms: samples ? Math.sqrt(sumSq / samples) : 0 } : { installed: false };
    return { times, memories, heap, audio, crossOriginIsolated: globalThis.crossOriginIsolated === true };
  }, ms);
  const [m1, p1] = session ? [await metricsOf(session), await processInfo(browserSession)] : [null, null];
  await session?.detach().catch(() => {}); await browserSession?.detach().catch(() => {});

  const t = page_.times, intervals = t.slice(1).map((x, i) => x - t[i]), sorted = [...intervals].sort((a, b) => a - b);
  const frames = intervals.length, spanMs = frames ? t[t.length - 1] - t[0] : 0;
  const window = { ms, frames, fps: spanMs ? round(frames * 1000 / spanMs, 2) : null, avgMs: frames ? round(spanMs / frames) : null,
    p50Ms: round(quantile(sorted, .5)), p95Ms: round(quantile(sorted, .95)), maxMs: round(sorted[sorted.length - 1] ?? null),
    over33Ms: intervals.filter(x => x > 33.4).length, source: 'requestAnimationFrame display cadence, NOT engine-reported frames' };
  let cpu = null;
  if (m0 && m1) {
    const d = k => (m1[k] ?? 0) - (m0[k] ?? 0), wallSec = d('Timestamp');
    const perFrame = k => frames ? round(d(k) * 1000 / frames) : null;
    cpu = { source: 'CDP Performance.getMetrics (renderer main thread)', wallMs: round(wallSec * 1000, 1),
      mainThreadMsPerFrame: perFrame('TaskDuration'), scriptMsPerFrame: perFrame('ScriptDuration'),
      layoutStyleMsPerFrame: frames ? round((d('LayoutDuration') + d('RecalcStyleDuration')) * 1000 / frames) : null,
      mainThreadBusy: wallSec > 0 ? round(d('TaskDuration') / wallSec) : null };
  }
  let processes = null;
  if (p0 && p1) {
    const pick = p1.filter(p => ['renderer', 'GPU'].includes(p.type) || p.type === 'gpu'), rss = rssBytes(pick.map(p => p.pid));
    const wallSec = cpu ? cpu.wallMs / 1000 : ms / 1000;
    processes = pick.map(p => {
      const before = p0.find(q => q.pid === p.pid), cpuSec = before ? p.cpuTime - before.cpuTime : null;
      return { type: p.type, pid: p.pid, cpuMsPerFrame: cpuSec != null && frames ? round(cpuSec * 1000 / frames) : null,
        cpuShare: cpuSec != null && wallSec ? round(cpuSec / wallSec) : null, rssBytes: rss[p.pid] ?? null };
    });
    if (p1.filter(p => p.type === 'renderer').length > 1) notes.push('several renderer processes: per-process figures include other pages');
  } else if (session) notes.push('process CPU/RSS unavailable (SystemInfo.getProcessInfo refused)');
  const heap = m1 ? { usedBytes: m1.JSHeapUsedSize ?? null, totalBytes: m1.JSHeapTotalSize ?? null } : page_.heap;
  const memory = { jsHeap: heap, wasm: page_.memories, wasmBytes: page_.memories ? page_.memories.reduce((n, m) => n + m.bytes, 0) : null, processes };
  if (!page_.memories) notes.push('installEnginePerf not installed before navigation: wasm memory and audio unobserved');
  const a = page_.audio;
  const audio = a.installed ? { contexts: a.contexts, running: a.contexts.some(c => c.state === 'running' && c.advancedSec > 0),
    destinationSources: a.destinationSources, peak: round(a.peak, 5), rms: round(a.rms, 6), present: a.peak > 1e-4,
    source: 'AnalyserNode fan-out of every node connected to the AudioContext destination' } : null;
  return { schema: 'game-cask/engine-perf/1', label, browser: browserName, crossOriginIsolated: page_.crossOriginIsolated,
    renderer, software: renderer.software, window, cpu, memory, audio, notes };
}
