// SPDX-License-Identifier: CC0-1.0. Original multipass renderer-lifetime fixture.
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame, type RecordedFrame } from '../../bgt/renderers/recording';
export function rendererFrameFixture(): RecordedFrame[] {
  const frames: RecordedFrame[] = [], frame = new Frame();
  const f = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
  const send = (op: number, words: number[], extra = {}) => frame.items.push({kind:'gpu',op,words,...extra});
  const save = () => { frames.push(recordFrame(frame,{x:0,y:0,w:16,h:8,scale:1},frames.length,16,8)); frame.reset(16,8); };
  const color = (r: number, g: number, b: number, a: number) => send(O.BUFFER_UPDATE,[1,0,0,16],{data:new Uint8Array(new Float32Array([r,g,b,a]).buffer)});
  const pass = (h: number, clear = false) => send(O.PASS_BEGIN,[1,0,0,0,0,f(1),0,h,0,+clear,0,0,0,0]);
  const draw = (p: number) => { send(O.PIPELINE,[p]); send(O.UNIFORM_BUFFER,[0,1,0,16]); send(O.DRAW,[3,1,0,0]); };
  const blit = (s: number, d: number) => send(O.BLIT,[s,0,d,0,0,0,16,8,0,0,16,8,1,0,0,0,16,8]);
  frame.reset(16,8);
  for (const [h,stage,source] of [[1,1,'void main(){vec2 p=vec2(-1,-1);if(bgt_vertex_index==1u)p=vec2(3,-1);if(bgt_vertex_index==2u)p=vec2(-1,3);gl_Position=vec4(p,0.5,1);}'],
    [2,2,'layout(std140) uniform bgt_u0 { vec4 rgba; };layout(location=0) out vec4 result;void main(){result=rgba;}']] as const) {
    const text = '#version 330 core\n' + source;
    send(O.SHADER_CREATE,[h,stage,1,0,text.length,h],{source:text});
  }
  send(O.BUFFER_CREATE,[1,4,16,0,0]);
  for (const [h,format] of [[1,4],[2,0]]) {
    send(O.TEXTURE_CREATE,[h,16,8,1,format,3]);
    send(O.PIPELINE_CREATE,[h,1,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,1,0,0,0,1,format,1,1,1,0,1,1,0,15]);
  }
  save();
  color(0.25,0,0,0.5); pass(1,true); draw(1); send(O.PASS_END,[]);
  blit(1,2); color(0,0.5,0,0.5); pass(2); send(O.SCISSOR,[8,0,8,8]); draw(2); send(O.PASS_END,[]);
  blit(2,0); save();
  // Reuse BOTH namespaces; previous submitted draws must still refer to prior objects.
  send(O.BUFFER_DELETE,[1]); send(O.BUFFER_CREATE,[1,4,16,0,0]); color(0,0,1,1);
  send(O.TEXTURE_DELETE,[1]); send(O.TEXTURE_CREATE,[1,16,8,1,4,3]); pass(1,true); draw(1); send(O.PASS_END,[]);
  blit(1,2); blit(2,0); save();
  return frames;
}
