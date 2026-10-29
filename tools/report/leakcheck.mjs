#!/usr/bin/env node
// Private-asset leak check. Fails when anything that could be committed
// (tracked + untracked-not-ignored files, or only staged files with --staged):
//   - lives under original/ (except .gitkeep)
//   - is generated port code while port/game.json is not explicitly "private": false
//   - lives under reports/ (except .gitkeep and paths listed in reports/.publish)
//   - has a game-binary / disc-image extension
//   - is byte-identical to, or embeds a 64-byte window of, any file in original/
//   - contains a secret (private key, tokens, ...)
//   - is a binary file > 1 MiB
//
//   node tools/report/leakcheck.mjs [--staged] [--root DIR]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT as KIT_ROOT } from '../build/toolchain.mjs';
import { SECRET_PATTERNS } from './redact.mjs';

const BINARY_EXT = /\.(exe|com|dll|ovl|drv|bin|img|iso|cue|mdf|nrg|ccd|chd|rom|gba|gb|gbc|nes|sfc|smc|fig|n64|z64|v64|gen|smd|sms|gg|pce|nds|3ds|xci|nsp|wad|grp|pak|dat|arc|lib|sav|state)$/i;
const MAX_BINARY = 1024 * 1024;

function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) out.push(...walk(p, base));
    else if (st.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

function candidates(root, staged) {
  try {
    if (staged) {
      return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    }
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n');
    return [...new Set([...tracked, ...untracked].filter(Boolean))];
  } catch {
    // not a git repo: treat every file that is not ignored by our own rules as a candidate
    return walk(root).filter((p) => !p.startsWith('node_modules/') && !p.startsWith('.git/'));
  }
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function leakcheck({ root = KIT_ROOT, staged = false } = {}) {
  const problems = [];
  const files = candidates(root, staged).filter((p) => existsSync(join(root, p)));
  const origFiles = walk(join(root, 'original')).filter((p) => p !== '.gitkeep');
  const origHashes = new Map();
  const origWindows = [];
  for (const p of origFiles) {
    const b = readFileSync(join(root, 'original', p));
    origHashes.set(createHash('sha256').update(b).digest('hex'), p);
    if (b.length >= 256) for (let k = 0; k < 8; k++) origWindows.push({ p, w: b.subarray(Math.floor(((b.length - 64) * k) / 8), Math.floor(((b.length - 64) * k) / 8) + 64) });
  }
  let portPublic = false;
  try {
    portPublic = JSON.parse(readFileSync(join(root, 'port', 'game.json'), 'utf8')).private === false;
  } catch {
    portPublic = false;
  }
  const publish = existsSync(join(root, 'reports', '.publish'))
    ? readFileSync(join(root, 'reports', '.publish'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];

  for (const p of files) {
    const add = (why) => problems.push({ path: p, why });
    if (p.startsWith('original/') && p !== 'original/.gitkeep') add('file under original/ (user-supplied game files are never committed)');
    if (p.startsWith('port/') && !['port/README.md', 'port/.gitkeep'].includes(p) && !portPublic) {
      add('generated port code is private by default (set "private": false in port/game.json only if you have the rights to publish)');
    }
    if (p.startsWith('reports/') && p !== 'reports/.gitkeep' && p !== 'reports/.publish' && !publish.includes(p)) {
      add('reports/ is private by default (list reviewed, redacted files in reports/.publish to commit them)');
    }
    if (BINARY_EXT.test(p) && !p.startsWith('tests/fixtures/synthetic/')) add('game binary / disc image / save extension');
    const full = join(root, p);
    const st = statSync(full);
    if (st.size > 64 * 1024 * 1024) {
      add('file larger than 64 MiB');
      continue;
    }
    const buf = readFileSync(full);
    const h = createHash('sha256').update(buf).digest('hex');
    if (origHashes.has(h) && !p.startsWith('original/')) add(`identical to original/${origHashes.get(h)}`);
    if (!p.startsWith('original/')) {
      for (const { p: op, w } of origWindows) {
        if (buf.length >= 64 && buf.indexOf(w) >= 0) {
          add(`embeds bytes from original/${op}`);
          break;
        }
      }
    }
    if (isBinary(buf)) {
      if (buf.length > MAX_BINARY) add(`binary file over ${MAX_BINARY} bytes`);
    } else {
      const text = buf.toString('utf8');
      for (const s of SECRET_PATTERNS) if (s.re.test(text)) add(`possible ${s.name}`);
    }
    if (/(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.env.example')) add('.env file');
  }
  return { checked: files.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--root');
  const { checked, problems } = leakcheck({ root: ri >= 0 ? argv[ri + 1] : KIT_ROOT, staged: argv.includes('--staged') });
  if (problems.length) {
    console.error(`leakcheck: ${problems.length} problem(s) in ${checked} committable file(s):`);
    for (const p of problems) console.error(`  ${p.path}: ${p.why}`);
    console.error('Unstage/remove these files (git rm --cached <file>) or fix .gitignore. Never commit user game data.');
    process.exit(1);
  }
  console.log(`leakcheck: ok (${checked} committable file(s) checked)`);
}
