#!/usr/bin/env node
// K72 (Q131 part 3): wasm code bytes per lifted guest instruction class, by DWARF line attribution.
//
// Build the game once with line tables (comments-only markers do not change code; -g does not change codegen):
//   game.json "cflags": ["-gline-tables-only"], env BGT_KEEP_DWARF=1 BGT_JSPI_WASM_OPT=0 BGT_SUSPENSION_BUILD=jspi
// then
//   node tools/report/wasm-lines.mjs --wasm web/public/games/ID/game.wasm --work node_modules/.cache/bgt/pipeline/ID [--exe FILE] [--out FILE]
//
// Every code byte of a lifted chunk is attributed to a line of the generated C: directly from the line table, or, for
// code of an inlined helper (xl_alu, xl_store, ...), to the call line recorded by its outermost DW_TAG_inlined_subroutine.
// The same chunks re-lifted with `--fast-mark on` (identical text and line numbers, plus comments) say which guest
// instruction each line belongs to. Sizes are those of the raw link output (before wasm-opt -O2); use the shares.
// Needs llvm-dwarfdump (Xcode command line tools or LLVM).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { opClass, relift } from './wasm-size.mjs';

export function dwarfdump() {
  for (const p of [process.env.LLVM_DWARFDUMP, '/Library/Developer/CommandLineTools/usr/bin/llvm-dwarfdump', '/opt/homebrew/opt/llvm/bin/llvm-dwarfdump', 'llvm-dwarfdump'].filter(Boolean)) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch { /* next */ }
  }
  throw new Error('llvm-dwarfdump not found (set LLVM_DWARFDUMP)');
}

/** Line-table intervals [{lo, hi, file, line}] from `llvm-dwarfdump --debug-line` text. */
export function parseLines(text) {
  const out = []; let dirs = {}, files = {}, cur = null, prev = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('debug_line[')) { dirs = {}; files = {}; prev = null; continue; }
    let m = /^include_directories\[\s*(\d+)\] = "(.*)"$/.exec(line);
    if (m) { dirs[m[1]] = m[2]; continue; }
    m = /^file_names\[\s*(\d+)\]:$/.exec(line);
    if (m) { cur = { id: m[1] }; continue; }
    m = /^\s+name: "(.*)"$/.exec(line);
    if (m && cur) { cur.name = m[1]; continue; }
    m = /^\s+dir_index: (\d+)$/.exec(line);
    if (m && cur) { files[cur.id] = (dirs[m[1]] ? dirs[m[1]] + '/' : '') + cur.name; cur = null; continue; }
    m = /^0x([0-9a-f]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s*(.*)$/.exec(line);
    if (m) {
      const addr = parseInt(m[1], 16);
      if (prev && addr > prev.lo) out.push({ lo: prev.lo, hi: addr, file: prev.file, line: prev.line });
      prev = /end_sequence/.test(m[5]) ? null : { lo: addr, file: files[m[4]] ?? m[4], line: Number(m[2]) };
    }
  }
  return out;
}

/** Outermost inlined-helper ranges whose call site is in a file accepted by `isChunk`: [{lo, hi, file, line}]. */
export function parseInlined(text, isChunk) {
  const out = []; let die = null;
  const flush = () => {
    if (die && die.file && isChunk(die.file) && die.line) for (const [lo, hi] of die.ranges) if (hi > lo) out.push({ lo, hi, file: die.file, line: die.line });
    die = null;
  };
  for (const line of text.split('\n')) {
    if (/^0x[0-9a-f]+:\s+(DW_TAG|NULL)/.test(line)) { flush(); if (/DW_TAG_inlined_subroutine/.test(line)) die = { ranges: [], lo: null }; continue; }
    if (!die) continue;
    let m = /DW_AT_low_pc\s+\(0x([0-9a-f]+)\)/.exec(line);
    if (m) { die.lo = parseInt(m[1], 16); continue; }
    m = /DW_AT_high_pc\s+\(0x([0-9a-f]+)\)/.exec(line);
    if (m) { die.ranges.push([die.lo, parseInt(m[1], 16)]); continue; }
    m = /^\s*\[0x([0-9a-f]+), 0x([0-9a-f]+)\)/.exec(line);
    if (m) { die.ranges.push([parseInt(m[1], 16), parseInt(m[2], 16)]); continue; }
    m = /DW_AT_ranges\s+\(.*\[0x([0-9a-f]+), 0x([0-9a-f]+)\)/.exec(line);
    if (m) { die.ranges.push([parseInt(m[1], 16), parseInt(m[2], 16)]); continue; }
    m = /DW_AT_call_file\s+\("(.*)"\)/.exec(line);
    if (m) { die.file = m[1]; continue; }
    m = /DW_AT_call_line\s+\((\d+)\)/.exec(line);
    if (m) die.line = Number(m[1]);
  }
  flush();
  // Keep the outermost: a nested helper's call site is a header. Sorting by (lo, -length) puts parents first.
  out.sort((a, b) => a.lo - b.lo || (b.hi - b.lo) - (a.hi - a.lo));
  const top = []; for (const r of out) { const t = top[top.length - 1]; if (t && r.lo >= t.lo && r.hi <= t.hi) continue; top.push(r); }
  return top;
}

/** Per line of a marked chunk: the class of the guest instruction (or structure) it belongs to. */
export function lineClasses(text) {
  const lines = text.split('\n'), cls = new Array(lines.length + 1).fill(null);
  let state = 'outside', last = null, marks = [];
  const counts = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], n = i + 1;
    const f = /\/\*@F [0-9a-f]{8} \d+\*\//.exec(l);
    if (f) { state = 'prologue'; last = null; }
    marks = [...l.matchAll(/\/\*@(\+?)([a-z0-9_.]+)\*\//g)];
    for (const m of marks) { const c = opClass(m[2]); const k = (m[1] ? 'inlined ' : '') + c; counts[k] = (counts[k] ?? 0) + 1; }
    if (state === 'outside') { cls[n] = '(other)'; continue; }
    if (/^slow:/.test(l)) { state = 'epilogue'; }
    if (state === 'epilogue') { cls[n] = '(epilogue)'; if (/^void F_[0-9a-f]{8}\(void\)/.test(l)) state = 'outside'; continue; }
    if (marks.length) { last = (marks[0][1] ? 'inlined ' : '') + opClass(marks[0][2]); state = 'body'; cls[n] = last; continue; }
    if (/^[LQ]_[A-Za-z0-9_]*: __attribute__\(\(unused\)\)/.test(l)) { cls[n] = /clock-qbase>=2000000u/.test(l) ? '(loop poll)' : '(block label)'; continue; }
    cls[n] = state === 'prologue' ? '(prologue)' : last ?? '(prologue)';
  }
  return { cls, counts };
}

function locate(sorted, addr) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, r = sorted[mid]; if (addr < r.lo) hi = mid - 1; else if (addr >= r.hi) lo = mid + 1; else return r; }
  return null;
}

export function attribute({ lineText, infoText, marked }) {
  const chunkName = (f) => { const b = basename(f); return marked.has(b) ? b : null; };
  const rows = parseLines(lineText), inl = parseInlined(infoText, (f) => !!chunkName(f));
  const bytes = {}, own = {}, add = (k, n) => { bytes[k] = (bytes[k] ?? 0) + n; };
  let lifted = 0, heuristic = 0, total = 0;
  const lastChunkRow = new Map();
  for (const r of rows) {
    const n = r.hi - r.lo; total += n;
    let file = chunkName(r.file), line = r.line;
    if (!file) {
      const c = locate(inl, r.lo);
      if (c) { file = chunkName(c.file); line = c.line; }
      else { const p = lastChunkRow.get('last'); if (p && p.hi === r.lo) { file = p.file; line = p.line; heuristic += n; } }
    }
    if (!file) { add('(not lifted code)', n); lastChunkRow.delete('last'); continue; }
    lastChunkRow.set('last', { file, line, hi: r.hi });
    lifted += n;
    // Line 0: code the compiler could not attribute to one source line (merged tails, hoisted spills).
    add(line === 0 ? '(merged, line 0)' : marked.get(file).cls[line] ?? '(other)', n);
  }
  for (const m of marked.values()) for (const [k, v] of Object.entries(m.counts)) own[k] = (own[k] ?? 0) + v;
  return { total, lifted, heuristic, bytes, counts: own };
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--wasm') a.wasm = v(); else if (k === '--work') a.work = v(); else if (k === '--exe') a.exe = v(); else if (k === '--out') a.out = v();
    else throw new Error(`unknown option ${k}`);
  }
  if (!a.wasm || !a.work) throw new Error('usage: wasm-lines.mjs --wasm FILE --work DIR [--exe FILE] [--out FILE]');
  const dd = dwarfdump(), big = { encoding: 'utf8', maxBuffer: 2 ** 31 };
  const lineText = execFileSync(dd, ['--debug-line', a.wasm], big), infoText = execFileSync(dd, ['--debug-info', a.wasm], big);
  if (!/DW_TAG_compile_unit/.test(infoText)) throw new Error('no DWARF in the module: build with "cflags": ["-gline-tables-only"] and BGT_KEEP_DWARF=1');
  const pj = JSON.parse(readFileSync(join(a.work, 'pipeline.json'), 'utf8'));
  const exe = a.exe ?? join(a.work, 'fixture', basename(pj.modules[0].provenance));
  if (!existsSync(exe)) throw new Error(`module file ${exe} not found (pass --exe)`);
  const texts = await relift({ work: a.work, exe });
  const id = pj.modules[0].name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase();
  const marked = new Map(texts.map((t, i) => [`${id}_${String(i).padStart(4, '0')}.c`, lineClasses(t)]));
  const r = attribute({ lineText, infoText, marked });
  const rows = Object.entries(r.bytes).sort((x, y) => y[1] - x[1]).map(([k, b]) => {
    const n = r.counts[k] ?? null;
    return { class: k, bytes: b, share: +(b / r.lifted).toFixed(4), instructions: n, bytesEach: n ? +(b / n).toFixed(1) : null };
  });
  const ownInsns = Object.entries(r.counts).filter(([k]) => !k.startsWith('inlined ')).reduce((s, [, v]) => s + v, 0);
  const inlinedInsns = Object.entries(r.counts).filter(([k]) => k.startsWith('inlined ')).reduce((s, [, v]) => s + v, 0);
  const report = { wasm: a.wasm, codeBytesAttributed: r.total, liftedBytes: r.lifted, heuristicBytes: r.heuristic, ownInstructions: ownInsns, inlinedInstructions: inlinedInsns,
    bytesPerOwnInstruction: +(r.lifted / ownInsns).toFixed(1), classes: rows };
  console.log(`${a.wasm}: lifted ${(r.lifted / 1e6).toFixed(2)} MB of ${(r.total / 1e6).toFixed(2)} MB line-attributed code (heuristic ${(100 * r.heuristic / r.lifted).toFixed(1)}%), ${report.bytesPerOwnInstruction} B/insn (${ownInsns} own + ${inlinedInsns} inlined)`);
  for (const x of rows) console.log(`  ${x.class.padEnd(22)} ${(x.bytes / 1e6).toFixed(3).padStart(8)} MB ${(100 * x.share).toFixed(1).padStart(5)}%${x.instructions ? `  ${String(x.instructions).padStart(8)} x ${x.bytesEach} B` : ''}`);
  if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
