import { it, expect } from 'vitest';
import { compareGpuImages, type Image } from '../support/gpu-image';
const image=(x:number):Image=>{
  const data=new Uint8Array(8*8*4);
  for(let y=2;y<6;y++) for(let i=x;i<x+3;i++) data[(y*8+i)*4]=255;
  return {width:8,height:8,data};
};
it('GPU image comparator permits only bounded symmetric one-pixel RGB movement, not missing or recolored shapes',()=>{
  expect(compareGpuImages(image(2),image(2))).toEqual({different:0,unmatched:0});
  expect(compareGpuImages(image(2),image(3)).unmatched).toBe(0);
  expect(compareGpuImages(image(2),image(4)).unmatched).toBeGreaterThan(0);
  const missing=image(2);missing.data.fill(0);
  expect(compareGpuImages(image(2),missing).unmatched).toBeGreaterThan(0);
  const recolored=image(2);for(let i=0;i<recolored.data.length;i+=4)recolored.data[i+1]=127;
  expect(compareGpuImages(image(2),recolored).unmatched).toBeGreaterThan(0);
});
