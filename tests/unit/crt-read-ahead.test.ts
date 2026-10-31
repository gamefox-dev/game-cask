import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { RangeFiles, OutsideDataRange } from '../../bgt/runtime/range-files';
import { compileC } from '../support/compile';

it('speculative FILE fills defer even cached/eager bytes and never become consumed slice coverage', async () => {
  const vfs=new Vfs();vfs.add('large',new Uint8Array(131072).fill(7));const file=vfs.openFile('large');
  const host=await GameHost.create(await compileC('tests/fixtures/c/legacy_v02.c'),{log:()=>{},vfs,now:()=>0},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0});
  host.init();
  const api=(host as any).imports().bgt;
  const id=api.asset_read_ahead(file,65535,0,65536);
  expect(api.request_status(id)).toBe(0);expect(vfs.coverage()).toEqual([]);
  expect(host.fileIo.readAheadBytes).toBe(1);expect(host.fileIo.consumedBytes).toBe(0);
  host.update();expect(api.request_status(id)).toBe(1);
  expect(api.request_read(id,4096,8)).toBe(1);expect(new Uint8Array(host.memory.buffer)[4096]).toBe(7);
  api.request_close(id);expect(api.asset_consumed(file,65535,0,1)).toBe(0);
  expect(host.fileIo.consumedBytes).toBe(1);expect(vfs.coverage()).toEqual([{path:'large',offset:0,length:65536}]);
  const ordinary=api.asset_range_request(file,65536,0,1);
  expect(api.request_status(ordinary)).toBe(0);host.update();expect(api.request_status(ordinary)).toBe(1);api.request_close(ordinary);
  expect(vfs.coverage()).toHaveLength(2); // Existing range requests retain their original coverage contract.
  expect(api.asset_observed(file,65536,0,1)).toBe(0);expect(host.fileIo.observedBytes).toBe(1);
  expect(api.asset_consumed(file,77,0,0)).toBe(0);expect(host.fileIo.consumedBytes).toBe(1);
  expect(api.asset_read_ahead(999,0,0,1)).toBeLessThan(0);
  expect(api.asset_consumed(file,0,0x200000,1)).toBeLessThan(0);
});

it('FILE speculation stops at the actual manifest chunk, and omitted data still raises OutsideDataRange', async () => {
  const bytes=new Uint8Array(4096).fill(9),hash=createHash('sha256').update(bytes).digest('hex');let fetched=0;
  const ranges=new RangeFiles('',async()=>{fetched++;return new Response(bytes);});
  ranges.add({path:'slice',size:8192,chunkSize:4096,chunks:[{offset:0,size:4096,url:'a',sha256:hash},{offset:4096,size:4096,url:'b',sha256:hash,missing:true}]});
  const vfs=new Vfs();vfs.addStream('slice',8192,[{offset:0,size:4096},{offset:4096,size:4096}]);
  const file=vfs.openFile('slice');
  expect(vfs.consume(file,4094,0)).toBe(0);expect(vfs.consume(file,8192,4)).toBe(0);expect(vfs.coverage()).toEqual([]);
  expect(vfs.consume(file,4094,1)).toBe(0);
  expect(vfs.coverage()).toEqual([{path:'slice',offset:0,length:4096}]);
  expect(vfs.consumedBytes).toBe(1);
  const fill=await ranges.read('slice',4094,16384,true);
  expect([...fill]).toEqual([9,9]);expect(fetched).toBe(1);expect(ranges.coverage()).toEqual([]);
  const cached=await ranges.read('slice',0,16384,true);expect(cached.length).toBe(4096);expect(fetched).toBe(1);
  await expect(ranges.read('slice',4096,1,true)).rejects.toBeInstanceOf(OutsideDataRange);
  expect(fetched).toBe(1);expect(ranges.coverage()).toEqual([]);
  await expect(ranges.read('slice',4096,1)).rejects.toBeInstanceOf(OutsideDataRange);
  expect(ranges.coverage()).toEqual([{path:'slice',offset:4096,length:4096}]);
});
