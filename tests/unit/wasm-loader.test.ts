import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { compileVerifiedWasm } from '../../bgt/runtime/wasm-loader';

const wasm = new Uint8Array([0,97,115,109,1,0,0,0]);
const expected = {size:wasm.length,sha256:createHash('sha256').update(wasm).digest('hex')};
const response = (type = 'application/wasm', bytes = wasm) => new Response(bytes,{headers:{'content-type':type}});

it('compiles a streamed response and reports each downloaded byte', async () => {
  let n=0;
  const r=await compileVerifiedWasm(response(),expected,(b)=>n+=b);
  expect(r.module).toBeInstanceOf(WebAssembly.Module);expect(r.streaming).toBe(true);expect(n).toBe(wasm.length);
  expect(r.downloadCompileVerifyMs).toBeGreaterThanOrEqual(0);
});
it.each(['application/octet-stream','text/plain',''])('falls back with MIME %s without a second fetch',async(type)=>{
  const r=await compileVerifiedWasm(response(type),expected);
  expect(r.module).toBeInstanceOf(WebAssembly.Module);expect(r.streaming).toBe(false);
});
it('falls back when compileStreaming is unavailable',async()=>{
  const original=WebAssembly.compileStreaming;
  try {
    Object.defineProperty(WebAssembly,'compileStreaming',{value:undefined,configurable:true,writable:true});
    expect((await compileVerifiedWasm(response(),expected)).streaming).toBe(false);
  } finally {Object.defineProperty(WebAssembly,'compileStreaming',{value:original,configurable:true,writable:true});}
});
it('does not return an unverified compiled module',async()=>{
  await expect(compileVerifiedWasm(response(),{...expected,sha256:'00'.repeat(32)})).rejects.toThrow(/integrity/);
});
it.each([7,9])('rejects wrong manifest size %i',async(size)=>{
  await expect(compileVerifiedWasm(response(),{...expected,size})).rejects.toThrow(/size/);
});
it('does not hide valid-MIME compile failures by falling back',async()=>{
  const invalid=new Uint8Array([1,2,3]);
  const metadata={size:3,sha256:createHash('sha256').update(invalid).digest('hex')};
  const spy=vi.spyOn(WebAssembly,'compile');
  await expect(compileVerifiedWasm(response('application/wasm',invalid),metadata)).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();spy.mockRestore();
});
it('bounds the source before teeing and cancels an oversized streaming response',async()=>{
  let pulled=0,cancelled=false;
  const body=new ReadableStream<Uint8Array>({
    pull(c) {pulled++;c.enqueue(pulled===1?wasm:new Uint8Array(16));},
    cancel() {cancelled=true;},
  },{highWaterMark:0});
  await expect(compileVerifiedWasm(new Response(body,{headers:{'content-type':'application/wasm'}}),expected)).rejects.toThrow(/size/);
  await new Promise((r)=>setTimeout(r,20));
  expect(cancelled).toBe(true);expect(pulled).toBeLessThan(5);
});
it('rejects HTTP errors before compilation',async()=>{
  await expect(compileVerifiedWasm(new Response('',{status:404}),expected)).rejects.toThrow(/404/);
});
