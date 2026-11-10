import { describe, expect, it } from 'vitest';
import binaryen from 'binaryen';
import { proveResidual } from '../../bgt/runtime/savestate-gpu';
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame } from '../../bgt/renderers/recording';
import { captureWasm, restoreWasm, instrumentCheckpointWasm, checkpointName } from '../../bgt/runtime/savestate-wasm';
import { exportSavestate, importSavestate } from '../../bgt/runtime/savestate-file';
import type { Savestate } from '../../bgt/runtime/savestates';
const wasm = (wat: string): Uint8Array<ArrayBuffer> => { const m = binaryen.parseText(wat); try { return new Uint8Array(m.emitBinary()); } finally { m.dispose(); } };
const module = `(module (memory (export "memory") 1 5) (global (mut i32) (i32.const 7))
 (global (mut i64) (i64.const 9007199254740993)) (table 2 4 funcref)
 (func $one (result i32) (i32.const 1)) (func $two (result i32) (i32.const 2))
 (elem (i32.const 0) $one $two))`;
describe('complete engine-state checkpoints',()=>{
  it('rejects missing or partial packed-stencil provenance, including dependencies used before their later clear',()=>{
    const rec=(items:Frame['items'],update:number)=>{const f=new Frame();f.reset(4,4);f.items=items;return recordFrame(f,{x:0,y:0,w:4,h:4,scale:1},update,4,4);};
    const begin=(depth:number,stencil:number)=>({kind:'gpu' as const,op:O.PASS_BEGIN,words:[0,1,0,depth,stencil,0,0]});
    // Initialization is now a proven constant. A potentially writing prefix draw
    // makes both aspects unavailable; all missing/partial-reset assertions stay strict.
    const create=rec([{kind:'gpu',op:O.TEXTURE_CREATE_EX,words:[1,0,4,4,1,1,5,3]},
      begin(0,0),{kind:'gpu',op:O.DRAW,words:[3,1,0,0]},{kind:'gpu',op:O.PASS_END,words:[]}],0);
    expect(()=>proveResidual([create],[])).toThrow(/no full/);
    expect(()=>proveResidual([create],[rec([begin(1,0)],1)])).toThrow(/no full/);
    const clear={kind:'gpu' as const,op:O.CLEAR_BUFFER,words:[3|12|16|(255<<8),0,0,0,0,0]};
    expect(()=>proveResidual([create],[rec([begin(0,0),clear],1)])).not.toThrow();
    expect(()=>proveResidual([create],[rec([begin(0,0),{kind:'gpu',op:O.SCISSOR,words:[0,0,2,4]},clear],1)])).toThrow(/no full/);
    expect(()=>proveResidual([create],[rec([{kind:'gpu',op:O.TEXTURE,words:[0,1,1]},begin(1,1)],1)])).toThrow(/consumed/);
    expect(()=>proveResidual([create],[rec([begin(1,1)],1)])).not.toThrow();
    expect(()=>proveResidual([create],[rec([{kind:'gpu',op:O.TEXTURE_DELETE,words:[1]}],1)])).not.toThrow();
  });
  it('restores unexported numeric globals, exact i64, grown memory and function table identities into a fresh instance',async()=>{
    const bytes=instrumentCheckpointWasm(wasm(module));
    const a=(await WebAssembly.instantiate(bytes)).instance.exports;
    const mem=a.memory as WebAssembly.Memory;mem.grow(2);new Uint8Array(mem.buffer)[120000]=183;
    const g=a[checkpointName('g',0)] as WebAssembly.Global;g.value=234;
    const table=a[checkpointName('t',0)] as WebAssembly.Table;table.grow(1);table.set(0,a[checkpointName('f',1)]);table.set(2,a[checkpointName('f',0)]);
    const state=captureWasm(a);
    g.value=998;new Uint8Array(mem.buffer)[120000]=17;table.set(0,null);
    const b=(await WebAssembly.instantiate(bytes)).instance.exports;restoreWasm(b,state);
    expect(captureWasm(b)).toEqual(state);
    expect((b[checkpointName('g',1)] as WebAssembly.Global).value).toBe(9007199254740993n);
    expect(((b[checkpointName('t',0)] as WebAssembly.Table).get(0) as ()=>number)()).toBe(2);
    expect(state.memory.pages.get(65536)![120000-65536]).toBe(183);
    expect(state.memory.byteLength).toBe(3*65536);
    expect(state.memory.pages.size).toBe(1);
    const imported=importSavestate(exportSavestate({schema:'bgt-savestate/1',host:{wasm:state}} as Savestate));
    expect(imported.host.wasm).toEqual(state);
  });
  it('roundtrips Infinity and exact f32/f64 NaN global payloads through file export, including mutable setters',async()=>{
    const bytes=instrumentCheckpointWasm(wasm(`(module (memory (export "memory") 1)
      (global (mut f32) (f32.const nan:0x412345)) (global (mut f64) (f64.const nan:0x8123456789abc))
      (global f64 (f64.const inf)) (global (mut f32) (f32.const -inf)))`));
    const a=(await WebAssembly.instantiate(bytes)).instance.exports,state=captureWasm(a);
    expect(state.globals[0]).toEqual({bits:0x7fc12345});
    expect(state.globals[1]).toEqual({bits:0x7ff8123456789abcn});
    const file=exportSavestate({schema:'bgt-savestate/1',host:{wasm:state}} as Savestate);
    const decoded=importSavestate(file),b=(await WebAssembly.instantiate(bytes)).instance.exports;
    (b[checkpointName('setbits',0)] as (v:number)=>void)(0);
    restoreWasm(b,decoded.host.wasm);expect(captureWasm(b)).toEqual(state);
    const arbitrary={schema:'bgt-savestate/1',values:[Infinity,-Infinity,NaN]} as unknown as Savestate;
    expect(importSavestate(exportSavestate(arbitrary))).toEqual(arbitrary);
  });
  it('refuses uninstrumented modules rather than silently missing their hidden globals',async()=>{
    const a=(await WebAssembly.instantiate(wasm(module))).instance.exports;
    expect(()=>captureWasm(a)).toThrow(/not instrumented/);
  });
  it('rejects engine-owned passive segment state and start functions',()=>{
    expect(()=>instrumentCheckpointWasm(wasm('(module (memory (export "memory") 1) (data "hello"))'))).toThrow(/passive/);
    expect(()=>instrumentCheckpointWasm(wasm('(module (memory (export "memory") 1) (func $start) (start $start))'))).toThrow(/start/);
  });
  it('roundtrips input/VFS/requests maps, sets, unsigned keys, bytes, bigint and negative zero',()=>{
    const state={schema:'bgt-savestate/1',host:{wasm:{globals:[-0,9007199254740993n]}},
      map:new Map([[23,new Uint8Array([0,255,1])]]),set:new Set([7,9]),keys:new Uint32Array([0xffffffff])} as unknown as Savestate;
    expect(importSavestate(exportSavestate(state))).toEqual(state);
    expect(()=>importSavestate('{"schema":"no"}')).toThrow(/Unsupported/);
  });
});
