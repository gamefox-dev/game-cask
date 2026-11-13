// SPDX-License-Identifier: CC0-1.0. Original 2D-engine-shaped native renderer workload.
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
export function rendererHotpathFixture() {
  const setup = new Frame(), frame = new Frame();
  setup.reset(32, 32); frame.reset(32, 32);
  const push = (f: Frame, op: number, words: number[], extra = {}) => f.items.push({kind:'gpu',op,words,...extra});
  const sources = [
    'void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[bgt_vertex_index],.5,1);}',
    'layout(std140) uniform bgt_u0 { vec4 color; };uniform sampler2D bgt_t0;layout(location=0) out vec4 result;void main(){result=color*texture(bgt_t0,vec2(.5));}',
  ];
  sources.forEach((body, i) => { const source = '#version 330 core\n'+body;
    push(setup,O.SHADER_CREATE,[i+1,i+1,1,0,source.length,i+1],{source}); });
  push(setup,O.BUFFER_CREATE,[1,4,16,0,0]);
  for (const h of [1,2,3]) push(setup,O.TEXTURE_CREATE,[h,h===3?1:32,h===3?1:32,1,0,3]);
  push(setup,O.SAMPLER_CREATE,[1,0,0,0,0,0,0,7]);
  push(setup,O.PIPELINE_CREATE,[1,1,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,1,1,0,0,1,0,0,1,0,0,1,0,0,15]);
  for (let group=0;group<16;group++) {
    push(frame,O.BUFFER_UPDATE,[1,0,0,16],{data:new Uint8Array(new Float32Array([1,0,0,1]).buffer)});
    push(frame,O.TEXTURE_UPDATE,[3,0,0,0,1,1,0,4],{data:new Uint8Array([255,255,255,255])});
    push(frame,O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,group===15?0:1+(group%2),0,1,0,0,0,0]);
    for (let draw=0;draw<8;draw++) {
      push(frame,O.PIPELINE,[1]); push(frame,O.UNIFORM_BUFFER,[0,1,0,16]); push(frame,O.TEXTURE,[0,3,1]);
      push(frame,O.SCISSOR,[0,0,32,32]); push(frame,O.DRAW,[3,1,0,0]);
    }
    push(frame,O.PASS_END,[]);
  }
  return {setup,frame};
}

/** K47: 40 engine batches; two stores re-specified per batch, a few uploads, stable FBOs.
 * recreate mirrors the pre-K47 profile wire stream; reuse mirrors equal-size BufferData.
 * varying deliberately retains delete/create: exact guest size must not become capacity. */
export function rendererOrphanFixture(reuse: boolean, varying = false) {
  const {setup} = rendererHotpathFixture(), frame = new Frame(); frame.reset(32,32);
  const push = (op: number, words: number[], extra = {}) => frame.items.push({kind:'gpu',op,words,...extra});
  setup.items.push({kind:'gpu',op:O.BUFFER_CREATE,words:[2,4,8,0,0]});
  for(let batch=0;batch<40;batch++) {
    for(const [h,base] of [[1,16],[2,8]]) {
      const size=base+(varying?(batch%2)*16:0);
      const data=new Uint8Array(size);
      if(h===1)data.set(new Uint8Array(new Float32Array([1,0,0,1]).buffer));
      if(reuse&&!varying)push(O.BUFFER_UPDATE,[h,0,0,size],{data});
      else {push(O.BUFFER_DELETE,[h]);push(O.BUFFER_CREATE,[h,4,size,0,size],{data});}
    }
    if(batch<3)push(O.TEXTURE_UPDATE,[3,0,0,0,1,1,0,4],{data:new Uint8Array([255,255,255,255])});
    push(O.PASS_BEGIN,[1,0,0,0,0,0x3f800000,0,batch===39?0:1+batch%2,0,1,0,0,0,0]);
    push(O.PIPELINE,[1]);push(O.UNIFORM_BUFFER,[0,1,0,16]);push(O.TEXTURE,[0,3,1]);
    // Redundant validated binds shape the ~700-command batch stream, without allocations.
    for(let i=0;i<7;i++)push(O.SCISSOR,[0,0,32,32]);
    push(O.DRAW,[3,1,0,0]);push(O.PASS_END,[]);
  }
  return {setup,frame};
}
