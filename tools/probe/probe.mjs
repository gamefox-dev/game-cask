#!/usr/bin/env node
import {searchSavestate} from './savestate-search.mjs';
// Probe mode: run an exploration script against a game's test API in headless Chromium, without writing a spec.
//
//   npm run probe -- --game <id> [--backend webgl2|webgpu] --script <file.mjs> [--out reports/probe] [--params k=v,k=v] [--port N]
//
// Starts its own Vite server on a free port (never the developer's :5173) and serves what is already built in
// web/public/games/ (run `npm run build:port` first). The script default-exports `async function (p)`; see
// .claude/skills/browser-validation/SKILL.md for the API. Artifacts (PNGs, probe.json with the log, console and
// errors) go to --out (default reports/probe/, private). Never touches kit or port test results.
import { mkdirSync, writeFileSync, appendFileSync,openSync,readSync,writeSync,closeSync,renameSync,unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { resourceSnapshot } from './resources.mjs';
import {publishCoverage} from '../build/coverage.mjs';
import { createCpuProfiler, profileRange } from './cpu-profile.mjs';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../build/toolchain.mjs';
import { startServer, stopServer, validatePort } from './server.mjs';

const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'];

function parseArgs(argv) {
  const a = { backend: 'webgl2', out: 'reports/probe', params: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--game') { a.game = v; i++; }
    else if (k === '--backend') { a.backend = v; i++; }
    else if (k === '--script') { a.script = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--port') { a.port = Number(v); i++; }
    else if (k === '--params') { for (const kv of v.split(',')) { const [x, y] = kv.split('='); if (x) a.params[x] = y ?? ''; } i++; }
    else if (k === '--record-frame') { a.recordFrame = Number(v); i++; }
    else if (k === '--cpu-profile') { a.cpuProfile = profileRange(v); i++; }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.game || !a.script) throw new Error('usage: npm run probe -- --game <id> [--backend webgl2|webgpu] --script <file.mjs> [--out DIR] [--params k=v,...] [--cpu-profile START:END] [--port N]');
  if (a.recordFrame !== undefined && (!Number.isSafeInteger(a.recordFrame) || a.recordFrame < 0)) throw new Error('--record-frame must be a nonnegative update index');
  if (!['webgl2', 'webgpu'].includes(a.backend)) throw new Error('--backend must be webgl2 or webgpu');
  return a;
}

const portFree = (port) => new Promise((res) => {
  const s = createServer();
  s.once('error', () => res(false));
  s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
});
async function freePort(start) {
  if (!Number.isInteger(start) || start < 1 || start > 65535) throw new Error('invalid BGT_PROBE_PORT');
  for (let p = start; p <= Math.min(65535, start + 49); p++) if (p !== 5173 && (await portFree(p))) return p;
  throw new Error(`no free port in ${start}..${start + 49}`);
}

/** The object handed to the script. Coordinates are logical pixels. */
export function makeProbe(page, { game, backend, out, params, log, profiler = null }) {
  let activeRead=null,readBinding;
  const rawApi = (fn, ...args) => page.evaluate(([f, a]) => window.__BGT_TEST__[f](...a), [fn, args]);
  const api = (fn, ...args) => fn === 'step' && profiler ? profiler.step(args[0],rawApi) : rawApi(fn,...args);
  const save = (name, b64) => {
    const file = join(out, name.endsWith('.png') ? name : `${name}.png`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
    log.artifacts.push(file);
    return file;
  };
  const p = {
    page,
    game,
    backend,
    params,
    async start(extra = {}) {
      const q = new URLSearchParams({ game, backend, paused: '1', ephemeral: '1', ...params, ...extra });
      await page.goto(`/?${q}`);
      await page.waitForFunction(() => { const t = window.__BGT_TEST__; return !!t && (t.ready() || t.failed()); }, null, { timeout: 30_000 });
      const d = await api('diagnostics');
      if (d.backend !== backend) log.notes.push(`requested ${backend}, got ${d.backend}: ${d.backendNotes.join('; ')}`);
      return d;
    },
    step: (n = 1) => api('step', n),
    input: (events) => api('input', events),
    async click(x, y, { buttons = 1, frames = 2 } = {}) {
      await api('input', [{ type: 'pointer', x, y, buttons }]);
      await api('step', 1);
      await api('input', [{ type: 'pointer', x, y, buttons: 0 }]);
      await api('step', frames);
    },
    async key(code, { frames = 2 } = {}) {
      await api('input', [{ type: 'key', code, down: true }]);
      await api('step', 1);
      await api('input', [{ type: 'key', code, down: false }]);
      await api('step', frames);
    },
    diagnostics: () => api('diagnostics'),
    metrics: async () => (await api('diagnostics')).metrics,
    async profileWindow() {
      const before=(await api('diagnostics')).metrics;
      const reset=await api('profileReset');
      if(!reset)throw new Error('module has no resettable census export');
      return before;
    },
    debugState: () => api('debugState'),
    stateHash: () => api('stateHash'),
    /** Browser-local JSHandle: snapshots never cross Playwright's lossy JSON boundary. Dispose when finished. */
    snapshot: () => page.evaluateHandle(() => window.__BGT_TEST__.snapshot()),
    restore: snapshot => page.evaluate(s => window.__BGT_TEST__.restore(s), snapshot),
    async exportSnapshot(snapshot, file, options = {}) {
      const path=resolve(out,file),partial=path+'.partial';let fd,reader;
      try {
        fd=openSync(partial,'w');
        reader=await snapshot.evaluateHandle((s,options)=>({reader:window.__BGT_TEST__.exportSnapshot(s,options).getReader(),pending:null,at:0}),options);
        for(;;){
          // Playwright's JSON transport has no binary channel. Base64 is bounded to 1 MiB,
          // coalescing tiny sparse-page records without ever serializing the snapshot itself.
          const encoded=await reader.evaluate(async s=>{
            const out=new Uint8Array(1024*1024);let n=0;
            while(n<out.length){if(!s.pending){const p=await s.reader.read();if(p.done)break;s.pending=p.value;s.at=0;}
              const count=Math.min(out.length-n,s.pending.length-s.at);out.set(s.pending.subarray(s.at,s.at+count),n);n+=count;s.at+=count;
              if(s.at===s.pending.length)s.pending=null;
            }
            if(!n)return null;let text='';for(let i=0;i<n;i+=32768)text+=String.fromCharCode(...out.subarray(i,Math.min(i+32768,n)));return btoa(text);
          });
          if(encoded===null)break;const bytes=Buffer.from(encoded,'base64');let at=0;
          while(at<bytes.length)at+=writeSync(fd,bytes,at,bytes.length-at);
        }
        closeSync(fd);fd=undefined;renameSync(partial,path);log.artifacts.push(path);return path;
      }catch(e){if(fd!==undefined)closeSync(fd);try{unlinkSync(partial);}catch{}throw e;}
      finally{if(reader){await reader.evaluate(s=>s.reader.cancel()).catch(()=>{});await reader.dispose();}}
    },
    async importSnapshot(file) {
      if(activeRead!==null)throw new Error('Concurrent probe snapshot imports are unsupported');
      activeRead=openSync(resolve(out,file),'r');
      try {
        readBinding??=page.exposeFunction('__BGT_PROBE_READ_STATE__',()=>{
          if(activeRead===null)throw new Error('Snapshot file is closed');const bytes=Buffer.allocUnsafe(1024*1024),n=readSync(activeRead,bytes);
          return n?bytes.subarray(0,n).toString('base64'):null;
        });await readBinding;
        return await page.evaluateHandle(()=>window.__BGT_TEST__.importSnapshot(new globalThis.ReadableStream({async pull(c){
          const s=await window.__BGT_PROBE_READ_STATE__();if(s===null){c.close();return;}const raw=atob(s);c.enqueue(Uint8Array.from(raw,ch=>ch.charCodeAt(0)));
        }})));
      }finally{closeSync(activeRead);activeRead=null;}
    },
    compactJournal:()=>api('compactJournal'),
    journalStats:()=>api('journalStats'),
    /** Try a timing/input variant per branch. Always restore, even when scoring/capture throws. */
    search: (snapshot,options) => searchSavestate(p,snapshot,options),
    readPixels: () => api('readPixels'),
    /** read-only guest memory as a Buffer (null if unmapped) */
    async peek(addr, len) {
      const { peekBytes } = await import(pathToFileURL(join(ROOT, 'tests/support/evidence.ts')).href);
      return peekBytes(page, addr, len);
    },
    /** [r, g, b, a] of the presented logical pixel (x, y) */
    async pixel(x, y) {
      return page.evaluate(async ([lx, ly]) => {
        const t = window.__BGT_TEST__, d = t.diagnostics(), px = await t.readPixels();
        const s = d.letterbox.w / d.logical.width;
        const o = (Math.floor(d.letterbox.y + (ly + 0.5) * s) * px.width + Math.floor(d.letterbox.x + (lx + 0.5) * s)) * 4;
        const bin = atob(px.base64);
        return [0, 1, 2, 3].map((k) => bin.charCodeAt(o + k));
      }, [x, y]);
    },
    async screenshot(name) {
      const b64 = await page.evaluate(async () => {
        const blob = await window.__BGT_TEST__.screenshot();
        const u = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(s);
      });
      return save(name, b64);
    },
    /** nearest-neighbour zoom of a logical rectangle */
    async crop(name, rect, zoom = 8) {
      const b64 = await page.evaluate(async ([r, z]) => {
        const t = window.__BGT_TEST__, d = t.diagnostics(), px = await t.readPixels();
        const s = d.letterbox.w / d.logical.width, bin = atob(px.base64);
        const cv = document.createElement('canvas');
        cv.width = r.w * z; cv.height = r.h * z;
        const c2 = cv.getContext('2d');
        for (let y = 0; y < r.h; y++)
          for (let x = 0; x < r.w; x++) {
            const o = (Math.floor(d.letterbox.y + (r.y + y + 0.5) * s) * px.width + Math.floor(d.letterbox.x + (r.x + x + 0.5) * s)) * 4;
            c2.fillStyle = `rgb(${bin.charCodeAt(o)},${bin.charCodeAt(o + 1)},${bin.charCodeAt(o + 2)})`;
            c2.fillRect(x * z, y * z, z, z);
          }
        return cv.toDataURL('image/png').split(',')[1];
      }, [rect, zoom]);
      return save(name, b64);
    },
    async tour(opts = {}) {
      const { runTour } = await import(pathToFileURL(join(ROOT, 'tests/support/tour.ts')).href);
      const index = await runTour(page, { game, backend, outDir: join(out, 'tour'), params, ...opts });
      log.artifacts.push(join(opts.outDir ?? join(out, 'tour'), 'index.json'));
      return index;
    },
    log(...args) {
      const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      log.lines.push(line);
      console.log(`probe: ${line}`);
    },
  };
  return p;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let server, browser, profiler, page, code = 0;
  const log = { lines: [], console: [], errors: [], artifacts: [], notes: [] };
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
    const out = resolve(ROOT, a.out);
    log.resources={start:resourceSnapshot()};
    mkdirSync(out, { recursive: true });
    const script = await import(pathToFileURL(resolve(a.script)).href);
    if (typeof script.default !== 'function') throw new Error(`${a.script} must default-export async function (p)`);
    const port = a.port ?? (await freePort(Number(process.env.BGT_E2E_PORT ?? process.env.BGT_PROBE_PORT ?? 5189)));
    validatePort(port);
    server = await startServer(port, a.game);
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch(a.backend === 'webgpu' ? { channel: 'chromium', args: WEBGPU_ARGS } : {});
    const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 960, height: 540 } });
    page = await ctx.newPage();
    let recordingEnded = false, recordingSequence = 0;
    if (a.recordFrame !== undefined) {
      const file = join(out, 'frame-recording.ndjson');
      writeFileSync(file, JSON.stringify({ schema: 'game-cask/renderer-recording/1', type: 'header',
        fromStartup: true, targetUpdate: a.recordFrame }) + '\n');
      log.artifacts.push(file);
      await page.exposeBinding('__BGT_RECORD_FRAME__', (_source, frame) => {
        if (recordingEnded) return false;
        if (frame.update > a.recordFrame) throw new Error('Recorder skipped target update');
        appendFileSync(file, JSON.stringify({ ...frame, sequence: recordingSequence++ }) + '\n');
        if (frame.update === a.recordFrame) {
          appendFileSync(file, JSON.stringify({ type: 'end', frames: recordingSequence, targetUpdate: a.recordFrame }) + '\n');
          recordingEnded = true;
        }
        return !recordingEnded;
      });
    }
    page.on('console', (m) => log.console.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => log.errors.push(e.message));
    const api = (fn, ...args) => page.evaluate(([f, x]) => window.__BGT_TEST__[f](...x), [fn, args]);
    profiler = a.cpuProfile ? await createCpuProfiler(page, a.cpuProfile, out, log) : null;
    const p = makeProbe(page, { game: a.game, backend: a.backend, out, params: a.params, log, profiler });
    await p.start();
    await script.default(p);
    if (a.recordFrame !== undefined && !recordingEnded) throw new Error('Recording incomplete: script did not render target update');
    if(profiler) { await profiler.finish((await api('diagnostics')).frame);profiler=null; }
    const coverage=await page.evaluate(() => window.__BGT_TEST__?.coverage?.());
    if(coverage){const file=join(out,'coverage.json');writeFileSync(file,JSON.stringify(coverage,null,2)+'\n');log.artifacts.push(file);}
    const d = await p.diagnostics().catch(() => null);
    if (d?.errors?.length) log.errors.push(...d.errors.map((e) => `${e.kind}: ${e.message}`));
    log.execution_summary=d?.metrics?.execution_summary ?? null;
    if(log.execution_summary){
      const s=log.execution_summary,fmt=n=>n==null?'unknown':Number(n).toFixed(2);
      if(s.instructions)console.log(`probe: retirement ${s.instructions.status}; ${fmt(s.instructions.instructions_per_guest_frame)} instructions/guest frame; ${fmt(s.instructions.executing_instructions_per_second)} instructions/active-wall-second; ${s.instructions.threads?.length ?? "unavailable"} guest threads; frame snapshots dropped ${s.instructions.frames?.dropped ?? "unavailable"}`);
      console.log(`probe: ${s.suspension ?? d?.suspension ?? 'unknown'}; ${fmt(s.updates_per_second)} updates/s; ${fmt(s.guest_frames?.per_second)} guest presents/s, guest avg/p95 ${fmt(s.guest_frames?.frame_ms_avg)}/${fmt(s.guest_frames?.frame_ms_p95)} ms; interpreter ${fmt(s.interpreter.estimated_ms_per_update)} ms/update (${fmt(s.interpreter.estimated_share==null?null:s.interpreter.estimated_share*100)}% measured exclusive), ${fmt(s.interpreter.instructions_per_update)} insns/update`);
    }
    if(coverage && !log.errors.length){const evidence=publishCoverage(ROOT,coverage);if(evidence)log.artifacts.push(evidence);}
  } catch (e) {
    log.errors.push(`probe: ${e.message}`);
    console.error(`probe: ${e.message}`);
    code = 1;
  } finally {
    if(log.resources)log.resources.end=resourceSnapshot();
    if(profiler)await profiler.finish(await page.evaluate(()=>window.__BGT_TEST__?.diagnostics().frame ?? 0).catch(()=>0)).catch(e=>log.errors.push(`CPU profile: ${e.message}`));
    await browser?.close().catch(() => {});
    await stopServer(server?.child);
  }
  if (a) {
    const out = resolve(ROOT, a.out);
    writeFileSync(join(out, 'probe.json'), JSON.stringify({ schema: 'game-cask/probe/1', game: a.game, backend: a.backend, script: a.script, when: new Date().toISOString(), ...log }, null, 2) + '\n');
    console.log(`probe: ${log.artifacts.length} artifact(s), ${log.errors.length} error(s) -> ${join(a.out, 'probe.json')}`);
  }
  process.exit(code);
}
