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
  // JS Global.value can canonicalize NaN payloads. Export bitwise float readers/writers;
  // append helper functions/types only (all existing code/index identities stay unchanged).
  const floatGlobals: {index:number;type:number;mutable:boolean}[]=[];
  const gs=sections.find(s=>s.id===6);
  if(gs) {
    let q=0;
    const u=()=>{let n=0,shift=0,b;do{b=gs.data[q++];n+=(b&127)*2**shift;shift+=7;}while(b&128);return n;};
    const n=u();
    for(let index=0;index<n;index++) {
      const type=gs.data[q++],mutable=!!gs.data[q++];
      if(type===0x7d||type===0x7c)floatGlobals.push({index,type,mutable});
      else if(type!==0x7f&&type!==0x7e)throw new Error('Unsupported checkpoint global type');
      for(;;) {
        const op=gs.data[q++];if(op===11)break;
        if(op===65||op===66||op===35) {while(gs.data[q++]&128){/*LEB*/}}
        else if(op===67)q+=4;else if(op===68)q+=8;else throw new Error('Unsupported checkpoint global initializer');
        if(q>=gs.data.length)throw new Error('Invalid checkpoint global initializer');
      }
    }
  }
  const originalFunctions=imports+count(3), types=count(1), extraTypes:number[][]=[], extraFunctions:number[][]=[], extraBodies:number[][]=[], extraExports:Uint8Array[]=[];
  const helper=(name:string,type:number[],body:number[])=>{
    const n=new TextEncoder().encode(name),idx=originalFunctions+extraFunctions.length;
    extraExports.push(new Uint8Array([...uint(n.length),...n,0,...uint(idx)]));
    extraFunctions.push(uint(types+extraTypes.length));extraTypes.push(type);
    extraBodies.push([...uint(body.length+2),0,...body,11]);
  };
  for(const g of floatGlobals) {
    const bitType=g.type===0x7d?0x7f:0x7e;
    helper(checkpointName('bits',g.index),[0x60,0,1,bitType],[0x23,...uint(g.index),g.type===0x7d?0xbc:0xbd]);
    if(g.mutable)helper(checkpointName('setbits',g.index),[0x60,1,bitType,0],[0x20,0,g.type===0x7d?0xbe:0xbf,0x24,...uint(g.index)]);
  }
  const appendVector=(id:number,entries:number[][])=>{
    if(!entries.length)return;
    let s=sections.find(s=>s.id===id);
    if(s){let q=0;while(s.data[q++]&128){/*count*/}s.data=join([new Uint8Array(uint(count(id)+entries.length)),s.data.slice(q),...entries.map(e=>new Uint8Array(e))]);}
    else {s={id,data:join([new Uint8Array(uint(entries.length)),...entries.map(e=>new Uint8Array(e))])};const at=sections.findIndex(x=>x.id>id);sections.splice(at<0?sections.length:at,0,s);}
  };
  const memoryName = new TextEncoder().encode(prefix + 'memory');
  const additions: Uint8Array[] = [new Uint8Array([...uint(memoryName.length),...memoryName,2,0])];
  for (const [kind, tag, n] of [['f', 0, originalFunctions], ['g', 3, count(6)], ['t', 1, count(4)]] as const)
    for (let i = 0; i < n; i++) { const name = new TextEncoder().encode(checkpointName(kind, i)); additions.push(new Uint8Array([...uint(name.length), ...name, tag, ...uint(i)])); }
  additions.push(...extraExports);
  appendVector(1,extraTypes);appendVector(3,extraFunctions);appendVector(10,extraBodies);
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

function captureMemory(memory: WebAssembly.Memory): SparseMemory {
  const words=new Uint32Array(memory.buffer),bytes=new Uint8Array(memory.buffer),pages=new Map<number,Uint8Array<ArrayBuffer>>();
  for(let at=0;at<words.length;at+=16384) {
    let nonzero=false;for(let i=at;i<at+16384;i++)if(words[i]){nonzero=true;break;}
    if(nonzero)pages.set(at*4,bytes.slice(at*4,(at+16384)*4));
  }
  return {byteLength:bytes.length,pages};
}
export interface FloatBits { bits:number|bigint }
export interface SparseMemory { byteLength:number; pages:Map<number,Uint8Array<ArrayBuffer>> }
export interface WasmCheckpoint { memory: SparseMemory; globals: (number | bigint | FloatBits)[]; tables: (number | null)[][] }
export function captureWasm(exports: WebAssembly.Exports): WasmCheckpoint {
  if (exports[prefix+'memory'] !== exports.memory) throw new Error('Wasm was not instrumented for checkpoints before boot');
  const globals: WasmCheckpoint['globals'] = [], tables: (number | null)[][] = [];
  for (let i = 0; ; i++) { const g = exports[checkpointName('g', i)] as WebAssembly.Global | undefined; if (!g) break;
    const bits=exports[checkpointName('bits',i)] as (()=>number|bigint)|undefined;
    if(bits){globals.push({bits:bits()});continue;}
    const v: unknown = g.value; if (typeof v !== 'number' && typeof v !== 'bigint') throw new Error('Unsupported checkpoint reference global');
    globals.push(v);
  }
  const functions = new Map<unknown, number>();
  for (let i = 0; ; i++) { const f = exports[checkpointName('f', i)]; if (!f) break; functions.set(f, i); }
  for (let i = 0; ; i++) { const t = exports[checkpointName('t', i)] as WebAssembly.Table | undefined; if (!t) break;
    tables.push(Array.from({length: t.length}, (_, j) => { const f: unknown = t.get(j); if (f === null) return null;
      const index = functions.get(f); if (index === undefined) throw new Error('Unsupported checkpoint table reference'); return index; }));
  }
  return { memory: captureMemory(exports.memory as WebAssembly.Memory), globals, tables };
}
export function restoreWasm(exports: WebAssembly.Exports, state: WasmCheckpoint): void {
  const memory = exports.memory as WebAssembly.Memory;
  let globals=0,tables=0;
  while(exports[checkpointName('g',globals)])globals++;
  while(exports[checkpointName('t',tables)])tables++;
  if(state.globals.length!==globals||state.tables.length!==tables)throw new Error('Invalid checkpoint globals/tables length');
  if (memory.buffer.byteLength > state.memory.byteLength || state.memory.byteLength % 65536) throw new Error('Invalid checkpoint memory size');
  // Called only on a fresh instance. Clear its initialized data pages, not the entire
  // reserved (often 1 GiB) zero memory: touching every zero page commits physical RAM.
  const initial=captureMemory(memory);
  memory.grow((state.memory.byteLength - memory.buffer.byteLength) / 65536);
  const bytes=new Uint8Array(memory.buffer);
  for(const at of initial.pages.keys())bytes.fill(0,at,at+65536);
  for(const [at,data] of state.memory.pages) {
    if(at%65536 || at<0 || at+65536>bytes.length || data.length!==65536)throw new Error('Invalid checkpoint memory page');
    bytes.set(data,at);
  }
  state.globals.forEach((v, i) => { const g = exports[checkpointName('g', i)] as WebAssembly.Global;
    if(typeof v==='object') {
      const set=exports[checkpointName('setbits',i)] as ((v:number|bigint)=>void)|undefined;
      if(set)set(v.bits);else if((exports[checkpointName('bits',i)] as ()=>number|bigint)()!==v.bits)throw new Error('Immutable checkpoint float mismatch');
    } else try { g.value = v; } catch { if (!Object.is(g.value, v)) throw new Error('Immutable checkpoint global mismatch'); }
  });
  state.tables.forEach((values, i) => { const t = exports[checkpointName('t', i)] as WebAssembly.Table;
    if (t.length > values.length) throw new Error('Invalid checkpoint table size');
    if (t.length < values.length) t.grow(values.length - t.length);
    values.forEach((index, j) => t.set(j, index === null ? null : exports[checkpointName('f', index)]));
  });
}
