#!/usr/bin/env node
// K72 (Q131 part 3): where the bytes of a built game module go. Static, read-only analysis of a wasm file:
//   - section split (code / data / name / other custom), name-section subsections (shipped at runtime or not);
//   - per-function body sizes by kind (fast lifted N_, exact regions R_, F_ wrappers, runtime/profile helpers, libc),
//     the size distribution (percentiles) and the largest functions;
//   - with --marked FILE.c (x86tool `lift ... --fast-mark on` output of the same module and policy: comments only, so
//     the compiled code is identical), per-guest-function emitted instruction counts by class, a non-negative least
//     squares fit of body bytes against those counts (bytes per lifted instruction by class) and bytes per instruction;
//   - with --coverage FILE (a runtime coverage snapshot, `__BGT_TEST__.coverage()` / probe coverage.json), the bytes in
//     lifted functions that a representative run entered vs never entered.
//
//   npm run bench:wasm-size -- --wasm web/public/games/ID/game.wasm [--work node_modules/.cache/bgt/pipeline/ID [--exe FILE]]
//                               [--marked a.c,b.c] [--coverage cov.json] [--out FILE] [--top N]
// --work re-lifts the build's chunks with --fast-mark on (same selection/base/policy; --exe defaults to the fixture exe).
//
// Nothing here compiles or instantiates the module; it never needs game data beyond the built artifact you point it at.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reader, sections, codeBodies } from '../build/wasm-sections.mjs';
import { functionNames } from '../build/wasm-names.mjs';

const SECTION = ['custom', 'type', 'import', 'function', 'table', 'memory', 'global', 'export', 'start', 'element', 'code', 'data', 'datacount', 'tag'];

/** Kind of a defined function, from its (name-section) name. */
export function functionKind(name) {
  if (!name) return 'unnamed';
  if (/^N_[0-9a-f]{8}$/.test(name)) return 'lifted-fast';
  if (/^R_[0-9a-f]{8}_[0-9a-f]{8}$/.test(name)) return 'lifted-region';
  if (/^N_[0-9a-f]{8}/.test(name)) return 'lifted-exact-step';
  if (/^F_[0-9a-f]{8}$/.test(name)) return 'lifted-wrapper';
  if (/^(x86_|xl_|xf_|x64_)/.test(name)) return 'x86-runtime';
  if (/^(w32_|api_|gl_|wgl|w64_)/.test(name)) return 'win32-profile';
  if (/^(bgt_|BGT)/.test(name)) return 'bgt-sdk';
  return 'other';
}

function customName(data) { const r = reader(data), n = r.uint(); return Buffer.from(r.take(n)).toString('utf8'); }

/** Section sizes (bytes including the id + size header) and name-section subsections. */
export function sectionSplit(bytes) {
  const out = { total: bytes.length, sections: [], name: null };
  for (const s of sections(bytes)) {
    const header = 1 + lebLength(s.data.length), size = header + s.data.length;
    const entry = { id: s.id, kind: SECTION[s.id] ?? `unknown-${s.id}`, bytes: size };
    if (s.id === 0) {
      entry.name = customName(s.data);
      if (entry.name === 'name') {
        const r = reader(s.data); r.take(r.uint());
        const subs = {};
        while (!r.done()) { const sub = r.byte(), n = r.uint(); r.take(n); subs[['module', 'function', 'local', 'label', 'type', 'table', 'memory', 'global', 'elem', 'data', 'field', 'tag'][sub] ?? sub] = n; }
        out.name = { bytes: size, subsections: subs };
      }
    }
    if (s.id === 11) {
      const r = reader(s.data), n = r.uint(); let payload = 0;
      for (let i = 0; i < n; i++) {
        const flags = r.uint();
        if (flags === 2) r.uint();
        if (flags === 0 || flags === 2) { while (r.byte() !== 0x0b); }
        const len = r.uint(); r.take(len); payload += len;
      }
      entry.segments = n; entry.payload = payload;
    }
    out.sections.push(entry);
  }
  return out;
}
function lebLength(n) { let k = 0; do { n = Math.floor(n / 128); k++; } while (n); return k; }

function importedFunctionCount(bytes) {
  const s = sections(bytes).find((x) => x.id === 2); if (!s) return 0;
  const r = reader(s.data), n = r.uint(); let fns = 0;
  for (let i = 0; i < n; i++) {
    r.take(r.uint()); r.take(r.uint()); const kind = r.byte();
    if (kind === 0) { r.uint(); fns++; }
    else if (kind === 1) { r.byte(); const f = r.uint(); r.uint(); if (f & 1) r.uint(); }
    else if (kind === 2) { const f = r.uint(); r.uint(); if (f & 1) r.uint(); }
    else if (kind === 3) { r.byte(); r.byte(); }
    else if (kind === 4) { r.byte(); r.uint(); }
    else throw new Error('unknown import kind ' + kind);
  }
  return fns;
}

/** Defined functions with body sizes and names. */
export function functionSizes(bytes, symbolMap = null) {
  const code = sections(bytes).find((s) => s.id === 10);
  if (!code) return [];
  const bodies = codeBodies(code.data), imported = importedFunctionCount(bytes);
  const listed = functionNames(bytes);
  const names = new Map((listed.length || !symbolMap ? listed : symbolMap.functions).map((n) => [n.index, n.name]));
  return bodies.map((b, i) => { const name = names.get(imported + i) ?? null; return { index: imported + i, name, kind: functionKind(name), bytes: b.length + lebLength(b.length) }; });
}

export function percentiles(values, ps = [0.5, 0.9, 0.99, 1]) {
  const v = [...values].sort((a, b) => a - b);
  return Object.fromEntries(ps.map((p) => [`p${Math.round(p * 100)}`, v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))] : null]));
}

/** Per guest function features from `--fast-mark on` C: `/*@F addr n*\/` opens a function, `/*@op*\/` / `/*@+op*\/`
 * (inlined copy) precede each emitted instruction, `/*@call*\/` etc. are emitted structures. */
export function markedFeatures(text) {
  const out = new Map(); let cur = null;
  const re = /\/\*@(F [0-9a-f]{8} \d+|\+?[a-z0-9_.]+)\*\//g;
  for (const m of text.matchAll(re)) {
    const t = m[1];
    if (t.startsWith('F ')) { const [, addr, n] = t.split(' '); cur = { addr, insns: Number(n), own: 0, inlined: 0, classes: {} }; out.set(addr, cur); continue; }
    if (!cur) continue;
    const inl = t.startsWith('+'), cls = inl ? t.slice(1) : t;
    if (inl) cur.inlined++; else cur.own++;
    cur.classes[cls] = (cur.classes[cls] ?? 0) + 1;
  }
  return out;
}

/** Coarse instruction classes for the fit (guest op names from x86tool's marker). */
export function opClass(op) {
  if (op.startsWith('s.')) return 'simd';
  const table = {
    mov: 'mov', movzx: 'mov', movsx: 'mov', lea: 'lea', push: 'push', pop: 'pop',
    add: 'alu', sub: 'alu', and: 'alu', or: 'alu', xor: 'alu', adc: 'alu', sbb: 'alu', inc: 'alu', dec: 'alu', neg: 'alu', not: 'alu',
    cmp: 'cmp/test', test: 'cmp/test', jcc: 'jcc', setcc: 'setcc/cmov', cmovcc: 'setcc/cmov', jmp: 'jmp', ret: 'ret',
    call: 'call', call_ind: 'call', jmp_ind: 'jmp-ind', imul: 'imul', shl: 'shift', shr: 'shift', sar: 'shift', sal: 'shift',
    rol: 'shift', ror: 'shift', rcl: 'shift', rcr: 'shift', generic: 'generic', nop: 'nop', int3: 'nop',
  };
  return table[op] ?? 'other';
}

/** Non-negative least squares (Lawson-Hanson, small dense) for y ≈ X b. */
export function nnls(X, y, iterations = 500) {
  const n = X[0].length, P = new Set(), b = new Array(n).fill(0);
  const grad = () => { const r = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * b[j], 0)); return Array.from({ length: n }, (_, j) => X.reduce((s, row, i) => s + row[j] * r[i], 0)); };
  const solve = (cols) => {
    const k = cols.length, A = Array.from({ length: k }, () => new Array(k).fill(0)), v = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { v[a] += X[i][cols[a]] * y[i]; for (let c = 0; c < k; c++) A[a][c] += X[i][cols[a]] * X[i][cols[c]]; }
    for (let a = 0; a < k; a++) A[a][a] += 1e-9;
    for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [v[c], v[p]] = [v[p], v[c]];
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q < k; q++) A[r][q] -= f * A[c][q]; v[r] -= f * v[c]; } }
    return v.map((x, a) => x / A[a][a]);
  };
  for (let it = 0; it < iterations; it++) {
    const w = grad(); let j = -1, best = 1e-7;
    for (let q = 0; q < n; q++) if (!P.has(q) && w[q] > best) { best = w[q]; j = q; }
    if (j < 0) break;
    P.add(j);
    for (;;) {
      const cols = [...P], z = solve(cols);
      if (z.every((x) => x > 0)) { cols.forEach((c, a) => { b[c] = z[a]; }); break; }
      let alpha = 1;
      cols.forEach((c, a) => { if (z[a] <= 0) alpha = Math.min(alpha, b[c] / (b[c] - z[a])); });
      cols.forEach((c, a) => { b[c] += alpha * (z[a] - b[c]); if (b[c] <= 1e-9) { b[c] = 0; P.delete(c); } });
    }
  }
  const pred = X.map((row) => row.reduce((s, x, j) => s + x * b[j], 0)), mean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssr = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0), sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  return { coefficients: b, r2: sst ? 1 - ssr / sst : 1 };
}

/** Fit body bytes of fast lifted functions against emitted instruction classes (+1 constant per function). */
export function classFit(functions, features) {
  const rows = [], classes = new Set();
  for (const f of functions) {
    if (f.kind !== 'lifted-fast') continue;
    const feat = features.get(f.name.slice(2)); if (!feat) continue;
    const c = {}; for (const [op, k] of Object.entries(feat.classes)) { const cl = opClass(op); c[cl] = (c[cl] ?? 0) + k; classes.add(cl); }
    rows.push({ bytes: f.bytes, c, feat });
  }
  const names = ['(function)', ...[...classes].sort()];
  if (rows.length < names.length * 3) return null;
  const X = rows.map((r) => names.map((n) => n === '(function)' ? 1 : r.c[n] ?? 0)), y = rows.map((r) => r.bytes);
  const { coefficients, r2 } = nnls(X, y);
  const totals = Object.fromEntries(names.map((n, j) => [n, X.reduce((s, row) => s + row[j], 0)]));
  const fitted = names.map((n, j) => ({ class: n, count: totals[n], bytesEach: +coefficients[j].toFixed(1), bytes: Math.round(coefficients[j] * totals[n]) }));
  const own = rows.reduce((s, r) => s + r.feat.own, 0), inl = rows.reduce((s, r) => s + r.feat.inlined, 0), bytes = y.reduce((s, v) => s + v, 0);
  return { functions: rows.length, bytes, ownInstructions: own, inlinedInstructions: inl, bytesPerOwnInstruction: +(bytes / own).toFixed(1),
    bytesPerEmittedInstruction: +(bytes / (own + inl)).toFixed(1), r2: +r2.toFixed(4), classes: fitted.sort((a, b) => b.bytes - a.bytes) };
}

/** Entered vs never-entered lifted bytes, given a coverage snapshot's lifted function entries. */
export function coverageSplit(functions, coverage) {
  const entered = new Set();
  const addr = (e) => typeof e === 'number' ? e : typeof e === 'string' ? parseInt(e, 16) : typeof e?.address === 'number' ? e.address : parseInt(e?.address, 16);
  for (const e of coverage.code ?? []) { const a = addr(e); if (Number.isFinite(a)) entered.add(a >>> 0); }
  const out = { enteredAddresses: entered.size, lifted: { functions: 0, bytes: 0 }, entered: { functions: 0, bytes: 0 }, never: { functions: 0, bytes: 0 } };
  for (const f of functions) {
    if (f.kind !== 'lifted-fast' && f.kind !== 'lifted-region' && f.kind !== 'lifted-wrapper') continue;
    const addr = parseInt(f.name.slice(2, 10), 16);
    out.lifted.functions++; out.lifted.bytes += f.bytes;
    const k = entered.has(addr) ? 'entered' : 'never'; out[k].functions++; out[k].bytes += f.bytes;
  }
  out.neverShare = out.lifted.bytes ? +(out.never.bytes / out.lifted.bytes).toFixed(4) : null;
  return out;
}

export function analyze(bytes, { marked = [], coverage = null, top = 15, symbolMap = null } = {}) {
  const split = sectionSplit(bytes), fns = functionSizes(bytes, symbolMap);
  const kinds = {};
  for (const f of fns) { const k = kinds[f.kind] ??= { functions: 0, bytes: 0, sizes: [] }; k.functions++; k.bytes += f.bytes; k.sizes.push(f.bytes); }
  for (const k of Object.values(kinds)) { k.distribution = percentiles(k.sizes); delete k.sizes; }
  const code = split.sections.find((s) => s.id === 10)?.bytes ?? 0, data = split.sections.find((s) => s.id === 11);
  const report = { bytes: bytes.length, code, data: data?.bytes ?? 0, dataPayload: data?.payload ?? 0, name: split.name,
    otherCustom: split.sections.filter((s) => s.id === 0 && s.name !== 'name').map((s) => ({ name: s.name, bytes: s.bytes })),
    sections: split.sections.map(({ kind, name, bytes: b }) => ({ kind: name ? `custom:${name}` : kind, bytes: b })),
    kinds, largest: [...fns].sort((a, b) => b.bytes - a.bytes).slice(0, top).map(({ name, kind, bytes: b }) => ({ name, kind, bytes: b })) };
  if (marked.length) {
    const features = new Map();
    for (const text of marked) for (const [k, v] of markedFeatures(text)) features.set(k, v);
    report.fit = classFit(fns, features);
  }
  if (coverage) report.coverage = coverageSplit(fns, coverage);
  return report;
}

/** Re-lift a built game's chunks with `--fast-mark on` (same selection, base and policy as the build; comments only),
 * returning the marked C texts. `work` is node_modules/.cache/bgt/pipeline/<id>, `exe` the module the build lifted. */
export async function relift({ work, exe, module = 0 }) {
  const { x86tool } = await import('../build/pipeline.mjs');
  const { liftPolicyArgs } = await import('../build/chunks.mjs');
  const pj = JSON.parse(readFileSync(join(work, 'pipeline.json'), 'utf8')), m = pj.modules[module];
  const id = m.name.replace(/[^A-Za-z0-9]/g, '_').toLowerCase(), dir = join(work, `chunks_${id}`);
  if (!existsSync(dir)) throw new Error(`no chunk directory ${dir} (monolithic lifts are not supported here)`);
  const tool = x86tool(), out = mkdtempSync(join(tmpdir(), 'bgt-mark-')), texts = [];
  try {
    for (const list of readdirSync(dir).filter((f) => /_\d{4}\.txt$/.test(f)).sort()) {
      const name = basename(list, '.txt'), file = join(out, name + '.c');
      const args = ['lift', exe, '--name', name, '--base', m.base.toString(16), '--select', join(dir, list), ...liftPolicyArgs(pj.liftPolicy), '--fast-mark', 'on', '--out', file];
      if (existsSync(join(dir, name + '.skip.txt'))) args.push('--skip-file', join(dir, name + '.skip.txt'));
      execFileSync(tool, args, { stdio: ['ignore', 'ignore', 'inherit'] });
      texts.push(readFileSync(file, 'utf8'));
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
  return texts;
}

async function main(argv) {
  const a = { marked: [], top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--wasm') a.wasm = v(); else if (k === '--marked') a.marked.push(...v().split(',')); else if (k === '--coverage') a.coverage = v();
    else if (k === '--out') a.out = v(); else if (k === '--work') a.work = v(); else if (k === '--exe') a.exe = v(); else if (k === '--top') a.top = Number(v()); else throw new Error(`unknown option ${k}`);
  }
  if (!a.wasm) throw new Error('usage: wasm-size.mjs --wasm FILE [--marked a.c,b.c] [--coverage FILE] [--out FILE]');
  const marked = a.marked.map((f) => readFileSync(f, 'utf8'));
  if (a.work) marked.push(...await relift({ work: a.work, exe: a.exe ?? join(a.work, 'fixture', basename(JSON.parse(readFileSync(join(a.work, 'pipeline.json'), 'utf8')).modules[0].provenance)) }));
  // K72: a stripped artifact (pipeline.wasmNames "strip") names its functions in <artifact>.names.json.
  const symbolMap = existsSync(a.wasm + '.names.json') ? JSON.parse(readFileSync(a.wasm + '.names.json', 'utf8')) : null;
  const report = analyze(readFileSync(a.wasm), { symbolMap, marked, coverage: a.coverage ? JSON.parse(readFileSync(a.coverage, 'utf8')) : null, top: a.top });
  report.file = a.wasm;
  const mb = (n) => (n / 1e6).toFixed(2) + ' MB';
  console.log(`${a.wasm}: ${mb(report.bytes)} = code ${mb(report.code)} (${(100 * report.code / report.bytes).toFixed(1)}%), data ${mb(report.data)}, name ${mb(report.name?.bytes ?? 0)}`);
  for (const [k, v] of Object.entries(report.kinds).sort((x, y) => y[1].bytes - x[1].bytes))
    console.log(`  ${k.padEnd(18)} ${String(v.functions).padStart(7)} fns ${mb(v.bytes).padStart(10)}  p50 ${v.distribution.p50} p90 ${v.distribution.p90} p99 ${v.distribution.p99} max ${v.distribution.p100}`);
  if (report.fit) {
    const f = report.fit;
    console.log(`  fit: ${f.functions} fast functions, ${f.bytesPerOwnInstruction} B/own insn, ${f.bytesPerEmittedInstruction} B/emitted insn (inlined ${f.inlinedInstructions} / own ${f.ownInstructions}), r2 ${f.r2}`);
    for (const c of f.classes) console.log(`    ${c.class.padEnd(12)} ${String(c.count).padStart(9)} x ${String(c.bytesEach).padStart(6)} B = ${mb(c.bytes)}`);
  }
  if (report.coverage) console.log(`  coverage: never entered ${report.coverage.never.functions}/${report.coverage.lifted.functions} lifted fns, ${mb(report.coverage.never.bytes)} (${(100 * report.coverage.neverShare).toFixed(1)}%)`);
  if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
