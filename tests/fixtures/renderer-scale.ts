// SPDX-License-Identifier: CC0-1.0. Original checkerboard transfers at nonintegral scale.
import { GPU_OP as O } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame } from '../../bgt/renderers/recording';
export function rendererScaleFixture(source: number, dest: number, present: boolean, coordinates = false) {
  const frame = new Frame(); frame.reset(present?source:dest,present?source:dest);
  const send = (op: number, words: number[], extra = {}) => frame.items.push({kind:'gpu',op,words,...extra});
  const data=new Uint8Array(source*source*4);
  for(let y=0;y<source;y++)for(let x=0;x<source;x++)data.set(coordinates ? [x&255,y&255,(x>>8)|((y>>8)<<3),255] : [x%2*255,y%2*255,(x+y)%2*255,255],(y*source+x)*4);
  send(O.TEXTURE_CREATE,[1,source,source,1,0,3]); send(O.TEXTURE_UPDATE,[1,0,0,0,source,source,0,data.length],{data});
  const size=present?source:dest;
  send(O.BLIT,[1,0,0,0,0,source,source,0,0,size,size,0,1,0,0,0,size,size]);
  return recordFrame(frame,{x:0,y:0,w:dest,h:dest,scale:dest/size},0,dest,dest);
}
