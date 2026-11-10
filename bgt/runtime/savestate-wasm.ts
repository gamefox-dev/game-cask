// Test-only module instrumentation. Called after integrity verification, never for ordinary loads.
// Export numeric globals, functions and tables without changing code or index spaces.
const prefix = '__bgt_checkpoint_';
export const checkpointName = (kind: string, index: number) => prefix + kind + index;
export function instrumentCheckpointWasm(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const uint = (n: number): number[] => { const out: number[] = []; do { const b = n % 128; n = Math.floor(n / 128); out.push(b | (n ? 128 : 0)); } while (n); return out; };
  let p = 8;
  const read = () => { let n = 0, shift = 0, b: number; do { if (p >= bytes.length || shift > 28) throw new Error('Invalid wasm integer'); b = bytes[p++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  const sections: {id: number; data: Uint8Array}[] = [];
  while (p < bytes.length) { const id = bytes[p++], len = read(), end = p + len; if (end > bytes.length) throw new Error('Invalid wasm section'); sections.push({id, data: bytes.slice(p, end)}); p = end; }
  // BGT imports are functions only. Reject new import kinds rather than misnumbering hidden state.
  let imports = 0;
  for (const s of sections) if (s.id === 2) {
    let q = 0;
    const u = () => { let n = 0, shift = 0, b; do { b = s.data[q++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
    const count = u();
    for (let i = 0; i < count; i++) { let n = u(); q += n; n = u(); q += n; if (s.data[q++] !== 0) throw new Error('Checkpoint mode requires function-only imports'); u(); imports++; }
  }
  const count = (id: number) => { const s = sections.find(s => s.id === id); if (!s) return 0; let q = 0, n = 0, shift = 0, b; do { b = s.data[q++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  if (count(5) !== 1 || sections.some(s => s.id === 8 || s.id === 13)) throw new Error('Checkpoint mode requires one memory, no start function or exception tags');
  // Passive segment drop state is engine-owned and cannot be observed through JS.
  // Fail closed for passive/declarative segments instead of producing incomplete snapshots.
  for (const id of [9,11]) {
    const section = sections.find(s => s.id === id); if (!section) continue;
    let q = 0;
    const u = () => { let n=0, shift=0, b; do { if(q>=section.data.length || shift>28) throw new Error('Invalid checkpoint segment'); b=section.data[q++]; n+=(b&127)*2**shift; shift+=7; } while(b&128); return n; };
    const expr = () => { for (;;) { const op=section.data[q++]; if(op===11) return;
      if(op===65 || op===66 || op===35 || op===210) { while(section.data[q++]&128) { /* LEB constant/index */ } }
      else if(op===67) q+=4; else if(op===68) q+=8; else throw new Error('Unsupported checkpoint constant expression');
      if(q>=section.data.length) throw new Error('Invalid checkpoint constant expression');
    } };
    const n = u();
    for(let i=0;i<n;i++) { const mode=u();
      if(id===11) { if(mode===2) u(); else if(mode!==0) throw new Error('Unsupported checkpoint passive data segment'); expr(); const size=u(); q+=size; }
      else { if(mode!==0 && mode!==2) throw new Error('Unsupported checkpoint passive/reference element segment'); if(mode===2) u(); expr(); if(mode===2) q++; const size=u(); for(let j=0;j<size;j++) u(); }
      if(q>section.data.length) throw new Error('Invalid checkpoint segment length');
    }
  }
  const memoryName = new TextEncoder().encode(prefix + 'memory');
  const additions: Uint8Array[] = [new Uint8Array([...uint(memoryName.length),...memoryName,2,0])];
  for (const [kind, tag, n] of [['f', 0, imports + count(3)], ['g', 3, count(6)], ['t', 1, count(4)]] as const)
    for (let i = 0; i < n; i++) { const name = new TextEncoder().encode(checkpointName(kind, i)); additions.push(new Uint8Array([...uint(name.length), ...name, tag, ...uint(i)])); }
  const exp = sections.find(s => s.id === 7);
  if (!exp) throw new Error('Checkpoint module requires exports');
  let q = 0; while (exp.data[q++] & 128) { /* skip old count */ }
  const chunks = [new Uint8Array(uint(count(7) + additions.length)), exp.data.slice(q), ...additions];
  exp.data = join(chunks);
  return join([bytes.slice(0, 8), ...sections.flatMap(s => [new Uint8Array([s.id, ...uint(s.data.length)]), s.data])]);
}
function join(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; } return out;
}

export interface WasmCheckpoint { memory: Uint8Array; globals: (number | bigint)[]; tables: (number | null)[][] }
export function captureWasm(exports: WebAssembly.Exports): WasmCheckpoint {
  if (exports[prefix+'memory'] !== exports.memory) throw new Error('Wasm was not instrumented for checkpoints before boot');
  const globals: (number | bigint)[] = [], tables: (number | null)[][] = [];
  for (let i = 0; ; i++) { const g = exports[checkpointName('g', i)] as WebAssembly.Global | undefined; if (!g) break;
    const v: unknown = g.value; if (typeof v !== 'number' && typeof v !== 'bigint') throw new Error('Unsupported checkpoint reference global');
    if (typeof v === 'number' && Number.isNaN(v)) throw new Error('Unsupported checkpoint NaN global payload'); globals.push(v);
  }
  const functions = new Map<unknown, number>();
  for (let i = 0; ; i++) { const f = exports[checkpointName('f', i)]; if (!f) break; functions.set(f, i); }
  for (let i = 0; ; i++) { const t = exports[checkpointName('t', i)] as WebAssembly.Table | undefined; if (!t) break;
    tables.push(Array.from({length: t.length}, (_, j) => { const f: unknown = t.get(j); if (f === null) return null;
      const index = functions.get(f); if (index === undefined) throw new Error('Unsupported checkpoint table reference'); return index; }));
  }
  return { memory: new Uint8Array((exports.memory as WebAssembly.Memory).buffer).slice(), globals, tables };
}
export function restoreWasm(exports: WebAssembly.Exports, state: WasmCheckpoint): void {
  const memory = exports.memory as WebAssembly.Memory;
  if (memory.buffer.byteLength > state.memory.length || state.memory.length % 65536) throw new Error('Invalid checkpoint memory size');
  memory.grow((state.memory.length - memory.buffer.byteLength) / 65536);
  new Uint8Array(memory.buffer).set(state.memory);
  state.globals.forEach((v, i) => { const g = exports[checkpointName('g', i)] as WebAssembly.Global;
    try { g.value = v; } catch { if (!Object.is(g.value, v)) throw new Error('Immutable checkpoint global mismatch'); }
  });
  state.tables.forEach((values, i) => { const t = exports[checkpointName('t', i)] as WebAssembly.Table;
    if (t.length > values.length) throw new Error('Invalid checkpoint table size');
    if (t.length < values.length) t.grow(values.length - t.length);
    values.forEach((index, j) => t.set(j, index === null ? null : exports[checkpointName('f', index)]));
  });
}
