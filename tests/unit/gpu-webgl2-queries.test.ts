// SPDX-License-Identifier: CC0-1.0
import { expect, it, vi } from 'vitest';
import { WebGL2Gpu } from '../../bgt/renderers/webgl2/gpu';
import { GPU_OP as O } from '../../bgt/runtime/abi';
function setup(debug=false) {
  const errors:string[]=[], getError=vi.fn(()=>0), checkFramebufferStatus=vi.fn(()=>100);
  const g={NO_ERROR:0,FRAMEBUFFER_COMPLETE:100,FRAMEBUFFER:101,MAX_ELEMENT_INDEX:102,MAX_DRAW_BUFFERS:103,
    getError,checkFramebufferStatus,isContextLost:()=>false,getExtension:()=>({}),getParameter:()=>65536,
    createFramebuffer:()=>({}),createBuffer:()=>({}),deleteBuffer:vi.fn()};
  const gpu=new WebGL2Gpu(g as unknown as WebGL2RenderingContext,e=>errors.push(e),{debug});
  const state=gpu as unknown as {imageKey:(t:WebGLTexture|null,m:number)=>string;checkFramebuffer:(t:number,k:string,m:string)=>void;completeFramebuffers:Set<string>};
  return {gpu,state,g,errors};
}
it('validated hot bindings do not poll native errors; frame poll retains production diagnostics',()=>{
  const {gpu,g,errors}=setup();
  for(let i=0;i<100;i++)expect(gpu.execute({kind:'gpu',op:O.VERTEX_BUFFER,words:[0,1,0]})).toBe(0);
  expect(g.getError).not.toHaveBeenCalled();
  g.getError.mockReturnValueOnce(0x502);
  gpu.checkNativeError();expect(errors).toEqual(['WebGL error 0x502']);
  gpu.checkNativeError();expect(errors).toHaveLength(1);expect(g.getError).toHaveBeenCalledTimes(2);
  expect(gpu.nativeSyncQueries).toEqual({getError:2,checkFramebufferStatus:0,generatedBufferReadbacks:0});
});
it('synchronous transactions drain errors from earlier unchecked work before attribution',()=>{
  const {gpu,g,errors}=setup();
  const state=gpu as unknown as {dispatch:(item:{complete?:(code:number)=>void;readback?:(data:Uint8Array)=>void})=>void};
  state.dispatch=item=>{item.complete?.(0);item.readback?.(new Uint8Array(16));};
  const sequence=[0x500,0,0];
  g.getError.mockImplementation(()=>sequence.shift() ?? 0);
  const complete=vi.fn();
  expect(gpu.execute({kind:'gpu',op:O.SHADER_CREATE,words:[1,1,1,0,0,1],complete})).toBe(0);
  expect(complete).toHaveBeenCalledExactlyOnceWith(0,undefined);
  expect(errors).toEqual(['Earlier unpolled work: WebGL error 0x500']);
  expect(gpu.nativeSyncQueries.getError).toBe(3);

  sequence.push(0x501,0);
  const readback=vi.fn();
  expect(gpu.execute({kind:'gpu',op:O.BUFFER_READBACK,words:[1,0,16,10],readback})).toBe(0);
  expect(readback).toHaveBeenCalledExactlyOnceWith(new Uint8Array(16),undefined);
  expect(errors).toEqual(['Earlier unpolled work: WebGL error 0x500','Earlier unpolled work: WebGL error 0x501']);
});
it('a non-draining native queue is bounded and never dispatches a contaminated transaction',()=>{
  const {gpu,g,errors}=setup();
  const state=gpu as unknown as {dispatch:(item:unknown)=>void};
  state.dispatch=vi.fn();g.getError.mockReturnValue(0x502);
  const complete=vi.fn();
  expect(gpu.execute({kind:'gpu',op:O.SHADER_CREATE,words:[1,1,1,0,0,1],complete})).toBe(-6);
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(g.getError).toHaveBeenCalledTimes(64);
  expect(complete).toHaveBeenCalledExactlyOnceWith(-6,expect.stringContaining('did not drain'));
  expect(errors).toHaveLength(32);
});
it('debug retains per-command native error attribution and drains before the next command',()=>{
  const {gpu,g,errors}=setup(true);g.getError.mockReturnValueOnce(0).mockReturnValueOnce(0x502);
  expect(gpu.execute({kind:'gpu',op:O.VERTEX_BUFFER,words:[0,1,0]})).toBe(-6);
  expect(gpu.execute({kind:'gpu',op:O.VERTEX_BUFFER,words:[0,1,0]})).toBe(0);
  expect(errors).toEqual(['GPU op 0x53: GL error 0x502']);expect(g.getError).toHaveBeenCalledTimes(5);
});
it('completeness caches by immutable native generation and mip, never by recycled guest name',()=>{
  const {state,g}=setup(), a={} as WebGLTexture,b={} as WebGLTexture;
  const check=(t:WebGLTexture,m:number)=>state.checkFramebuffer(101,'pass:'+state.imageKey(t,m),'incomplete');
  check(a,0);check(a,0);expect(g.checkFramebufferStatus).toHaveBeenCalledTimes(1);
  check(a,1);check(b,0);expect(g.checkFramebufferStatus).toHaveBeenCalledTimes(3);
  expect(state.imageKey(a,0)).not.toBe(state.imageKey(b,0));
  g.checkFramebufferStatus.mockReturnValueOnce(0x8cd6);
  expect(()=>check(b,1)).toThrow('incomplete');check(b,1);expect(g.checkFramebufferStatus).toHaveBeenCalledTimes(5);
});
it('debug rechecks cached attachments and production cache remains bounded',()=>{
  const {state,g}=setup(true);state.checkFramebuffer(101,'same','bad');state.checkFramebuffer(101,'same','bad');
  expect(g.checkFramebufferStatus).toHaveBeenCalledTimes(2);
  for(let i=0;i<1000;i++)state.checkFramebuffer(101,String(i),'bad');
  expect(state.completeFramebuffers.size).toBeLessThanOrEqual(256);
});
it('query counters reset per frame; restoration invalidates successful completeness',()=>{
  const {gpu,state,g}=setup();
  state.checkFramebuffer(101,'same','bad');gpu.checkNativeError();
  expect(gpu.nativeSyncQueries).toEqual({getError:1,checkFramebufferStatus:1,generatedBufferReadbacks:0});
  gpu.beginFrame(1,1,{x:0,y:0,w:1,h:1,scale:1});
  expect(gpu.nativeSyncQueries).toEqual({getError:0,checkFramebufferStatus:0,generatedBufferReadbacks:0});
  state.checkFramebuffer(101,'same','bad');expect(gpu.nativeSyncQueries.checkFramebufferStatus).toBe(0);
  gpu.restore();state.checkFramebuffer(101,'same','bad');
  expect(g.checkFramebufferStatus).toHaveBeenCalledTimes(2);
  expect(gpu.nativeSyncQueries.checkFramebufferStatus).toBe(1);
});
it('generated wide-stride packing reads real native bytes and counts only the correctness exception',()=>{
  const {gpu,g}=setup(), packed:Uint8Array[]=[];
  const read=vi.fn((_target:number,_offset:number,out:Uint8Array)=>{out[0]=17;out[256]=29;});
  Object.assign(g,{uniform4f:vi.fn(),uniform1i:vi.fn(),uniform1ui:vi.fn(),activeTexture:vi.fn(),bindSampler:vi.fn(),
    createTexture:()=>({}),bindTexture:vi.fn(),texImage2D:vi.fn(),texParameteri:vi.fn(),bindBuffer:vi.fn(),
    getBufferSubData:read,bufferData:(_target:number,data:Uint8Array)=>packed.push(data.slice()),
    enableVertexAttribArray:vi.fn(),vertexAttribPointer:vi.fn(),vertexAttribDivisor:vi.fn(),drawArraysInstanced:vi.fn()});
  const words=new Array<number>(32).fill(0);words[23]=1;words[24]=1;words[26]=256;
  const data=new Uint8Array(512);data[0]=3;data[256]=5;
  const buffer={object:{},data,generated:true};
  const state=gpu as unknown as {pipeline:unknown;vertices:Map<number,number[]>;buffers:Map<number,unknown>;draw:(w:number[],indexed:boolean)=>void};
  state.pipeline={words,locations:new Map(),uniformBlockSizes:new Map()};
  state.vertices.set(0,[0,1,0]);state.buffers.set(1,buffer);
  state.draw([2,1,0,0],false);
  expect(read).toHaveBeenCalledTimes(1);expect([...packed[0]]).toEqual([17,0,0,0,29,0,0,0]);
  expect(gpu.nativeSyncQueries.generatedBufferReadbacks).toBe(1);
  buffer.generated=false;state.draw([2,1,0,0],false);
  expect(read).toHaveBeenCalledTimes(1);expect([...packed[1]]).toEqual([3,0,0,0,5,0,0,0]);
  expect(gpu.nativeSyncQueries.generatedBufferReadbacks).toBe(1);
});
