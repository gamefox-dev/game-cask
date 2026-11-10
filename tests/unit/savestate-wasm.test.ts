import { describe, expect, it } from 'vitest';
import binaryen from 'binaryen';
import { captureWasm, restoreWasm, instrumentCheckpointWasm, checkpointName } from '../../bgt/runtime/savestate-wasm';
import { exportSavestate, importSavestate } from '../../bgt/runtime/savestate-file';
import type { Savestate } from '../../bgt/runtime/savestates';
const wasm = (wat: string): Uint8Array<ArrayBuffer> => { const m = binaryen.parseText(wat); try { return new Uint8Array(m.emitBinary()); } finally { m.dispose(); } };
const module = `(module (memory (export "memory") 1 5) (global (mut i32) (i32.const 7))
 (global (mut i64) (i64.const 9007199254740993)) (table 2 4 funcref)
 (func $one (result i32) (i32.const 1)) (func $two (result i32) (i32.const 2))
 (elem (i32.const 0) $one $two))`;
describe('complete engine-state checkpoints',()=>{
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
    expect(state.memory[120000]).toBe(183);
    const imported=importSavestate(exportSavestate({schema:'bgt-savestate/1',host:{wasm:state}} as Savestate));
    expect(imported.host.wasm).toEqual(state);
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
