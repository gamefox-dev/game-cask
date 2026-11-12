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
});
it('debug retains per-command native error attribution and drains before the next command',()=>{
  const {gpu,g,errors}=setup(true);g.getError.mockReturnValueOnce(0x502);
  expect(gpu.execute({kind:'gpu',op:O.VERTEX_BUFFER,words:[0,1,0]})).toBe(-6);
  expect(gpu.execute({kind:'gpu',op:O.VERTEX_BUFFER,words:[0,1,0]})).toBe(0);
  expect(errors).toEqual(['GPU op 0x53: GL error 0x502']);expect(g.getError).toHaveBeenCalledTimes(3);
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
