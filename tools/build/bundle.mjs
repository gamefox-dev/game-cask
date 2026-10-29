#!/usr/bin/env node
// Static production bundle containing only selected games, for hosting.
//
//   node tools/build/bundle.mjs --game <id> [--game <id2>] [--out DIR]
//
// The first --game becomes the default page (no ?game= needed). The output has
// no test API. Ports are private by default: hosting a port publicly
// redistributes whatever it loads (e.g. original binaries); put it behind
// access control unless you hold the rights.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';

const argv = process.argv.slice(2);
const games = argv.flatMap((a, i) => (a === '--game' && argv[i + 1] ? [argv[i + 1]] : []));
const oi = argv.indexOf('--out');
const out = resolve(oi >= 0 ? argv[oi + 1] : join(ROOT, 'dist-bundle'));
if (!games.length) {
  console.error('usage: bundle.mjs --game <id> [--game <id2>] [--out DIR]');
  process.exit(1);
}
const src = join(ROOT, 'web', 'public', 'games');
for (const g of games) {
  if (!existsSync(join(src, g, 'manifest.json'))) {
    console.error(`game "${g}" is not built: run npm run build:games (or build:port) first`);
    process.exit(1);
  }
}
rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_BGT_DEFAULT_GAME: games[0], VITE_BGT_TEST: '' },
});
// vite copies every built game from publicDir; keep only the requested ones
rmSync(join(out, 'games'), { recursive: true, force: true });
rmSync(join(out, 'conformance.html'), { force: true });
mkdirSync(join(out, 'games'), { recursive: true });
const index = [];
for (const g of games) {
  cpSync(join(src, g), join(out, 'games', g), { recursive: true });
  const m = JSON.parse(readFileSync(join(src, g, 'manifest.json'), 'utf8'));
  index.push({ id: g, name: m.name, private: m.private });
}
writeFileSync(join(out, 'games', 'index.json'), JSON.stringify({ games: index }, null, 2) + '\n');
const priv = index.filter((g) => g.private).map((g) => g.id);
console.log(`bundle: ${out} (games: ${games.join(', ')}; default ${games[0]})`);
if (priv.length) console.warn(`bundle: WARNING ${priv.join(', ')} marked private — serve behind access control unless you hold the rights.`);
