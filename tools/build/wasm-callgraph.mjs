// Original CC0-1.0. Bounded binary call-graph analysis of a linked wasm32 module (K65).
// No IR, no instantiation: one pass over every function body that records direct calls,
// call_indirect signatures, ref.func uses and global accesses. Used to compute the exact
// set of functions that can (statically) reach a suspending import, and to verify that the
// Asyncify output instruments every one of them. Unknown opcodes fail closed.
import { reader, sections } from './wasm-sections.mjs';
import { functionNames } from './wasm-names.mjs';

const VALTYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f]);

/** Parse a module. Returns per-function facts indexed by the function index space (imports first). */
export function analyzeModule(bytes) {
  const list = sections(bytes);
  const types = [], funcType = [], imports = [], exports = [], tableTargets = new Set();
  let importedFunctions = 0, tableShared = false, refFuncAnywhere = new Set();
  const bodies = [];
  const sec = (id) => list.find((s) => s.id === id);
  // Constant/initializer expressions: only ref.func/global.get/consts/end are legal.
  const constExpr = (r) => {
    for (;;) {
      const op = r.byte();
      if (op === 0x0b) return;
      if (op === 0x41 || op === 0x42) skipLeb(r);
      else if (op === 0x43) r.take(4);
      else if (op === 0x44) r.take(8);
      else if (op === 0x23) r.uint();
      else if (op === 0xd2) refFuncAnywhere.add(r.uint());
      else if (op === 0xd0) skipLeb(r);
      else if (op >= 0x6a && op <= 0x6c || op >= 0x7c && op <= 0x7e) { /* extended-const arithmetic */ }
      else throw new Error('unsupported constant expression opcode 0x' + op.toString(16));
    }
  };
  const t = sec(1);
  if (t) {
    const r = reader(t.data);
    for (let n = r.uint(); n; n--) {
      const form = r.byte();
      if (form !== 0x60) throw new Error('unsupported wasm type form 0x' + form.toString(16) + ' (call-graph analysis supports MVP function types)');
      const params = [...r.take(r.uint())], results = [...r.take(r.uint())];
      types.push(params.join(',') + '>' + results.join(','));
    }
  }
  const im = sec(2);
  if (im) {
    const r = reader(im.data);
    const str = () => r.take(r.uint()).toString('utf8');
    const limits = () => { const f = r.byte(); r.uint(); if (f & 1) r.uint(); };
    for (let n = r.uint(); n; n--) {
      const module = str(), name = str(), kind = r.byte();
      if (kind === 0) { const type = r.uint(); imports.push({ module, name, index: importedFunctions++ }); funcType.push(type); }
      else if (kind === 1) { r.byte(); limits(); tableShared = true; }
      else if (kind === 2) limits();
      else if (kind === 3) { r.byte(); r.byte(); }
      else if (kind === 4) { r.byte(); r.uint(); }
      else throw new Error('unsupported import kind ' + kind);
    }
  }
  const fn = sec(3);
  if (fn) { const r = reader(fn.data); for (let n = r.uint(); n; n--) funcType.push(r.uint()); }
  const gl = sec(6);
  if (gl) { const r = reader(gl.data); for (let n = r.uint(); n; n--) { r.byte(); r.byte(); constExpr(r); } }
  const ex = sec(7);
  if (ex) {
    const r = reader(ex.data);
    for (let n = r.uint(); n; n--) {
      const name = r.take(r.uint()).toString('utf8'), kind = r.byte(), index = r.uint();
      exports.push({ name, kind, index });
      if (kind === 1) tableShared = true;
    }
  }
  const el = sec(9);
  if (el) {
    const r = reader(el.data);
    for (let n = r.uint(); n; n--) {
      const flags = r.uint();
      if (flags > 7) throw new Error('unsupported element segment flags ' + flags);
      if (flags === 2 || flags === 6) r.uint();
      if (!(flags & 1)) constExpr(r);
      if (flags & 3) r.byte(); // elemkind or reftype
      const count = r.uint();
      for (let i = 0; i < count; i++) {
        if (flags & 4) constExpr(r);
        else tableTargets.add(r.uint());
      }
    }
  }
  const code = sec(10);
  const functions = [];
  for (let i = 0; i < importedFunctions; i++) functions.push(null);
  if (code) {
    const r = reader(code.data);
    const n = r.uint();
    for (let i = 0; i < n; i++) {
      const size = r.uint(), start = r.position;
      bodies.push([start, size]);
      functions.push(scanBody(code.data, start, start + size, importedFunctions + i, refFuncAnywhere));
      r.position = start + size;
    }
    if (!r.done()) throw new Error('trailing wasm code');
  }
  if (functions.length !== funcType.length) throw new Error('function/code section count mismatch');
  // Anything referenced by ref.func can enter a table through table.set/grow/fill.
  for (const f of refFuncAnywhere) tableTargets.add(f);
  // A table visible to the host can receive any function the host holds: our exports and imports.
  if (tableShared) {
    for (const e of exports) if (e.kind === 0) tableTargets.add(e.index);
    for (let i = 0; i < importedFunctions; i++) tableTargets.add(i);
  }
  const sig = funcType.map((ti) => { if (types[ti] === undefined) throw new Error('function type index out of range'); return types[ti]; });
  return { types, sig, imports, exports, importedFunctions, functions, tableTargets, tableShared, names: functionNames(bytes) };
}

function skipLeb(r) { for (let i = 0; i < 10; i++) if (!(r.byte() & 0x80)) return; throw new Error('oversized wasm LEB'); }

function scanBody(data, start, end, index, refFunc) {
  const r = reader(data.subarray(0, end));
  r.position = start;
  for (let groups = r.uint(); groups; groups--) { r.uint(); r.byte(); }
  const calls = new Set(), indirect = new Set(), globals = new Set();
  const blockType = () => { const b = data[r.position]; if (b === 0x40 || VALTYPES.has(b)) r.position++; else skipLeb(r); };
  const memarg = () => { const align = r.uint(); if (align & 0x40) r.uint(); skipLeb(r); };
  while (r.position < end) {
    const op = r.byte();
    if (op <= 0x01 || op === 0x05 || op === 0x0b || op === 0x0f || op === 0x1a || op === 0x1b || op >= 0x45 && op <= 0xc4 || op === 0xd1) continue;
    switch (op) {
      case 0x02: case 0x03: case 0x04: blockType(); break;
      case 0x0c: case 0x0d: r.uint(); break;
      case 0x0e: for (let n = r.uint(); n; n--) r.uint(); r.uint(); break;
      case 0x10: case 0x12: calls.add(r.uint()); break;
      case 0x11: case 0x13: indirect.add(r.uint()); r.uint(); break;
      case 0x1c: for (let n = r.uint(); n; n--) r.byte(); break;
      case 0x20: case 0x21: case 0x22: r.uint(); break;
      case 0x23: case 0x24: globals.add(r.uint()); break;
      case 0x25: case 0x26: r.uint(); break;
      case 0x3f: case 0x40: r.uint(); break;
      case 0x41: case 0x42: skipLeb(r); break;
      case 0x43: r.take(4); break;
      case 0x44: r.take(8); break;
      case 0xd0: skipLeb(r); break;
      case 0xd2: refFunc.add(r.uint()); break;
      case 0xfc: {
        const sub = r.uint();
        if (sub <= 7) break;
        if (sub === 8 || sub === 10 || sub === 12 || sub === 14) { r.uint(); r.uint(); break; }
        if (sub === 9 || sub === 11 || sub === 13 || sub === 15 || sub === 16 || sub === 17) { r.uint(); break; }
        throw new Error('unsupported 0xfc opcode ' + sub + ' in function ' + index);
      }
      default:
        if (op >= 0x28 && op <= 0x3e) { memarg(); break; }
        throw new Error('unsupported wasm opcode 0x' + op.toString(16) + ' in function ' + index + ' (call-graph analysis is MVP + bulk-memory/sign-ext/sat-conv only)');
    }
  }
  if (r.position !== end || data[end - 1] !== 0x0b) throw new Error('malformed function body ' + index);
  return { calls: [...calls], indirect: [...indirect], globals: [...globals] };
}

/**
 * Functions that can reach a suspending import: direct calls, plus call_indirect sites whose
 * signature matches any suspending function that can be in a table. `cut` are function indices
 * known (by a kit invariant) not to suspend; they are never marked and never propagate, exactly
 * like Binaryen's asyncify-removelist. Returns the set (including the imports) and a reason map.
 */
export function suspendingSet(info, { suspending = [['bgt', 'yield']], cut = new Set() } = {}) {
  const callers = new Map(), indirectCallers = new Map();
  const add = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, a = []); a.push(v); };
  info.functions.forEach((f, i) => {
    if (!f) return;
    for (const c of f.calls) add(callers, c, i);
    for (const ti of f.indirect) add(indirectCallers, info.types[ti], i);
  });
  const set = new Set(), via = new Map(), work = [], sigDone = new Set();
  // via: i -> { to, indirect } (the callee that makes i suspend; absent for the seed imports).
  const mark = (i, why) => { if (set.has(i) || cut.has(i)) return; set.add(i); if (why) via.set(i, why); work.push(i); };
  for (const imp of info.imports) if (suspending.some(([m, n]) => m === imp.module && n === imp.name)) mark(imp.index, null);
  // Breadth-first, so each reason chain is a shortest path to the import.
  for (let k = 0; k < work.length; k++) {
    const t = work[k];
    for (const c of callers.get(t) ?? []) mark(c, { to: t, indirect: false });
    if (info.tableTargets.has(t)) {
      const s = info.sig[t];
      if (!sigDone.has(s)) { sigDone.add(s); for (const c of indirectCallers.get(s) ?? []) mark(c, { to: t, indirect: true }); }
    }
  }
  return { set, via };
}

/** The Asyncify state global, identified through the exported asyncify_get_state body. */
export function asyncifyStateGlobal(info) {
  const e = info.exports.find((x) => x.name === 'asyncify_get_state' && x.kind === 0);
  if (!e) throw new Error('Asyncify output has no asyncify_get_state export');
  const g = info.functions[e.index]?.globals;
  if (!g || g.length !== 1) throw new Error('cannot identify the Asyncify state global');
  return g[0];
}

/**
 * Build-time soundness check on the FINAL artifact: every function that can statically reach
 * the suspending import (with the same cut) must reference the Asyncify state global, i.e. be
 * instrumented. Throws with a call chain on violation. Returns counts for metrics.
 */
export function verifyAsyncify(bytes, { cutNames = new Set(), suspending } = {}) {
  const info = analyzeModule(bytes);
  const state = asyncifyStateGlobal(info);
  const nameOf = new Map(info.names.map((n) => [n.index, n.name]));
  const cut = new Set([...nameOf].filter(([, n]) => cutNames.has(n)).map(([i]) => i));
  const { set, via } = suspendingSet(info, { suspending, cut });
  const helpers = new Set(info.exports.filter((e) => e.kind === 0 && e.name.startsWith('asyncify_')).map((e) => e.index));
  const instrumented = new Set();
  info.functions.forEach((f, i) => { if (f && !helpers.has(i) && f.globals.includes(state)) instrumented.add(i); });
  const missing = [...set].filter((i) => i >= info.importedFunctions && !instrumented.has(i));
  if (missing.length) {
    const chain = (i) => { let out = nameOf.get(i) ?? 'f' + i; for (let n = 0, v = via.get(i); n < 16 && v; n++, v = via.get(v.to)) out += (v.indirect ? ' -(call_indirect)-> ' : ' -> ') + (nameOf.get(v.to) ?? 'f' + v.to); return out; };
    throw new Error(missing.length + ' function(s) can reach a suspending import but are not Asyncify-instrumented, e.g. ' + chain(missing[0]));
  }
  return { functions: info.functions.length - info.importedFunctions, suspending: set.size - [...set].filter((i) => i < info.importedFunctions).length, instrumented: instrumented.size };
}
