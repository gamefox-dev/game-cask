#!/usr/bin/env node
// Build BGT games (C -> wasm32) and their asset manifests.
//
//   node tools/build/build.mjs examples/sample2d      build one game
//   node tools/build/build.mjs --all                 every examples/* plus port/ (if it has game.json)
//   node tools/build/build.mjs --examples            every examples/* only (kit suites: never touch port/)
//   node tools/build/build.mjs --examples --check    compile to a temp dir only (lint gate)
//
// Output: web/public/games/<id>/{game.wasm, manifest.json, assets/...}
import { execFileSync, withBuildWriters } from './exec.mjs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { ROOT, requireZig } from './toolchain.mjs';
import { runPipeline, pipelineSummary } from './pipeline.mjs';
import { streamFile } from './files.mjs';
import { libcNotices } from './libc-notices.mjs';
import { leaseCache, pruneCache, touchCache } from './cache.mjs';
import { buildLock } from './lock.mjs';
import { cacheDirectory, hermeticTimeFlags, prepareObjects } from './objects.mjs';
import { selectExampleDirs } from './test-examples.mjs';
import { functionNames, stripDwarf, encodeFunctionNames } from './wasm-names.mjs';
import { buildEngine, validateConfig as validateEngineConfig } from '../engine/framework.mjs';

const OUT_ROOT = join(ROOT, 'web', 'public', 'games');

export const CFLAGS = [
  '--target=wasm32-freestanding',
  '-std=c11',
  '-O2',
  '-g0',
  '-ffreestanding',
  '-fno-stack-protector',
  '-mbulk-memory',
  '-mnontrapping-fptoint',
  '-msign-ext',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-Wno-unused-function',
];

/* the features CFLAGS enable; zig's output does not declare them, binaryen must be told */
export const WASM_OPT_FEATURES = ['--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals'];

export const LDFLAGS = ['-nostdlib', '-Wl,--no-entry', '-Wl,-z,stack-size=1048576', '-Wl,--strip-debug'];

// Complete post-link identity: thresholds/local passes live in asyncify.mjs; both
// binary and name parsers can change partition assembly or exact native exclusions.
export function asyncifyCacheKey(wasm, {profileNames=false,asyncifyRemove=[],asyncifyPartitionBytes=null,root=ROOT}={}) {
  return sha256(Buffer.concat([wasm,Buffer.from(JSON.stringify(WASM_OPT_FEATURES)),
    ...['node_modules/binaryen/bin/wasm-opt','tools/build/asyncify.mjs','tools/build/binaryen-runner.mjs','tools/build/wasm-sections.mjs','tools/build/wasm-names.mjs','tools/build/command.py','tools/build/node-args.mjs'].map(p=>readFileSync(join(root,p))),
    Buffer.from(JSON.stringify({version:'bounded-asyncify/v1',profileNames,asyncifyRemove,asyncifyPartitionBytes}))]));
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function loadGameConfig(gameDir) {
  const file = join(gameDir, 'game.json');
  if (!existsSync(file)) throw new Error(`${relative(ROOT, gameDir)}: missing game.json`);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  if (cfg.engineProfile) validateEngineConfig(cfg);
  for (const key of cfg.pipeline || cfg.engineProfile ? ['id', 'name'] : ['id', 'name', 'sources']) {
    if (!cfg[key]) throw new Error(`${relative(ROOT, file)}: missing "${key}"`);
  }
  if (cfg.originals && !Array.isArray(cfg.originals)) throw new Error(`${relative(ROOT, file)}: "originals" must be an array`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.id)) throw new Error(`${relative(ROOT, file)}: id must match [a-z0-9-]`);
  return cfg;
}

export function buildGame(gameDirArg, options = {}) {
  const cfg=loadGameConfig(resolve(ROOT,gameDirArg));
  const release=buildLock(join(ROOT,'node_modules/.cache/bgt/locks'),cfg.id+(options.interpretOnly?'-interp':''));
  try {return withBuildWriters(release.token,()=>buildGameUnlocked(gameDirArg,options));} finally {release();}
}

function buildGameUnlocked(gameDirArg, { check = false, quiet = false, interpretOnly = false, outRoot = OUT_ROOT, sliceCoverage = null, selection = null, onLinkedWasm = null, asyncifyPartitionBytes = null } = {}) {
  if (asyncifyPartitionBytes !== null && (!Number.isInteger(asyncifyPartitionBytes) || asyncifyPartitionBytes < 1024 || asyncifyPartitionBytes > 16 * 1048576))
    throw new Error('asyncifyPartitionBytes must be null or an integer in 1024..16777216');
  const buildStarted = performance.now();
  const gameDir = resolve(ROOT, gameDirArg);
  const cfg = loadGameConfig(gameDir);
  if (cfg.engineProfile) {
    if (interpretOnly || sliceCoverage || selection || onLinkedWasm || asyncifyPartitionBytes !== null) throw new Error('BGT-only build options are unsupported for engineProfile');
    return buildEngine(gameDir, cfg, { ...(outRoot === OUT_ROOT ? {} : { outRoot }), check, quiet });
  }
  cfg.coverageGameId=cfg.id;
  if(selection!==null){if(!cfg.pipeline)throw new Error("--selection needs a pipeline game");cfg.pipeline.selection=selection;}
  for (const value of [cfg.pipeline?.jspi, cfg.jspi])
    if (value !== undefined && typeof value !== 'boolean') throw new Error('pipeline.jspi/jspi must be boolean');
  if (cfg.suspension !== undefined && !['asyncify','jspi-preferred'].includes(cfg.suspension)) throw new Error('suspension must be asyncify or jspi-preferred');
  const suspensionBuild = cfg.pipeline?.suspensionBuild ?? cfg.suspensionBuild ?? process.env.BGT_SUSPENSION_BUILD ?? ((cfg.pipeline?.jspi ?? cfg.jspi ?? (process.env.BGT_JSPI === '1')) || cfg.suspension === 'jspi-preferred' ? 'dual' : 'asyncify');
  if (!['asyncify', 'dual', 'jspi'].includes(suspensionBuild)) throw new Error('suspensionBuild/BGT_SUSPENSION_BUILD must be asyncify, dual or jspi');
  if (cfg.suspension === 'jspi-preferred' && suspensionBuild === 'asyncify') throw new Error('jspi-preferred needs suspensionBuild dual or jspi');
  if (cfg.suspension === 'asyncify' && suspensionBuild === 'jspi') throw new Error('asyncify preference cannot use a JSPI-only build');
  const emitJspi = suspensionBuild === 'dual';
  const jspiOnly = suspensionBuild === 'jspi';
  // Measurement/debug override; 0 preserves the old monolithic orchestration.
  if (cfg.pipeline && process.env.BGT_CHUNK_INSNS !== undefined) cfg.pipeline.chunkInstructions=Number(process.env.BGT_CHUNK_INSNS);
  if(cfg.pipeline?.chunkInstructions !== undefined && cfg.pipeline.chunkInstructions !== 0 &&
    (!Number.isInteger(cfg.pipeline.chunkInstructions) || cfg.pipeline.chunkInstructions<256 || cfg.pipeline.chunkInstructions>1000000)) throw new Error('chunkInstructions must be 0 (monolithic) or 256..1000000');
  if(sliceCoverage)cfg.slice={...(cfg.slice ?? {}),coverage:sliceCoverage};
  if(cfg.slice && cfg.pipeline)cfg.pipeline.streamModules=true;
  if (interpretOnly) {
    /* differential-oracle build: same game, nothing lifted, everything interpreted */
    if (!cfg.pipeline) throw new Error(`${cfg.id}: --interpret-only needs a pipeline game`);
    cfg.pipeline = { ...cfg.pipeline, interpretOnly: true };
    cfg.id = `${cfg.id}-interp`;
  }
  const zig = requireZig({ quiet: true });
  const outDir = check ? mkdtempSync(join(tmpdir(), 'bgt-check-')) : join(outRoot, cfg.id);
  const sources = (cfg.sources ?? []).map((s) => join(gameDir, s));
  for (const s of sources) if (!existsSync(s)) throw new Error(`source not found: ${relative(ROOT, s)}`);
  const includes = ['bgt/include', ...(cfg.includes ?? []).map((i) => relative(ROOT, join(gameDir, i)))];
  let pipe = null;
  // Selection can reject legacy/stale evidence. Prepare privately before deleting
  // the previous manifest/assets: the recommended identity-adoption command needs them.
  const prepared=cfg.pipeline?mkdtempSync(join(tmpdir(),'bgt-pipeline-prepare-')):null;
  try {
    if (cfg.pipeline) {
      mkdirSync(join(prepared, 'assets'), { recursive: true });
      pipe = runPipeline(gameDir, cfg, join(prepared, 'assets'));
      sources.push(...pipe.sources);
      includes.push(...pipe.includes);
      cfg.cflags = [...(cfg.cflags ?? []), ...pipe.cflags];
      cfg.asyncify = true;
      if (!quiet) console.log(pipelineSummary(pipe.report));
    }
    if (!check) {
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
    }
    if(prepared)cpSync(prepared,outDir,{recursive:true});
  } finally { if(prepared)rmSync(prepared,{recursive:true,force:true}); }
  const wasmPath = join(outDir, 'game.wasm');
  // Only the AMD64 CRT bridge links toolchain musl. Other BGT builds remain freestanding.
  // LANE-K3: shared x87 uses the same musl libm on i386 and AMD64.
  // Native BGT examples retain their freestanding build.
  const withCrt = !!pipe;
  const compileBase = CFLAGS.map((f) => withCrt && f === '--target=wasm32-freestanding'
    ? '--target=wasm32-wasi' : f);
  const profileNames=process.env.BGT_PROFILE_NAMES === '1';
  // Only generated AMD64 register-local regions return before any operation that can suspend.
  // i386 and hand-written overrides retain the conservative Asyncify call graph.
  const asyncifyRestricted=pipe?.report.machine==='x86-64' && process.env.BGT_ASYNCIFY_FULL !== '1';
  let asyncifyRemove=[];
  const linkFlags=LDFLAGS.filter(f=>!(profileNames || pipe) || f!=='-Wl,--strip-debug');
  const linkBase = withCrt
    ? ['-mexec-model=reactor', ...linkFlags.filter((f) => f !== '-nostdlib')] : linkFlags;
  const libcSources = withCrt ? [] : [join(ROOT, 'bgt/sdk/bgt_libc.c')];
  const args = [
    'cc',
    ...CFLAGS,
    ...(cfg.cflags ?? []),
    ...includes.flatMap((i) => ['-I', join(ROOT, i)]),
    ...sources,
    join(ROOT, 'bgt', 'sdk', 'bgt_libc.c'),
    ...linkFlags,
    ...(cfg.ldflags ?? []),
    ...hermeticTimeFlags(),
    '-o',
    wasmPath,
  ];
  let compileMetrics;
  try {
    if (cfg.pipeline) {
      // Actual preprocessor dependencies keep lifted objects independent of profile headers.
      const cache = cacheDirectory('objects'); mkdirSync(cache, { recursive: true });
      const compileFlags = [...compileBase, ...(cfg.cflags ?? []), ...includes.flatMap((i) => ['-I',join(ROOT,i)])];
      const allSources = [...sources, ...libcSources];
      const objects = prepareObjects({ sources: allSources, flags: compileFlags, includes: includes.map((i) => join(ROOT, i)), compiler: zig, cache });
      const link = [zig.path, 'cc', ...compileBase, ...objects.map((o) => o.out),
        ...linkBase, ...(cfg.ldflags ?? []), '-o', wasmPath];
      const budget = Number(process.env.BGT_CACHE_MAX_MB ?? 512)*1048576;
      const release = leaseCache(cache,objects.map((o)=>o.out));
      try {
        pruneCache(cache,budget);
        compileMetrics = JSON.parse(execFileSync('python3',['-I',join(ROOT,'tools/build/compile.py')],{ phase: 'compile/link', cwd: ROOT, input:JSON.stringify({objects,link,jobs:process.env.BGT_BUILD_JOBS}), encoding:'utf8',stdio:['pipe','pipe','inherit'] }));
        touchCache(objects.map((o)=>o.out));
      } finally {release();}
      compileMetrics.object_cache = pruneCache(cache,budget);
    } else execFileSync(zig.path, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (cause) {
    throw new Error(`compile failed for ${cfg.id} (zig ${zig.version}): ${cause.message}`, { cause });
  }
  // Keep symbol names needed by Asyncify without shipping toolchain libc DWARF.
  // wasm-ld --strip-debug removes both, so strip only DWARF custom sections here.
  if(pipe)writeFileSync(wasmPath,stripDwarf(readFileSync(wasmPath)));
  const preAsyncifyBytes=statSync(wasmPath).size;
  const jspiStarted = performance.now();
  let jspiArtifact = null;
  if (emitJspi) {
    // Same compiled/linked program, without whole-module Asyncify. No alternate guest semantics.
    const bytes = readFileSync(wasmPath), hash = sha256(bytes);
    cpSync(wasmPath, join(outDir, 'game.jspi.wasm'));
    jspiArtifact = { url: 'game.jspi.wasm?h=' + hash.slice(0, 16), size: bytes.length, sha256: hash };
  }
  const jspiMs = performance.now() - jspiStarted;
  const linkedMs = performance.now() - buildStarted;
  if(onLinkedWasm)onLinkedWasm(wasmPath);
  let asyncifyCached = false;
  const asyncifyStarted = performance.now();
  const profileMap=[];
  if (cfg.asyncify && !jspiOnly) {
    if(asyncifyRestricted && !pipe.report.interpretOnly) {
      const names=new Set(functionNames(readFileSync(wasmPath)).map(f=>f.name));
      // K13 F_* wrappers drive cross-owner chaining and may suspend in an API thunk.
      // Only generated N_* native steps return before host work and remain safe to exclude.
      asyncifyRemove=pipe.nativeLiftSymbols.filter(n=>n.startsWith('N_') && names.has(n));
      // Steps can all be inlined; an empty intersection is legal, never broaden to F_*.
      // Exact lists cross process boundaries through private response files (command.py).
    }
    // v0.2: let blocking loops suspend in bgt_yield (see bgt/abi/ABI.md). Only functions that can
    // reach bgt.yield are instrumented; indirect calls are assumed to possibly reach it.
    const wasmOpt = join(ROOT, 'node_modules', 'binaryen', 'bin', 'wasm-opt');
    if (!existsSync(wasmOpt)) throw new Error('asyncify needs binaryen: run npm ci');
    const postHash=asyncifyCacheKey(readFileSync(wasmPath),{profileNames,asyncifyRemove,asyncifyPartitionBytes});
    const postDir=cacheDirectory('asyncify');mkdirSync(postDir,{recursive:true});const cached=join(postDir,postHash+'.wasm');
    const releasePost = leaseCache(postDir,[cached]);
    try {
      // The same atomic per-key writer protocol is used for objects and whole-module
      // Asyncify. Competing clones wait and then reuse the winner, not duplicate it.
      const post = JSON.parse(execFileSync('python3', ['-I', join(ROOT, 'tools/build/compile.py')], {
        phase: 'wasm-opt', cwd: ROOT, input: JSON.stringify({ objects: [{ out: cached, ...(profileNames ? {stdout:cached+'.names'} : {}), args: [process.execPath, join(ROOT,'tools/build/asyncify.mjs'), wasmPath,
          ...WASM_OPT_FEATURES, '-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
          ...(asyncifyPartitionBytes === null ? [] : ['--bgt-partition-bytes='+asyncifyPartitionBytes]),
          ...(asyncifyRemove.length ? [`--pass-arg=asyncify-removelist@${asyncifyRemove.join(',')}`] : []),
          ...(profileNames ? ['--print-function-map'] : [])] }], jobs: 1 }),
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'],
      }));
      asyncifyCached = post.objects_cached === 1;
      cpSync(cached, wasmPath);
      if(profileNames) {
        for(const line of readFileSync(cached+'.names','utf8').split('\n')) {
          const m=/^(\d+):(.*)$/.exec(line);if(m)profileMap.push({index:Number(m[1]),name:m[2]});
        }
        if(!profileMap.length)throw new Error('wasm-opt emitted no final function map');
        const names=encodeFunctionNames(profileMap);
        writeFileSync(wasmPath,Buffer.concat([readFileSync(wasmPath),names]));
        writeFileSync(join(outDir,'profile-map.json'),JSON.stringify({schema:'game-cask/wasm-functions/1',functions:profileMap})+'\n');
      }
    } catch (error) {
      throw new Error(`Asyncify failed for ${cfg.id} (${preAsyncifyBytes} linked bytes; bounded Binaryen wasm32 transform). See Binaryen diagnostic above. A single function >16 MiB or incompatible partition index spaces cannot be partitioned; split generated functions or use suspensionBuild: "jspi" (requires browser JSPI, no Asyncify fallback). Cause: ${error.message}`);
    } finally { releasePost(); }
    touchCache([cached,...(profileNames?[cached+'.names']:[])]);
    pruneCache(postDir,Number(process.env.BGT_CACHE_MAX_MB ?? 512)*1048576);
  }
  const asyncifyMs = performance.now()-asyncifyStarted;
  if (withCrt) writeFileSync(join(outDir, 'CRT-NOTICES.txt'), libcNotices(zig.path));
  const wasm = readFileSync(wasmPath);

  const assets = [];
  const streams = [...(pipe?.streams ?? [])];
  for (const file of cfg.streams ?? []) {
    const src=file.from.startsWith('./build/') && pipe?.fixtureDir ? join(pipe.fixtureDir,file.from.slice(8)) : resolve(gameDir,file.from);
    const orig=resolve(ROOT,'original');
    if(!src.startsWith(gameDir+sep)&&!src.startsWith(orig+sep)&&!(pipe?.fixtureDir && src.startsWith(pipe.fixtureDir+sep)))throw new Error('stream source must be game-local or in original/');
    if(streams.some((s)=>s.path===file.path))throw new Error('duplicate streamed path');
    streams.push(streamFile(src,file.path,outDir,file.chunkSize));
  }
  if (pipe) {
    for (const file of walk(join(outDir, 'assets'))) {
      const rel = relative(join(outDir, 'assets'), file).split(sep).join('/');
      const data = readFileSync(file);
      const hash = sha256(data);
      assets.push({ path: rel, size: data.byteLength, sha256: hash, url: `assets/${rel}?h=${hash.slice(0, 16)}`, original: true });
    }
  }
  if (cfg.assets) {
    const assetRoot = join(gameDir, cfg.assets);
    if (!existsSync(assetRoot)) throw new Error(`assets dir not found: ${relative(ROOT, assetRoot)}`);
    for (const file of walk(assetRoot)) {
      const rel = relative(assetRoot, file).split(sep).join('/');
      const data = readFileSync(file);
      const hash = sha256(data);
      if (!check) cpSync(file, join(outDir, 'assets', ...rel.split('/')));
      assets.push({ path: rel, size: data.byteLength, sha256: hash, url: `assets/${rel}?h=${hash.slice(0, 16)}` });
    }
  }

  // Files taken verbatim from the user's original/ at build time (e.g. a code image
  // for selective emulation). They land only in the git-ignored build output.
  for (const o of cfg.originals ?? []) {
    const from = typeof o === 'string' ? o : o.from;
    const to = (typeof o === 'string' ? o : (o.to ?? o.from)).split(sep).join('/');
    const src = resolve(ROOT, 'original', from);
    if (!src.startsWith(resolve(ROOT, 'original') + sep)) throw new Error(`originals: "${from}" escapes original/`);
    if (!existsSync(src)) throw new Error(`originals: original/${from} not found. Copy your legally obtained game files into original/.`);
    const data = readFileSync(src);
    const hash = sha256(data);
    if (typeof o === 'object' && o.sha256 && o.sha256.toLowerCase() !== hash) {
      throw new Error(`originals: original/${from} sha256 ${hash} does not match game.json (${o.sha256})`);
    }
    if (assets.some((a) => a.path === to)) throw new Error(`originals: asset path "${to}" already exists`);
    if (!check) {
      mkdirSync(join(outDir, 'assets', ...to.split('/').slice(0, -1)), { recursive: true });
      cpSync(src, join(outDir, 'assets', ...to.split('/')));
    }
    assets.push({ path: to, size: data.byteLength, sha256: hash, url: `assets/${to}?h=${hash.slice(0, 16)}`, original: true });
  }

  // Win32 directory enumeration uses the same asset/stream inventory as the browser VFS.
  // This generated index is private build output, never a copy of a trial import measurement.
  if (pipe) {
    const files = new Map();
    for (const f of [...assets, ...streams]) {
      if (f.path.startsWith('loader/')) continue;
      const path = f.path.startsWith('modules/') ? f.path.slice(8) : f.path;
      if (/[\t\r\n]/.test(path)) throw new Error('Win32 file name contains an index delimiter');
      files.set(path, f.size);
    }
    const data = Buffer.from([...files].sort(([a], [b]) => a.localeCompare(b))
      .map(([path, size]) => `${size}\t${path}\n`).join(''));
    const hash = sha256(data), path = 'bgt-file-index.txt';
    writeFileSync(join(outDir, 'assets', path), data);
    assets.push({ path, size: data.length, sha256: hash, url: `assets/${path}?h=${hash.slice(0,16)}` });
  }

  let slice = null;
  if(pipe?.slicePlan) {
    const kept=new Set();let total=0,included=0;
    for(const file of streams)for(const c of file.chunks) {
      total+=c.size;
      const covered=pipe.slicePlan.ranges.some((r)=>r.path===file.path&&r.offset<c.offset+c.size&&c.offset<r.offset+r.length);
      if(covered){kept.add(c.url);included+=c.size;}else c.missing=true;
    }
    for(const file of streams)for(const c of file.chunks)if(c.missing&&!kept.has(c.url))rmSync(join(outDir,c.url),{force:true});
    slice={code:pipe.slicePlan.code,codeRanges:pipe.slicePlan.codeRanges,data:true,originalChunkBytes:total,fileChunkBytes:included};
  }
  const payloads=walk(outDir).filter((f)=>!f.endsWith('manifest.json'));
  const packaging={download_bytes_raw:0,download_bytes_gzip:0,wasm_bytes:wasm.length,file_chunk_bytes:0};
  for(const f of payloads){const b=readFileSync(f);packaging.download_bytes_raw+=b.length;packaging.download_bytes_gzip+=gzipSync(b).length;if(f.includes(`${sep}chunks${sep}`))packaging.file_chunk_bytes+=b.length;}
  const manifest = {
    schema: 'bgt-manifest/1',
    id: cfg.id,
    name: cfg.name,
    abi: '0.3',
    private: cfg.private ?? false,
    wasm: { url: `game.wasm?h=${sha256(wasm).slice(0, 16)}`, size: wasm.byteLength, sha256: sha256(wasm) },
    assets,
    ...(jspiArtifact ? { variants: { jspi: jspiArtifact } } : {}),
    ...(jspiOnly ? { suspension: 'jspi' } : {}),
    ...(cfg.suspension === 'jspi-preferred' ? { preferredSuspension: 'jspi' } : {}),
    ...(pipe?.report.memory ? { memory: pipe.report.memory } : {}),
    ...(cfg.gpu ? { gpu: cfg.gpu } : {}),
    packaging,
    ...(slice ? {slice} : {}),
    ...(streams.length ? {streams} : {}),
    touch: cfg.touch ?? { dpad: true, buttons: ['A', 'B', 'START'] },
    input: cfg.input ?? {},
    toolchain: { zig: zig.version, cflags: [...compileBase, ...(cfg.cflags ?? [])], asyncify: !!cfg.asyncify && !jspiOnly },
  };
  if (pipe) {
    manifest.pipeline = pipe.report;
    const instructions = pipe.report.modules.reduce((n,m) => n+(m.lift ? m.lift.specialized+m.lift.generic : 0),0);
    manifest.pipeline.metrics = { ...compileMetrics, phase_timings: {
      analysis_ms: pipe.report.timings?.analysis_ms ?? 0, lift_ms: pipe.report.timings?.lift_ms ?? 0,
      c_generation_cpu_ms: pipe.report.timings?.c_generation_cpu_ms ?? 0, compile_ms: compileMetrics?.compile_ms ?? 0,
      link_ms: compileMetrics?.link_ms ?? 0, wasm_opt_ms: asyncifyMs },
      ...(jspiArtifact ? { jspi_bytes: jspiArtifact.size, jspi_emit_ms: jspiMs, jspi_ready_ms: linkedMs } : {}),
      phase_timing_scope: 'phase wall times except C generation: summed child CPU, nested within lift (which reanalyzes); not additive',
      asyncify_cached:asyncifyCached, asyncify_ms:asyncifyMs, asyncify_mode:jspiOnly?'none-jspi-only':asyncifyRestricted?'amd64-native-boundaries':'conservative', asyncify_remove_count:asyncifyRemove.length, asyncify_remove_sha256:sha256(Buffer.from(asyncifyRemove.join(','))), pre_asyncify_bytes:preAsyncifyBytes, build_ms: Math.round((performance.now()-buildStarted)*1000)/1000,
      wasm_bytes: wasm.length, lifted_insns: instructions, wasm_bytes_per_insn: instructions ? wasm.length/instructions : null,
      wasm_bytes_per_insn_scope:'total module including profile/asyncify; not marginal lifted-code cost' };
    if (!quiet) console.log(`scale: ${instructions} lifted insns, ${wasm.length} wasm bytes (${instructions ? (wasm.length/instructions).toFixed(2) : 'n/a'} B/insn total), build ${manifest.pipeline.metrics.build_ms} ms, peak child RSS ${compileMetrics?.peak_child_rss_bytes ?? 'unknown'} B; objects ${compileMetrics.objects_compiled} compiled/${compileMetrics.objects_cached} cached/${compileMetrics.objects_uncacheable} uncacheable, compile ${compileMetrics.compile_ms} ms, link ${compileMetrics.link_ms} ms, phases analysis wall/lift wall/Cgen CPU ${pipe.report.timings?.analysis_ms?.toFixed(1) ?? 0}/${pipe.report.timings?.lift_ms?.toFixed(1) ?? 0}/${pipe.report.timings?.c_generation_cpu_ms?.toFixed(1) ?? 0} ms, wasm-opt ${asyncifyMs.toFixed(1)} ms (${asyncifyCached ? 'cached' : 'cold'}), cache misses ${compileMetrics.object_cache_decisions?.filter((o) => !o.hit).length ?? compileMetrics.objects_compiled}`);
  }
  if (check) {
    rmSync(outDir, { recursive: true, force: true });
  } else {
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  if (!quiet) {
    console.log(
      `${check ? 'checked' : 'built'} ${cfg.id}: game.wasm ${wasm.byteLength} B, ${assets.length} asset(s)` +
        (check ? '' : ` -> ${relative(ROOT, outDir)}`),
    );
  }
  return manifest;
}

export function allGameDirs({ includePort = true } = {}) {
  const dirs = [];
  const ex = join(ROOT, 'examples');
  if (existsSync(ex)) {
    for (const name of readdirSync(ex).sort()) if (existsSync(join(ex, name, 'game.json'))) dirs.push(join('examples', name));
  }
  if (includePort && existsSync(join(ROOT, 'port', 'game.json'))) dirs.push('port');
  return dirs;
}

function writeIndex() {
  mkdirSync(OUT_ROOT, { recursive: true });
  const games = [];
  for (const id of readdirSync(OUT_ROOT).sort()) {
    const m = join(OUT_ROOT, id, 'manifest.json');
    if (existsSync(m)) {
      const { name, private: priv } = JSON.parse(readFileSync(m, 'utf8'));
      games.push({ id, name, private: priv });
    }
  }
  writeFileSync(join(OUT_ROOT, 'index.json'), JSON.stringify({ games }, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const all = argv.includes('--all');
  const examples = argv.includes('--examples');
  const interpretOnly = argv.includes('--interpret-only');
  const mi=argv.indexOf('--selection');
  const selection=mi>=0?argv[mi+1]:null;
  if(mi>=0 && !['all','coverage'].includes(selection))throw new Error('--selection needs all or coverage');
  if(mi>=0)argv.splice(mi,2);
  const si=argv.indexOf('--slice');
  const sliceCoverage=si>=0?argv.slice(si+1).flatMap((s)=>s.split(',')):null;
  if(si>=0&&!sliceCoverage.length)throw new Error('--slice needs coverage file(s), last on the command line');
  const targets = all || examples ? selectExampleDirs(allGameDirs({ includePort: all }), { check }) : (si>=0?argv.slice(0,si):argv).filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: build.mjs <gameDir...> | --all | --examples [--check]');
    process.exit(1);
  }
  let failed = false;
  for (const t of targets) {
    try {
      buildGame(t, { check, interpretOnly, selection, sliceCoverage: sliceCoverage?.map((p)=>relative(resolve(ROOT,t),resolve(ROOT,p))) });
    } catch (e) {
      failed = true;
      console.error(`error: ${e.message}`);
    }
  }
  if (!check) writeIndex();
  process.exit(failed ? 1 : 0);
}
