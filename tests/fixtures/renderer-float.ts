// SPDX-License-Identifier: CC0-1.0. Original native float16-conversion boundary and exact-format controls.
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame } from '../../bgt/renderers/recording';
export function rendererFloatFixture() {
  const frame = new Frame(); frame.reset(16,8);
  const f = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
  const send = (op: number, words: number[], extra = {}) => frame.items.push({kind:'gpu',op,words,...extra});
  for (const [h,stage,source] of [[1,1,'void main(){vec2 p=vec2(-1,-1);if(bgt_vertex_index==1u)p=vec2(3,-1);if(bgt_vertex_index==2u)p=vec2(-1,3);gl_Position=vec4(p,0.5,1);}'],
    [2,2,'layout(location=0) out vec4 result;void main(){result=vec4(0.1,0.2,0.3,0.6);}'],
    [3,2,'layout(location=0) out uvec4 result;void main(){result=uvec4(0x12345678u,0u,0u,1u);}'],
    [4,2,'layout(location=0) out vec4 result;void main(){result=vec4(0.25,0.5,0.75,1);}']] as const) {
    const text = '#version 330 core\n' + source;
    send(O.SHADER_CREATE,[h,stage,1,0,text.length,h],{source:text});
  }
  for (const [h,format] of [[1,4],[2,0],[3,17],[4,6],[5,0]]) send(O.TEXTURE_CREATE,[h,16,8,1,format,3]);
  for (const [h,format,fs,depth] of [[1,4,2,0xffffffff],[2,0,4,6],[3,17,3,0xffffffff],[5,0,2,0xffffffff]]) {
    send(O.PIPELINE_CREATE,[h,1,fs,3,0,0,depth,+(depth===6),+(depth===6),7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,1,format,0,1,0,0,1,0,0,15]);
  }
  const pass = (target: number, clear = false, depth = 0) => send(O.PASS_BEGIN,[1,depth,0,0,0,f(1),0,target,0,+clear,...[.1,.2,.3,.6].map(f)]);
  pass(1,true); send(O.PASS_END,[]);
  pass(1); send(O.CLEAR_BUFFER,[240,0,...[.1,.2,.3,.6].map(f)]); send(O.PASS_END,[]);
  for (const target of [1,2,3,5]) {
    pass(target,false,target===2?4:0); send(O.PIPELINE,[target]); send(O.DRAW,[3,1,0,0]); send(O.PASS_END,[]);
  }
  send(O.BLIT,[2,0,0,0,0,0,16,8,0,0,16,8,1,0,0,0,16,8]);
  return recordFrame(frame,{x:0,y:0,w:16,h:8,scale:1},0,16,8);
}
