#!/usr/bin/env node
// npm run trial:brief -- --game <file-in-original> --slug <slug> [--resume] [--scratch DIR]
// Fills docs/trial-brief.md, writes reports/brief.md and prints it. The brief carries everything a porting agent
// needs beyond the kit docs (independence rules, user policies, the work-queue contract, the final-reply format),
// so a trial is reproducible from the kit alone. `npm run trial:record` stores it in reports/trial.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';

export function section(text, name) {
  const m = text.match(new RegExp(`<!-- ${name}:BEGIN -->\\n([\\s\\S]*?)<!-- ${name}:END -->`));
  if (!m) throw new Error(`docs/trial-brief.md: missing ${name} markers`);
  return m[1];
}

/** Fill the template. Pure: no file system access (tests use it directly). */
export function fillBrief(template, { game, slug, sha256, kit, date, scratch, resume }) {
  const vars = { GAME: game, SLUG: slug, SHA256: sha256, KIT: kit, DATE: date, SCRATCH: scratch, RESUME: resume ? '\n' + section(template, 'RESUME') : '' };
  const out = section(template, 'BRIEF').replace(/\{\{([A-Z0-9]+)\}\}/g, (all, k) => {
    if (!(k in vars)) throw new Error(`docs/trial-brief.md: unknown placeholder ${all}`);
    return vars[k];
  });
  return out.replace(/\n{3,}/g, '\n\n');
}

function parseArgs(argv) {
  const a = { resume: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--game') a.game = argv[++i];
    else if (argv[i] === '--slug') a.slug = argv[++i];
    else if (argv[i] === '--scratch') a.scratch = argv[++i];
    else if (argv[i] === '--resume') a.resume = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const a = parseArgs(process.argv.slice(2));
    if (!a.game || !a.slug) throw new Error('usage: npm run trial:brief -- --game <file-in-original> --slug <slug> [--resume] [--scratch DIR]');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.slug)) throw new Error('--slug must match [a-z0-9-]');
    const origRoot = resolve(ROOT, 'original');
    const gameFile = resolve(origRoot, a.game);
    if (!gameFile.startsWith(origRoot + sep)) throw new Error(`--game must name a file inside original/ (got ${a.game})`);
    if (!existsSync(gameFile) || !statSync(gameFile).isFile()) throw new Error(`original/${a.game} not found`);
    let scratch = a.scratch ? resolve(a.scratch) : mkdtempSync(join(tmpdir(), `game-cask-${a.slug}-`));
    if (a.scratch) {
      if (scratch === ROOT || scratch.startsWith(ROOT + sep)) throw new Error('--scratch must be outside the repository');
      if (existsSync(scratch) && readdirSync(scratch).length) throw new Error(`--scratch ${scratch} is not empty: a trial needs a fresh scratch directory`);
      mkdirSync(scratch, { recursive: true });
    }
    let kit = 'unknown';
    try {
      const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain', '--', 'bgt', 'platforms', 'tools', 'tests', 'web', 'docs', 'CLAUDE.md', '.claude'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      kit = head + (dirty ? ' (with uncommitted kit changes)' : '');
    } catch {}
    const brief = fillBrief(readFileSync(join(ROOT, 'docs', 'trial-brief.md'), 'utf8'), {
      game: a.game.split(sep).join('/'),
      slug: a.slug,
      sha256: createHash('sha256').update(readFileSync(gameFile)).digest('hex'),
      kit,
      date: new Date().toISOString().slice(0, 10),
      scratch,
      resume: a.resume,
    });
    mkdirSync(join(ROOT, 'reports'), { recursive: true });
    writeFileSync(join(ROOT, 'reports', 'brief.md'), brief);
    process.stdout.write(brief);
    console.error(`\ntrial:brief: wrote reports/brief.md (scratch ${scratch})`);
  } catch (e) {
    console.error(`trial:brief: ${e.message}`);
    process.exit(1);
  }
}
