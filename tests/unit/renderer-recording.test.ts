// SPDX-License-Identifier: CC0-1.0
import { test, expect } from 'vitest';
import { Frame } from '../../bgt/runtime/commands';
import { recordFrame, restoreFrame } from '../../bgt/renderers/recording';
test('renderer recordings own every byte/word, preserve raw vertex color bits, omit only callbacks', () => {
  const frame = new Frame(); frame.reset(8, 4); frame.vertex(1, 2, 0.5, 1, 0xffc12345);
  const data = new Uint8Array([0, 128, 255]); const words = [3, 1, 3, 0, 3];
  frame.items.push({kind:'gpu', op:64, words, data, complete:()=>{throw new Error('not serialized');}});
  const record = recordFrame(frame,{x:0,y:0,w:8,h:4,scale:1},0,8,4);
  data.fill(42); words[0] = 99; frame.vertexBytes().fill(0);
  const restored = restoreFrame(JSON.parse(JSON.stringify(record)));
  expect(restored.vertexCount).toBe(1); expect(restored.u32[4]).toBe(0xffc12345);
  expect(restored.items[0]).toEqual({kind:'gpu',op:64,words:[3,1,3,0,3],data:new Uint8Array([0,128,255])});
});
