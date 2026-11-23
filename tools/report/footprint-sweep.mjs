#!/usr/bin/env node
// vK71 (Q131): reproducible footprint-per-MB-of-wasm sweep. Generates CC0 size variants of examples/x64-scale (the same
// generator, only the function count differs; every function runs at startup), builds them with the normal pipeline,
// then runs `footprint.mjs --sweep` over them after "scale checksum" (all functions called).
//
//   npm run bench:footprint-sweep -- [--sizes 1500,3000,6000,12000,20000] [--dir DIR] [--suspension-build jspi|dual|asyncify]
//                                    [--skip-build] [footprint options: --engine webkit --backend webgl2 --suspension jspi --out FILE]
//
// Default DIR is reports/footprint-sweep/fixtures (generated game dirs; builds land in web/public/games/x64-scale-n<N>).
// K71 numbers: `--engine chromium --suspension jspi` and `--engine webkit --suspension jspi`, both `--backend webgl2`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../build/toolchain.mjs';

export function variantConfig(base, count) {
  if (!Number.isInteger(count) || count < 8 || count > 20000) throw new Error('sizes must be integers in 8..20000 (generator limit)');
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.id = `x64-scale-n${count}`;
  cfg.name = `CC0 generated Win64 scale fixture (${count} functions, footprint sweep)`;
  cfg.pipeline.fixture.generatorArgs = [count];
  return cfg;
}

export function parseSweepArgs(argv) {
  const a = { sizes: [1500, 3000, 6000, 12000, 20000], dir: join(ROOT, 'reports', 'footprint-sweep', 'fixtures'), suspensionBuild: 'jspi', build: true, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--sizes') a.sizes = v().split(',').map(Number); else if (k === '--dir') a.dir = resolve(v());
    else if (k === '--suspension-build') a.suspensionBuild = v(); else if (k === '--skip-build') a.build = false;
    else a.rest.push(k);
  }
  if (!['jspi', 'dual', 'asyncify'].includes(a.suspensionBuild)) throw new Error('--suspension-build must be jspi, dual or asyncify');
  if (a.rest.includes('--sweep') || a.rest.includes('--game')) throw new Error('the sweep chooses the games; do not pass --sweep/--game');
  return a;
}

function main() {
  const a = parseSweepArgs(process.argv.slice(2));
  const src = join(ROOT, 'examples', 'x64-scale'), base = JSON.parse(readFileSync(join(src, 'game.json'), 'utf8'));
  const dirs = a.sizes.map((n) => {
    const d = join(a.dir, `x64-scale-n${n}`); mkdirSync(d, { recursive: true });
    copyFileSync(join(src, 'generate.mjs'), join(d, 'generate.mjs'));
    writeFileSync(join(d, 'game.json'), JSON.stringify(variantConfig(base, n), null, 2) + '\n');
    return d;
  });
  if (a.build) execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), ...dirs],
    { stdio: 'inherit', env: { ...process.env, BGT_SUSPENSION_BUILD: a.suspensionBuild } });
  const ids = a.sizes.map((n) => `x64-scale-n${n}`).join(',');
  execFileSync(process.execPath, [join(ROOT, 'tools/report/footprint.mjs'), '--sweep', ids, '--until', 'scale checksum', '--frames', '600',
    ...(a.suspensionBuild === 'jspi' && !a.rest.includes('--suspension') ? ['--suspension', 'jspi'] : []), ...a.rest], { stdio: 'inherit' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (e) { console.error(e.message ?? e); process.exit(1); }
}
