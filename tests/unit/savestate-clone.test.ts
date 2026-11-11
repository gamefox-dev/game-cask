// CC0. Aggregate checkpoint copying must not serialize into Chromium's ~2 GiB envelope.
import {it,expect,vi} from 'vitest';
import {cloneCheckpoint} from '../../bgt/runtime/savestate-clone';
it('clones byte leaves without aggregate serialization, preserving views, identities and cycles',()=>{
 const buffer=new ArrayBuffer(64),bytes=new Uint8Array(buffer,8,32),words=new Uint32Array(buffer,12,4);bytes.fill(73);
 const key={id:17},state={bytes,words,buffer,key,map:new Map([[key,bytes]]),set:new Set([words]),values:[-0,Infinity,9007199254740993n]};
 const cyclic={state,self:null as unknown};cyclic.self=cyclic;
 const spy=vi.spyOn(globalThis,'structuredClone').mockImplementation(()=>{throw new Error('Aggregate serialized');});
 try {
  const copy=cloneCheckpoint(cyclic);expect(copy).not.toBe(cyclic);expect(copy.self).toBe(copy);
  expect(copy.state.buffer).not.toBe(buffer);expect(copy.state.bytes.buffer).toBe(copy.state.buffer);expect(copy.state.words.buffer).toBe(copy.state.buffer);
  expect(copy.state.bytes.byteOffset).toBe(8);expect(copy.state.words.byteOffset).toBe(12);
  expect(copy.state.map.get(copy.state.key)).toBe(copy.state.bytes);expect(copy.state.set.has(copy.state.words)).toBe(true);
  expect(copy.state.values).toEqual(state.values);copy.state.bytes[0]=7;expect(bytes[0]).toBe(73);expect(spy).not.toHaveBeenCalled();
 } finally {spy.mockRestore();}
});
it('rejects completion callbacks instead of silently retaining functions',()=>{expect(()=>cloneCheckpoint({complete:()=>{}})).toThrow();});
