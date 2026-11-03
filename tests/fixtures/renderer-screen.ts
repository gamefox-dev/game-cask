// SPDX-License-Identifier: CC0-1.0. Original opaque default-screen/real offscreen-alpha regression.
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame, type RecordedFrame } from '../../bgt/renderers/recording';
export function rendererScreenFixture(): RecordedFrame[] {
  const frame = new Frame(), frames: RecordedFrame[] = [];
  const f = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
  const send = (op: number, words: number[], extra = {}) => frame.items.push({kind:'gpu',op,words,...extra});
  const save = () => { frames.push(recordFrame(frame,{x:0,y:0,w:16,h:8,scale:1},frames.length,16,8)); frame.reset(16,8); };
  const pass = (h: number, clear = false) => send(O.PASS_BEGIN,[1,0,0,0,0,f(1),0,h,0,+clear,f(.25),0,0,f(.5)]);
  const draw = () => { send(O.PIPELINE,[1]); send(O.DRAW,[3,1,0,0]); };
  const blit = (s: number, d: number) => send(O.BLIT,[s,0,d,0,0,0,16,8,0,0,16,8,1,0,0,0,16,8]);
  frame.reset(16,8);
  for (const [h,stage,source] of [[1,1,'void main(){vec2 p=vec2(-1,-1);if(bgt_vertex_index==1u)p=vec2(3,-1);if(bgt_vertex_index==2u)p=vec2(-1,3);gl_Position=vec4(p,0.5,1);}'],
    [2,2,'layout(location=0) out vec4 result;void main(){result=vec4(0,0.5,0,0.25);}']] as const) {
    const text = '#version 330 core\n' + source;
    send(O.SHADER_CREATE,[h,stage,1,0,text.length,h],{source:text});
  }
  for (const h of [1,2]) send(O.TEXTURE_CREATE,[h,16,8,1,0,3]);
  // RGB = source * DST_ALPHA; alpha = source. Screen loads must see 1, offscreen loads see 128/255.
  send(O.PIPELINE_CREATE,[1,1,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,1,0,1,8,0,0,1,0,0,15]);
  save();
  pass(1,true); send(O.PASS_END,[]); blit(1,0); blit(0,2); save();
  pass(0); draw(); send(O.PASS_END,[]); blit(0,2);
  pass(1); draw(); send(O.PASS_END,[]); save();
  // Screen clear with fractional alpha and a scissored RGB-only clear must become opaque on completion.
  pass(0,true); send(O.SCISSOR,[8,0,8,8]);
  send(O.CLEAR_BUFFER,[0 | (1<<4),0,f(1),0,0,0]); send(O.PASS_END,[]); blit(0,2); save();
  return frames;
}
