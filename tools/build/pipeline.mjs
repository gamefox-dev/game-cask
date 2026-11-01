// Systematic conversion pipeline for games described by game.json "pipeline":
//
//   extract   inputs from original/ (installers/archives) with tools/extract   (cached by input hash)
//   analyze + lift   each module with tools/x86/x86tool -> C, one function per original function
//   overrides   hand-written per-function replacements in <game>/overrides (the "minimal exceptions")
//   driver    a generated BGT driver binding the platform profile to the lifted modules
//   compile   driver + lifted C + platform profile + overrides -> wasm (asyncify for blocking loops)
//
// game.json:
//   "pipeline": {
//     "platform": "win32",
//     "modules": [ { "from": "GAME.EXE", "main": true },                 original/GAME.EXE
//                  { "from": "setup.exe#CARDS.DLL", "name": "cards.dll" }, a file inside an installer
//                  { "from": "./build/hello.exe" } ],                       relative to the game dir
//     "fixture": { ... }        optional: build a module from source first (kit examples/tests)
//     "interpretOnly": false    true = oracle build: no lifting, everything runs in the interpreter
//   }
// The generated files land in node_modules/.cache/bgt/pipeline/<id>/ (never committed).
import { execFileSync } from './exec.mjs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, openSync, closeSync, fstatSync, readSync, writeSync, rmSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';
import { buildRes } from '../x86/mkres.mjs';
import { peMetadata } from '../inspect/pe.mjs';
import { coveragePlan, staticClosure, owningRanges } from './coverage.mjs';
import { streamFile, compactPe, hashFile } from './files.mjs';
import { analyzeCached, liftChunks } from './chunks.mjs';

const CACHE = join(ROOT, 'node_modules', '.cache', 'bgt');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function hostCC() {
  for (const c of [process.env.CC, 'cc', 'clang', 'gcc']) {
    if (!c) continue;
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return [c];
    } catch {}
  }
  return ['zig', 'cc'];
}

/** Build (or reuse) the native x86tool. */
export function x86tool() {
  const srcs = ['tools/x86/x86tool.c', 'platforms/x86/x86_decode.c',
    'platforms/x86/x86_decode.h', 'platforms/x86/x86.h',
    'tools/x86/lift64.h', 'tools/x86/lift64_guard.h'].map((s) => join(ROOT, s));
  const h = sha256(Buffer.concat(srcs.map((s) => readFileSync(s)))).slice(0, 16);
  const out = join(CACHE, `x86tool-${h}`);
  if (!existsSync(out)) {
    mkdirSync(CACHE, { recursive: true });
    const [cc, ...pre] = hostCC();
    execFileSync(cc, [...pre, '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', out, srcs[0], srcs[1]], { stdio: 'inherit' });
  }
  return out;
}

function zigWinInclude() {
  const env = JSON.parse(execFileSync('zig', ['env'], { encoding: 'utf8' }));
  return join(env.lib_dir, 'libc', 'include', 'any-windows-any');
}

/** Zero the COFF TimeDateStamp so fixture builds are byte-reproducible. */
function stripTimestamp(file) {
  const b = readFileSync(file);
  const nt = b.readUInt32LE(0x3c);
  b.writeUInt32LE(0, nt + 8);
  writeFileSync(file, b);
}

export function buildFixture(gameDir, fx, outDir) {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fx.out);
  // Generators are trusted, game-local source tools, never executables extracted from a PE.
  const generated = fx.generator ? join(outDir, 'generated') : null;
  const sourceNames = fx.generator
    ? JSON.parse(execFileSync(process.execPath, [join(gameDir, fx.generator), generated, ...(fx.generatorArgs ?? []).map(String)], { encoding: 'utf8', cwd: gameDir }))
    : fx.sources;
  const inputs = sourceNames.map((s) => join(generated ?? gameDir, s));
  let resFile = null;
  if (fx.resources) {
    resFile = join(outDir, basename(fx.out) + '.res');
    writeFileSync(resFile, buildRes(JSON.parse(readFileSync(join(gameDir, fx.resources), 'utf8')), join(gameDir, fx.resources, '..')));
  }
  const target = fx.target ?? 'x86-windows-gnu';
  if (!['x86-windows-gnu', 'x86_64-windows-gnu'].includes(target)) {
    throw new Error(`unsupported fixture target ${target}`);
  }
  const normal = fx.crt === true;
  const args = [
    fx.cpp ? 'c++' : 'cc', '-target', target,
    ...(target === 'x86-windows-gnu' ? ['-mcpu=i686'] : ['-funwind-tables', '-fno-lto', '-fno-emulated-tls']),
    normal ? '-O2' : '-O1', '-fno-stack-protector',
    ...(normal ? ['-s', '-Wl,--gc-sections'] : ['-nostdlib']), '-isystem', zigWinInclude(),
    ...(normal ? [] : [`-Wl,--entry,${fx.entry ?? 'entry'}`]), '-Wl,--subsystem,windows',
    ...(target === 'x86_64-windows-gnu' ? ['-Wl,--image-base,0x140000000'] : []),
    '-o', out, ...inputs, ...(resFile ? [resFile] : []), ...(fx.libs ?? []).map((l) => `-l${l}`),
  ];
  writeFileSync(join(outDir, 'fixture-build.json'), JSON.stringify({ target, normalCrt: normal, args }, null, 2));
  if (fx.generator) {
    // Zig's multi-input driver otherwise starts one clang per source, unbounded on large fixtures.
    const dir = join(outDir,'objects'); mkdirSync(dir,{recursive:true});
    const version = execFileSync('zig',['version'],{encoding:'utf8'}).trim();
    const flags = [fx.cpp ? 'c++' : 'cc','-target',target,'-O2','-fno-stack-protector','-funwind-tables','-fno-lto','-fno-emulated-tls','-isystem',zigWinInclude()];
    const headers = (root) => readdirSync(root,{withFileTypes:true}).flatMap((e)=>e.isDirectory() ? headers(join(root,e.name)) : /\.(h|inc|def)$/.test(e.name) ? [join(root,e.name)] : []);
    const headerBytes = [...new Set([...headers(generated),...headers(gameDir)])].sort().map((f)=>Buffer.concat([Buffer.from(f),readFileSync(f)]));
    const objects = inputs.map((f) => ({out:join(dir,sha256(Buffer.concat([Buffer.from(JSON.stringify([version,flags,f])),...headerBytes,readFileSync(f)]))+'.o'),args:['zig',...flags,'-c',f]}));
    const link = ['zig',...args.filter((a)=>!inputs.includes(a))];
    link.splice(link.indexOf('-o'),0,...objects.map((o)=>o.out));
    const metrics = JSON.parse(execFileSync('python3',['-I',join(ROOT,'tools/build/compile.py')],{input:JSON.stringify({objects,link,jobs:Number(process.env.BGT_BUILD_JOBS ?? 2)}),encoding:'utf8',stdio:['pipe','pipe','inherit'],cwd:gameDir}));
    writeFileSync(join(outDir,'fixture-metrics.json'),JSON.stringify(metrics));
    const keep = new Set(objects.map((o)=>o.out));
    for (const f of readdirSync(dir)) if (f !== '.locks' && !keep.has(join(dir,f))) rmSync(join(dir,f),{force:true});
  } else execFileSync('zig', args, { stdio: 'inherit', cwd: gameDir });
  stripTimestamp(out);
  return out;
}

function extractInput(input) {
  const data = readFileSync(input);
  const dir = join(CACHE, 'extract', sha256(data).slice(0, 16));
  if (!existsSync(join(dir, 'extract.json'))) {
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', ['-I', join(ROOT, 'tools/extract/extract.py'), input, dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'extract.json'), 'utf8')) };
}

/** Resolve a module "from" spec to a file on disk (+ provenance). */
function resolveModule(gameDir, spec, fixtureFiles) {
  if (spec.startsWith('./')) {
    const f = fixtureFiles[spec] ?? join(gameDir, spec);
    if (!existsSync(f)) throw new Error(`pipeline: ${spec} not found (fixture not built?)`);
    return { file: f, provenance: spec };
  }
  const [outer, inner] = spec.split('#');
  const input = resolve(ROOT, 'original', outer);
  if (!input.startsWith(resolve(ROOT, 'original'))) throw new Error(`pipeline: ${spec} escapes original/`);
  if (!existsSync(input)) throw new Error(`pipeline: original/${outer} not found. Copy your legally obtained game files into original/.`);
  if (!inner) return { file: input, provenance: `original/${outer}` };
  const { dir, manifest } = extractInput(input);
  const hit = manifest.files.find((f) => f.name.toLowerCase() === inner.toLowerCase());
  if (!hit) throw new Error(`pipeline: ${inner} not found inside original/${outer} (extracted: ${manifest.files.map((f) => f.name).join(', ')})`);
  return { file: join(dir, hit.name), provenance: `original/${outer} > ${hit.chain.slice(1).join(' > ')}` };
}

function peInfo(file) {
  const fd=openSync(file,'r');try {
    const p=peMetadata((o,n)=>{const b=Buffer.alloc(n);return b.subarray(0,readSync(fd,b,0,n,o));},fstatSync(fd).size);
    if(p.pe32plus && p.machine!=='x86-64')throw new Error('unsupported PE32+ machine');
    if(p.importErrors.length)throw new Error(p.importErrors.join('; '));
    return {mode64:p.pe32plus,base:p.pe32plus?0x01000000:Number(BigInt(p.imageBase)),size:p.imageBytes,relocs:p.directories[5][0]!==0,importDlls:p.imports};
  }finally{closeSync(fd);}
}

/** Names of the DLLs a PE32 image imports statically (import directory), in file order. */
export function peImportDlls(b) {
  const p = peMetadata((off,n) => b.subarray(off,off+n), b.length);
  if (p.importErrors.length) throw new Error(`PE imports: ${p.importErrors.join('; ')}`);
  return p.imports;
}

/** System DLLs the Win32 profile implements (platforms/win32/dlls.json); '*' entries are prefixes. */
export function profileDlls() {
  return JSON.parse(readFileSync(join(ROOT, 'platforms/win32/dlls.json'), 'utf8')).implemented.map((d) => d.toLowerCase());
}
export function isProfileDll(name, list = profileDlls()) {
  const n = name.toLowerCase();
  return list.some((d) => (d.endsWith('*') ? n.startsWith(d.slice(0, -1)) : n === d));
}

const cIdent = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const lines = (f) => readFileSync(f, 'utf8').split('\n').length;

/** Scan overrides for `X86_OVERRIDE(01002345)` definitions (8 hex digits, the original address). */
function overrides(gameDir) {
  const dir = join(gameDir, 'overrides');
  if (!existsSync(dir)) return { files: [], addrs: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.c')).sort().map((f) => join(dir, f));
  const addrs = [];
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/X86_OVERRIDE\(\s*([0-9a-fA-F]{8})\s*\)/g)) addrs.push(parseInt(m[1], 16));
  return { files, addrs };
}

/**
 * Run the pipeline for one game. Returns extra compile inputs/flags for build.mjs plus a report.
 * `outAssetsDir` receives the original module images (private build output).
 */
export function runPipeline(gameDir, cfg, outAssetsDir) {
  const p = cfg.pipeline;
  const guestWindowMiB = p.memory?.guestWindowMiB ?? 1024;
  if (!Number.isInteger(guestWindowMiB) || guestWindowMiB < 128 || guestWindowMiB > 2048) {
    throw new Error('pipeline.memory.guestWindowMiB must be an integer in 128..2048');
  }
  const recorded=cfg.slice?.coverage ?? p.coverage;
  const plan=recorded ? coveragePlan(typeof recorded==='string'?[recorded]:recorded,gameDir) : null;
  const sliceCode=new Set(), sliceRanges=[], codeRanges=[];
  let codeFunctions=0;
  if (p.platform !== 'win32') throw new Error(`pipeline: platform "${p.platform}" is not implemented (kit gap; v0.2 has win32)`);
  const work = join(CACHE, 'pipeline', cfg.id + (p.interpretOnly ? '-interp' : ''));
  mkdirSync(work, { recursive: true });
  const fixtureFiles = {};
  if (p.fixture) {
    for (const data of p.fixture.patternFiles ?? []) {
      if (!/^[a-z0-9-]+\.[a-z0-9]+$/.test(data.name) || !Number.isInteger(data.bytes) || data.bytes < 0 || data.bytes > 512*1024*1024) throw new Error('invalid CC0 pattern fixture');
      const dir=join(work,'fixture');mkdirSync(dir,{recursive:true});
      const fd=openSync(join(dir,data.name),'w');
      try {const b=Buffer.alloc(65536);for(let off=0;off<data.bytes;off+=b.length){const n=Math.min(b.length,data.bytes-off);for(let i=0;i<n;i++)b[i]=(((off+i)*(data.multiplier ?? 1)+(data.increment ?? 0))^(data.xorShift ? (off+i)>>>data.xorShift : 0))&255;writeSync(fd,b,0,n);}}finally{closeSync(fd);}
    }
    const f = buildFixture(gameDir, p.fixture, join(work, 'fixture'));
    fixtureFiles[`./build/${p.fixture.out}`] = f;
  }
  const tool = x86tool();
  const ov = overrides(gameDir);
  const mods = [], streams = [];
  let mode64=false;
  let next = 0x10000000;
  for (const m of p.modules) {
    const { file, provenance } = resolveModule(gameDir, m.from, fixtureFiles);
    const name = m.name ?? basename(m.from.split('#').pop()).toLowerCase();
    const info = peInfo(file);
    if(mods.length && info.mode64!==mode64)throw new Error('cannot mix i386 and AMD64 modules in one process');mode64=info.mode64;
    if(mode64 && p.streamModules!==false)p.streamModules=true;
    let base = info.base;
    if(mode64 && !mods.length)next=0x01000000;
    /* keep preferred bases unless they overlap an earlier module (then relocate deterministically) */
    const overlaps = (b) => mods.some((o) => b < o.base + o.size && o.base < b + info.size);
    if (overlaps(base)) {
      if (!info.relocs) throw new Error(`pipeline: ${name} overlaps another module and has no relocations`);
      while (overlaps(next)) next += 0x100000;
      base = next;
    }
    if(mode64 && base+info.size>0x04000000)throw new Error('AMD64 images exceed the configured low flat image window (16..64 MiB)');
    const asset = `${p.streamModules ? 'loader' : 'modules'}/${name}`;
    mkdirSync(join(outAssetsDir, p.streamModules ? 'loader' : 'modules'), { recursive: true });
    if (p.streamModules) {
      compactPe(file,join(outAssetsDir,asset));
      streams.push(streamFile(file,`modules/${name}`,join(outAssetsDir,'..'),p.chunkSize));
    } else cpSync(file, join(outAssetsDir, asset));
    const id = cIdent(name);
    let lifted = null, stats = null, analysis = null, chunkSources = null, scale = null;
    const identity = hashFile(file);
    let ownershipAnalysis = null;
    if(plan && p.interpretOnly) {
      const identity=plan.modules.find((m)=>m.name===name);
      if(!identity||identity.sha256!==hashFile(file)||identity.base!==base)throw new Error(`coverage identity mismatch for ${name}`);
      const an=analyzeCached(tool,file,id,base,work,identity).analysis;
      ownershipAnalysis=an;
      for(const a of staticClosure(an,plan.code))sliceCode.add(a);
    }
    if (!p.interpretOnly) {
      lifted = join(work, `lifted_${id}.c`);
      const args = ['lift', file, '--name', id, '--base', base.toString(16)];
      const measured = analyzeCached(tool,file,id,base,work,identity);
      ownershipAnalysis = measured.analysis;
      let selectedSet = null;
      if (p.flagLiveness === true) args.push('--flag-liveness','on');
      if(plan) {
        const identity=plan.modules.find((m)=>m.name===name);
        if(!identity||identity.sha256!==hashFile(file)||identity.base!==base)throw new Error(`coverage identity mismatch for ${name}; record the exact module/base again`);
        const an=measured.analysis;
        const selected=staticClosure(an,plan.code);
        selectedSet = new Set(selected);
        for(const a of selected)sliceCode.add(a);
        const list=join(work,`selected_${id}.txt`);writeFileSync(list,selected.map((a)=>a.toString(16)).join('\n')+'\n');args.push('--select',list);
      }
      if (ov.addrs.length) args.push('--skip', ov.addrs.map((a) => a.toString(16)).join(','));
      if (mode64 && p.chunkInstructions !== 0 && measured.analysis.totals.instructions > (p.chunkInstructions ?? 32768)) {
        const result = liftChunks({tool,file,id,base,work,analysis:measured.analysis,key:measured.key,
          selected:selectedSet,skip:ov.addrs,flagLiveness:p.flagLiveness,budget:p.chunkInstructions ?? 32768});
        // Remove the old monolithic intermediate after successful chunk publication.
        rmSync(lifted,{force:true});rmSync(lifted+'.stats.json',{force:true});
        chunkSources = result.sources; lifted = chunkSources[0]; stats = result.stats;
        analysis = JSON.stringify(measured.analysis);
        scale = {...result.metrics,analysis_ms:measured.analysis_ms,analysis_cached:measured.analysis_cached};
      } else {
        const key = sha256(JSON.stringify([measured.key, selectedSet ? [...selectedSet].sort((a,b)=>a-b) : null,
          ov.addrs, p.flagLiveness === true, 'monolithic-v1']));
        const metrics = JSON.parse(execFileSync('python3', ['-I', join(ROOT, 'tools/build/lift.py')], {
          input: JSON.stringify({ tasks: [{ out: lifted, key, args: [tool, ...args] }], jobs: 1 }),
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'],
        }));
        analysis = JSON.stringify(measured.analysis);
        stats = JSON.parse(readFileSync(lifted + '.stats.json', 'utf8'));
        scale = {...metrics,analysis_ms:measured.analysis_ms,analysis_cached:measured.analysis_cached,generated_c_bytes:statSync(lifted).size,chunks:1};
      }
    }
    ownershipAnalysis ??= analysis ? JSON.parse(analysis) : analyzeCached(tool,file,id,base,work,identity).analysis;
    const ranges=owningRanges(ownershipAnalysis);
    const owners=new Map(ownershipAnalysis.functions.map((f,i)=>[f.addr,codeFunctions+i]));
    codeFunctions+=owners.size;
    for(const r of ranges)codeRanges.push({...r,owner:owners.get(r.owner)});
    if(plan) {
      const selected=new Set(staticClosure(ownershipAnalysis,plan.code));
      for(const r of ranges)if(selected.has(r.owner))sliceRanges.push({addr:r.addr,end:r.end});
    }
    const totals = ownershipAnalysis.totals;
    mods.push({ name, id, asset, base, size: info.size, main: !!m.main, lifted, chunkSources, stats, scale, provenance, sha256: identity,
      functions: stats ? stats.functions : 0, discoveredFunctions: totals?.functions ?? 0, dataSeeds: totals ? totals.dataSeeds ?? 0 : 0, importDlls: info.importDlls });
  }
  if (!mods.some((m) => m.main)) mods[0].main = true;
  /* static imports must resolve to a shipped module or a DLL the profile implements (Win32 would refuse to start
     the program with "The program can't start because X.dll is missing") */
  const sysDlls = profileDlls();
  for (const m of mods) {
    const missing = m.importDlls.filter((d) => !mods.some((o) => o.name.toLowerCase() === d.toLowerCase()) && !isProfileDll(d, sysDlls));
    if (missing.length) {
      throw new Error(`pipeline: ${m.name} imports ${missing.join(', ')}, which is neither a module in game.json "pipeline.modules" nor a DLL the ${p.platform} profile implements (platforms/${p.platform}/dlls.json). If the game ships it, add it as a module; otherwise it is a kit gap (iteration request).`);
    }
  }
  codeRanges.sort((a,b)=>a.addr-b.addr);
  sliceRanges.sort((a,b)=>a.addr-b.addr);
  /* driver */
  const driver = join(work, 'pipeline_main.c');
  const ext = mods.filter((m) => m.lifted).map((m) => `extern const x86_lifted_entry_t x86_lifted_${m.id}[];`).join('\n');
  /* LANE-C: i386 continuation table size is distinct from the source function count. */
  const rows = mods.map((m) => {
    const table = m.lifted ? `x86_lifted_${m.id}` : '0';
    const count = m.lifted ? (m.stats.entries ?? m.functions) : 0;
    return `    {"${m.name}", "${m.asset}", 0x${m.base.toString(16)}u, ${table}, ${count}, ${m.main ? 1 : 0}},`;
  }).join('\n');
  writeFileSync(driver, `/* GENERATED by tools/build/pipeline.mjs for "${cfg.id}" — do not edit. */
#include "bgt.h"
#include "w32.h"
BGT_DEFINE_IO(io)
${ext}
static const w32_module_cfg_t modules[] = {
${rows}
};
static const x86_code_range_t code_ranges[] = {
${codeRanges.map((r)=>`    {${r.addr}u,${r.end}u,${r.owner}u},`).join('\n')}
};
static const char *const sys_dlls[] = {${sysDlls.map((d) => JSON.stringify(d)).join(', ')}};
static const w32_config_t config = {modules, ${mods.length}, "", ${p.width ?? 640}, ${p.height ?? 480}, sys_dlls, ${sysDlls.length}, ${mode64?1:0}};
static uint8_t async_buf[1u << 20] __attribute__((aligned(16)));
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) { (void)p; x86_register_code_ranges(code_ranges, ${codeRanges.length}, ${codeFunctions}); return w32_boot(&config, &io); }
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; w32_update(); }
BGT_EXPORT(bgt_render) void bgt_render(void) { w32_render(); }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return w32_state_hash(); }
BGT_EXPORT(bgt_metrics) uint32_t bgt_metrics(void) { return (uint32_t)(uintptr_t)w32_metrics_json(); }
BGT_EXPORT(bgt_debug_state) uint32_t bgt_debug_state(void) { return (uint32_t)(uintptr_t)w32_debug_json(); }
BGT_EXPORT(bgt_debug_peek) uint32_t bgt_debug_peek(uint32_t addr, uint32_t len) { return (uint32_t)(uintptr_t)x86_debug_peek(addr, len); }
`);
  /* lifted tables are sorted by address; the profile merges them across modules */
  const platform = [
    'platforms/x86/x86_decode.c', 'platforms/x86/x86_exec.c', 'platforms/x86/x86_rt.c',
    'platforms/x86/x86_exec64.c', 'platforms/x86/x86_simd.c', 'platforms/x86/x86_x87.c',
    /* LANE-E: additive audio/COM/input profile translation units. */
    'platforms/win32/w32_audio.c', 'platforms/win32/w32_com.c', 'platforms/win32/w32_input.c',
    'platforms/win32/w32_gl.c', /* LANE-GL */
    /* LANE-K1: shared system DLL contracts, both widths. */
    ...['avrt', 'bcrypt', 'dinput8', 'dwmapi', 'imm32', 'iphlpapi', 'shlwapi', 'ws2_32', 'wsock32']
      .map((dll) => `platforms/win32/w32_${dll}.c`),
    /* LANE-C: cooperative scheduler and shared thread APIs (both guest widths). */
    'platforms/win32/w32_x64.c', 'platforms/win32/w32_thread.c', 'platforms/x86/x86_sched.c',
    'platforms/win32/w32_core.c', 'platforms/win32/w32_kernel.c', 'platforms/win32/w32_user.c', 'platforms/win32/w32_gdi.c',
    'platforms/win32/w32_replay.c', 'platforms/win32/w32_crt.c',
    'platforms/common/font5x7.c',
  ].map((f) => join(ROOT, f));
  const liftedSources = mods.filter((m) => m.lifted).flatMap((m) => m.chunkSources ?? [m.lifted]);
  const sources = [driver, ...liftedSources, ...platform, ...ov.files];
  const generated = liftedSources.reduce((n, f) => n + lines(f), 0) + lines(driver);
  const handwritten = [...ov.files, ...(cfg.sources ?? []).map((s) => join(gameDir, s))].filter(existsSync).reduce((n, f) => n + lines(f), 0);
  const report = {
    schema: 'game-cask/pipeline/1',
    platform: p.platform,
    machine: mode64?'x86-64':'i386',
    memory: mode64 ? { guestWindowMiB, growth: 'on-demand', hostArenaMiB: 64 } : null,
    interpretOnly: !!p.interpretOnly,
    ...(plan ? {discovery:{input_recordings:plan.recordings,recorded_entries:plan.code.size}} : {}),
    ...(p.fixture ? { fixture: { normalCrt: p.fixture.crt === true,
      optimization: p.fixture.crt === true ? '-O2' : '-O1', language: p.fixture.cpp ? 'C++' : 'C' } } : {}),
    modules: mods.map((m) => ({ name: m.name, base: m.base, provenance: m.provenance, sha256: m.sha256, functions: m.functions, dataSeeds: m.dataSeeds, imports: m.importDlls, lift: m.stats, scale: m.scale })),
    exceptions: { overrides: ov.addrs.map((a) => '0x' + a.toString(16)), files: ov.files.map((f) => relative(gameDir, f)) },
    loc: { generated, handwritten },
  };
  writeFileSync(join(work, 'pipeline.json'), JSON.stringify(report, null, 2) + '\n');
  return {
    sources,
    streams,
    slicePlan: cfg.slice && plan ? {code:[...sliceCode].sort((a,b)=>a-b),codeRanges:sliceRanges,ranges:plan.ranges} : null,
    fixtureDir: p.fixture ? join(work,'fixture') : null,
    includes: ['platforms/x86', 'platforms/win32'],
    cflags: [
      ...(mode64 ? ['-DX86_FLAT_GUEST=1', `-DX86_FLAT_BYTES=${guestWindowMiB}ull*1048576ull`,
        '-D_GNU_SOURCE', '-fno-math-errno'] : []),
      '-Wno-unused-label', '-Wno-unused-but-set-variable', '-Wno-unused-variable',
    ],
    asyncify: true,
    report,
  };
}

export function pipelineSummary(r) {
  const f = r.modules.map((m) => `${m.name}: ${m.functions} fns${m.lift ? `, ${m.dataSeeds ?? 0} data seeds rejected, ${m.lift.specialized} specialized/${m.lift.generic} generic insns, ${m.lift.jumpTables} jump tables, ${m.lift.unresolvedJumps} unresolved` : ' (interpreted)'}`);
  return `pipeline ${r.platform}${r.interpretOnly ? ' [interpret-only oracle build]' : ''}: ${f.join('; ')}; generated ${r.loc.generated} LOC, hand-written ${r.loc.handwritten} LOC, ${r.exceptions.overrides.length} override(s)${r.discovery ? `; discovery input interpreted instructions: ${r.discovery.input_recordings.map((m)=>m.interp_insns ?? 'unknown').join(', ')} (re-record after building to measure remaining work)` : ''}`;
}

export { statSync };
