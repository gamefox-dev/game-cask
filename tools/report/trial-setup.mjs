#!/usr/bin/env node
// Operator command, not a porter command. No original code is executed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';

export function setupTrial({ kit, game, dir, slice, install = true, source = ROOT }) {
  if (!kit || !game || !dir) throw new Error('usage: trial:setup --kit COMMIT --game FILE --dir NEW_PATH [--slice TEXT]');
  const dest = resolve(dir), input = realpathSync(game), src = realpathSync(source);
  if (!lstatSync(input).isFile()) throw new Error('--game must be a regular file');
  if (dest === src || dest.startsWith(src + sep)) throw new Error('--dir must be outside the source clone');
  if (existsSync(dest)) throw new Error('--dir already exists; refusing to overwrite a trial');
  const git = (args, cwd = src) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git(['rev-parse', '--verify', `${kit}^{commit}`]);
  mkdirSync(dirname(dest), { recursive: true });
  // No shared object store/hardlinks, no remote remains. Clone refs then check out the exact immutable commit.
  git(['clone', '--no-local', '--no-checkout', src, dest]);
  git(['remote', 'remove', 'origin'], dest);
  git(['checkout', '--detach', commit], dest);
  if (install) execFileSync('npm', ['ci'], { cwd: dest, stdio: 'inherit' });
  mkdirSync(join(dest, 'original'), { recursive: true });
  copyFileSync(input, join(dest, 'original', basename(input)));
  const slug = basename(dest).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64).replace(/^-+/, '') || 'trial';
  const scratch = `${dest}-scratch`;
  if (existsSync(scratch)) throw new Error(`scratch already exists: ${scratch}`);
  execFileSync(process.execPath, [join(dest, 'tools/report/trial-brief.mjs'), '--game', basename(input), '--slug', slug, '--scratch', scratch, ...(slice ? ['--slice', slice] : [])], { cwd: dest, stdio: 'inherit' });
  writeFileSync(join(dest, 'reports/setup.json'), JSON.stringify({ schema: 'game-cask/trial-setup/1', kit: commit, slice: slice ?? null, remote: false }, null, 2) + '\n');
  return { dir: dest, scratch, commit };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const a = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--kit', '--game', '--dir', '--slice'].includes(argv[i]) || !argv[i + 1]) throw new Error(`invalid argument ${argv[i]}`);
      a[argv[i].slice(2)] = argv[i + 1];
    }
    console.log(setupTrial(a));
  } catch (e) { console.error(`trial:setup: ${e.message}`); process.exitCode = 1; }
}
