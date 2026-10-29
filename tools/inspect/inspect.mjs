#!/usr/bin/env node
// Read-only inventory of original/ (or another directory).
//
//   npm run inspect                         -> reports/inventory.json + summary on stdout
//   node tools/inspect/inspect.mjs DIR --out FILE
//   node tools/inspect/inspect.mjs --strings original/GAME.EXE   (stdout only, never written to reports)
//
// Never writes inside the inspected directory, never follows symlinks, never
// executes or decompresses inputs. Tolerates an empty or missing directory.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';
import { detect, entropy, printableRuns, strings } from './detect.mjs';
import { detectRea, detectTools } from './detect-rea.mjs';

const MAX_FILES = 20000;
const MAX_READ = 256 * 1024 * 1024;

function readOnly(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const n = Math.min(size, MAX_READ);
    const buf = Buffer.alloc(n);
    let off = 0;
    while (off < n) {
      const r = readSync(fd, buf, off, n - off, off);
      if (r <= 0) break;
      off += r;
    }
    return { buf, size, truncated: size > n };
  } finally {
    closeSync(fd);
  }
}

export function inventory(dirArg = 'original') {
  const dir = resolve(ROOT, dirArg);
  const result = {
    schema: 'game-cask/inventory/1',
    generated: new Date().toISOString(),
    root: relative(ROOT, dir).split(sep).join('/') || '.',
    files: [],
    skipped: [],
    candidates: [],
    tools: { rea: detectRea(ROOT), local: detectTools() },
    notes: [],
  };
  if (!existsSync(dir)) {
    result.notes.push(`${result.root}/ does not exist: nothing to inspect`);
    return result;
  }
  const walk = (d, depth) => {
    if (depth > 12) return;
    for (const name of readdirSync(d).sort()) {
      if (result.files.length >= MAX_FILES) return;
      const p = join(d, name);
      const rel = relative(dir, p).split(sep).join('/');
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        result.skipped.push({ path: rel, reason: 'symlink (not followed)' });
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (!st.isFile()) {
        result.skipped.push({ path: rel, reason: 'not a regular file' });
        continue;
      }
      if (name === '.gitkeep' || name === '.DS_Store') continue;
      const { buf, size, truncated } = readOnly(p);
      const det = detect(buf, name);
      result.files.push({
        path: rel,
        size,
        sha256: createHash('sha256').update(buf).digest('hex'),
        truncated,
        format: det.format,
        platform: det.platform,
        confidence: det.confidence,
        entropy: entropy(buf.subarray(0, 1 << 20)),
        printableRuns: printableRuns(buf),
        details: det.details,
        hints: det.hints ?? [],
      });
    }
  };
  walk(dir, 0);
  const EXEC = new Set(['pe', 'pe-dotnet', 'ne', 'le', 'lx', 'mz', 'dos-com', 'elf', 'mach-o', 'mach-o-fat', 'gba-rom', 'gb-rom', 'snes-rom', 'ines', 'md-rom', 'wasm']);
  const rank = { high: 3, medium: 2, low: 1 };
  result.candidates = result.files
    .filter((f) => EXEC.has(f.format))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.size - a.size)
    .map((f) => ({ path: f.path, format: f.format, platform: f.platform, confidence: f.confidence }));
  if (!result.files.length) result.notes.push(`${result.root}/ is empty: copy your legally obtained game files there.`);
  if (result.files.length && !result.candidates.length) result.notes.push('no executable candidates detected; the game may be packed in an archive or use an unrecognized format');
  const archives = result.files.filter((f) => ['zip', 'rar', '7z', 'gzip', 'cab', 'iso9660'].includes(f.format));
  if (archives.length) result.notes.push(`archives present (${archives.map((a) => a.path).join(', ')}): extract into a NEW directory outside original/, treat contents as untrusted`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--strings') {
    const file = resolve(ROOT, argv[1] ?? '');
    const { buf } = readOnly(file);
    for (const s of strings(buf, Number(argv[2] ?? 6), 2000)) console.log(`${s.offset.toString(16).padStart(6, '0')}  ${s.text}`);
    process.exit(0);
  }
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1] : 'reports/inventory.json';
  const dir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? 'original';
  const inv = inventory(dir);
  const outPath = resolve(ROOT, out);
  if (outPath.startsWith(resolve(ROOT, dir) + sep)) {
    console.error('refusing to write output inside the inspected directory');
    process.exit(1);
  }
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(inv, null, 2) + '\n');
  console.log(`inventory of ${inv.root}/: ${inv.files.length} file(s), ${inv.candidates.length} executable candidate(s) -> ${relative(ROOT, outPath)}`);
  for (const f of inv.files) console.log(`  ${f.path}  ${f.size} B  ${f.format}${f.platform ? ` (${f.platform})` : ''}  confidence=${f.confidence}  entropy=${f.entropy}`);
  for (const f of inv.files) for (const h of f.hints) console.log(`    hint: ${h}`);
  for (const n of inv.notes) console.log(`  note: ${n}`);
  console.log(`  REA: ${inv.tools.rea.available ? 'detected' : 'not detected'} — ${inv.tools.rea.note}`);
  const avail = Object.entries(inv.tools.local).filter(([, v]) => v.available).map(([k]) => k);
  console.log(`  local tools: ${avail.join(', ') || 'none'}`);
}
