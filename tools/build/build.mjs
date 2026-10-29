#!/usr/bin/env node
// Build BGT games (C -> wasm32) and their asset manifests.
//
//   node tools/build/build.mjs examples/sample2d      build one game
//   node tools/build/build.mjs --all                 every examples/* plus port/ (if it has game.json)
//   node tools/build/build.mjs --all --check         compile to a temp dir only (lint gate)
//
// Output: web/public/games/<id>/{game.wasm, manifest.json, assets/...}
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { ROOT, requireZig } from './toolchain.mjs';

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

export const LDFLAGS = ['-nostdlib', '-Wl,--no-entry', '-Wl,-z,stack-size=1048576', '-Wl,--strip-debug'];

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
  for (const key of ['id', 'name', 'sources']) {
    if (!cfg[key]) throw new Error(`${relative(ROOT, file)}: missing "${key}"`);
  }
  if (cfg.originals && !Array.isArray(cfg.originals)) throw new Error(`${relative(ROOT, file)}: "originals" must be an array`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(cfg.id)) throw new Error(`${relative(ROOT, file)}: id must match [a-z0-9-]`);
  return cfg;
}

export function buildGame(gameDirArg, { check = false, quiet = false } = {}) {
  const gameDir = resolve(ROOT, gameDirArg);
  const cfg = loadGameConfig(gameDir);
  const zig = requireZig({ quiet: true });
  const outDir = check ? mkdtempSync(join(tmpdir(), 'bgt-check-')) : join(OUT_ROOT, cfg.id);
  if (!check) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }

  const sources = cfg.sources.map((s) => join(gameDir, s));
  for (const s of sources) if (!existsSync(s)) throw new Error(`source not found: ${relative(ROOT, s)}`);
  const includes = ['bgt/include', ...(cfg.includes ?? []).map((i) => relative(ROOT, join(gameDir, i)))];
  const wasmPath = join(outDir, 'game.wasm');
  const args = [
    'cc',
    ...CFLAGS,
    ...(cfg.cflags ?? []),
    ...includes.flatMap((i) => ['-I', join(ROOT, i)]),
    ...sources,
    join(ROOT, 'bgt', 'sdk', 'bgt_libc.c'),
    ...LDFLAGS,
    ...(cfg.ldflags ?? []),
    '-o',
    wasmPath,
  ];
  try {
    execFileSync(zig.path, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  } catch {
    throw new Error(`compile failed for ${cfg.id} (zig ${zig.version})`);
  }
  const wasm = readFileSync(wasmPath);

  const assets = [];
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

  const manifest = {
    schema: 'bgt-manifest/1',
    id: cfg.id,
    name: cfg.name,
    abi: '0.1',
    private: cfg.private ?? false,
    wasm: { url: `game.wasm?h=${sha256(wasm).slice(0, 16)}`, size: wasm.byteLength, sha256: sha256(wasm) },
    assets,
    touch: cfg.touch ?? { dpad: true, buttons: ['A', 'B', 'START'] },
    input: cfg.input ?? {},
    toolchain: { zig: zig.version, cflags: [...CFLAGS, ...(cfg.cflags ?? [])] },
  };
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

export function allGameDirs() {
  const dirs = [];
  const ex = join(ROOT, 'examples');
  if (existsSync(ex)) {
    for (const name of readdirSync(ex).sort()) if (existsSync(join(ex, name, 'game.json'))) dirs.push(join('examples', name));
  }
  if (existsSync(join(ROOT, 'port', 'game.json'))) dirs.push('port');
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
  const targets = all ? allGameDirs() : argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: build.mjs <gameDir...> | --all [--check]');
    process.exit(1);
  }
  let failed = false;
  for (const t of targets) {
    try {
      buildGame(t, { check });
    } catch (e) {
      failed = true;
      console.error(`error: ${e.message}`);
    }
  }
  if (!check) writeIndex();
  process.exit(failed ? 1 : 0);
}
