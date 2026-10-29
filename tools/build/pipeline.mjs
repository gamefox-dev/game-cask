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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';
import { buildRes } from '../x86/mkres.mjs';

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
  const srcs = [join(ROOT, 'tools/x86/x86tool.c'), join(ROOT, 'platforms/x86/x86_decode.c'), join(ROOT, 'platforms/x86/x86_decode.h')];
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

function buildFixture(gameDir, fx, outDir) {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, fx.out);
  const inputs = fx.sources.map((s) => join(gameDir, s));
  let resFile = null;
  if (fx.resources) {
    resFile = join(outDir, basename(fx.out) + '.res');
    writeFileSync(resFile, buildRes(JSON.parse(readFileSync(join(gameDir, fx.resources), 'utf8')), join(gameDir, fx.resources, '..')));
  }
  const args = ['cc', '-target', 'x86-windows-gnu', '-mcpu=i686', '-O1', '-fno-stack-protector', '-nostdlib', '-isystem', zigWinInclude(),
    `-Wl,--entry,${fx.entry ?? 'entry'}`, '-Wl,--subsystem,windows', '-o', out, ...inputs, ...(resFile ? [resFile] : []), ...(fx.libs ?? []).map((l) => `-l${l}`)];
  execFileSync('zig', args, { stdio: 'inherit', cwd: gameDir });
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
  const b = readFileSync(file);
  const nt = b.readUInt32LE(0x3c), opt = nt + 24;
  return { base: b.readUInt32LE(opt + 28), size: b.readUInt32LE(opt + 56), relocs: b.readUInt32LE(opt + 96 + 5 * 8) !== 0 };
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
  if (p.platform !== 'win32') throw new Error(`pipeline: platform "${p.platform}" is not implemented (kit gap; v0.2 has win32)`);
  const work = join(CACHE, 'pipeline', cfg.id + (p.interpretOnly ? '-interp' : ''));
  mkdirSync(work, { recursive: true });
  const fixtureFiles = {};
  if (p.fixture) {
    const f = buildFixture(gameDir, p.fixture, join(work, 'fixture'));
    fixtureFiles[`./build/${p.fixture.out}`] = f;
  }
  const tool = p.interpretOnly ? null : x86tool();
  const ov = overrides(gameDir);
  const mods = [];
  let next = 0x10000000;
  for (const m of p.modules) {
    const { file, provenance } = resolveModule(gameDir, m.from, fixtureFiles);
    const name = m.name ?? basename(m.from.split('#').pop()).toLowerCase();
    const info = peInfo(file);
    let base = info.base;
    /* keep preferred bases unless they overlap an earlier module (then relocate deterministically) */
    const overlaps = (b) => mods.some((o) => b < o.base + o.size && o.base < b + info.size);
    if (overlaps(base)) {
      if (!info.relocs) throw new Error(`pipeline: ${name} overlaps another module and has no relocations`);
      while (overlaps(next)) next += 0x100000;
      base = next;
    }
    const asset = `modules/${name}`;
    mkdirSync(join(outAssetsDir, 'modules'), { recursive: true });
    cpSync(file, join(outAssetsDir, asset));
    const id = cIdent(name);
    let lifted = null, stats = null, analysis = null;
    if (tool) {
      lifted = join(work, `lifted_${id}.c`);
      const args = ['lift', file, '--name', id, '--base', base.toString(16), '--out', lifted];
      if (ov.addrs.length) args.push('--skip', ov.addrs.map((a) => a.toString(16)).join(','));
      analysis = execFileSync(tool, args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'inherit'] });
      writeFileSync(join(work, `analysis_${id}.json`), analysis);
      stats = JSON.parse(readFileSync(lifted + '.stats.json', 'utf8'));
    }
    mods.push({ name, id, asset, base, size: info.size, main: !!m.main, lifted, stats, provenance, sha256: sha256(readFileSync(file)),
      functions: analysis ? JSON.parse(analysis).totals.functions : 0 });
  }
  if (!mods.some((m) => m.main)) mods[0].main = true;
  /* driver */
  const driver = join(work, 'pipeline_main.c');
  const ext = mods.filter((m) => m.lifted).map((m) => `extern const x86_lifted_entry_t x86_lifted_${m.id}[];`).join('\n');
  const rows = mods.map((m) => `    {"${m.name}", "${m.asset}", 0x${m.base.toString(16)}u, ${m.lifted ? `x86_lifted_${m.id}` : '0'}, ${m.lifted ? m.functions : 0}, ${m.main ? 1 : 0}},`).join('\n');
  writeFileSync(driver, `/* GENERATED by tools/build/pipeline.mjs for "${cfg.id}" — do not edit. */
#include "bgt.h"
#include "w32.h"
BGT_DEFINE_IO(io)
${ext}
static const w32_module_cfg_t modules[] = {
${rows}
};
static const w32_config_t config = {modules, ${mods.length}, "", ${p.width ?? 640}, ${p.height ?? 480}};
static uint8_t async_buf[1u << 20] __attribute__((aligned(16)));
BGT_EXPORT(bgt_async_buffer) uint32_t bgt_async_buffer(void) { return (uint32_t)(uintptr_t)async_buf; }
BGT_EXPORT(bgt_async_buffer_size) uint32_t bgt_async_buffer_size(void) { return sizeof async_buf; }
BGT_EXPORT(bgt_init) int32_t bgt_init(uint32_t p) { (void)p; return w32_boot(&config, &io); }
BGT_EXPORT(bgt_update) void bgt_update(uint32_t dt) { (void)dt; w32_update(); }
BGT_EXPORT(bgt_render) void bgt_render(void) { w32_render(); }
BGT_EXPORT(bgt_shutdown) void bgt_shutdown(void) {}
BGT_EXPORT(bgt_state_hash) uint32_t bgt_state_hash(void) { return w32_state_hash(); }
BGT_EXPORT(bgt_metrics) uint32_t bgt_metrics(void) { return (uint32_t)(uintptr_t)w32_metrics_json(); }
BGT_EXPORT(bgt_debug_state) uint32_t bgt_debug_state(void) { return (uint32_t)(uintptr_t)w32_debug_json(); }
`);
  /* lifted tables are sorted by address; the profile merges them across modules */
  const platform = [
    'platforms/x86/x86_decode.c', 'platforms/x86/x86_exec.c', 'platforms/x86/x86_rt.c',
    'platforms/win32/w32_core.c', 'platforms/win32/w32_kernel.c', 'platforms/win32/w32_user.c', 'platforms/win32/w32_gdi.c',
    'platforms/common/font5x7.c',
  ].map((f) => join(ROOT, f));
  const sources = [driver, ...mods.filter((m) => m.lifted).map((m) => m.lifted), ...platform, ...ov.files];
  const generated = mods.filter((m) => m.lifted).reduce((n, m) => n + lines(m.lifted), 0) + lines(driver);
  const handwritten = [...ov.files, ...(cfg.sources ?? []).map((s) => join(gameDir, s))].filter(existsSync).reduce((n, f) => n + lines(f), 0);
  const report = {
    schema: 'game-cask/pipeline/1',
    platform: p.platform,
    interpretOnly: !!p.interpretOnly,
    modules: mods.map((m) => ({ name: m.name, base: m.base, provenance: m.provenance, sha256: m.sha256, functions: m.functions, lift: m.stats })),
    exceptions: { overrides: ov.addrs.map((a) => '0x' + a.toString(16)), files: ov.files.map((f) => relative(gameDir, f)) },
    loc: { generated, handwritten },
  };
  writeFileSync(join(work, 'pipeline.json'), JSON.stringify(report, null, 2) + '\n');
  return {
    sources,
    includes: ['platforms/x86', 'platforms/win32'],
    cflags: ['-Wno-unused-label', '-Wno-unused-but-set-variable', '-Wno-unused-variable'],
    asyncify: true,
    report,
  };
}

export function pipelineSummary(r) {
  const f = r.modules.map((m) => `${m.name}: ${m.functions} fns${m.lift ? `, ${m.lift.specialized} specialized/${m.lift.generic} generic insns, ${m.lift.jumpTables} jump tables, ${m.lift.unresolvedJumps} unresolved` : ' (interpreted)'}`);
  return `pipeline ${r.platform}${r.interpretOnly ? ' [interpret-only oracle build]' : ''}: ${f.join('; ')}; generated ${r.loc.generated} LOC, hand-written ${r.loc.handwritten} LOC, ${r.exceptions.overrides.length} override(s)`;
}

export { statSync };
