// SPDX-License-Identifier: CC0-1.0
import { expect, it, vi } from 'vitest';
import { GameHost } from '../../bgt/runtime/host';
import { BACKEND_HEADLESS, GPU_OP } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { Vfs } from '../../bgt/runtime/vfs';
import { InputManager } from '../../bgt/input/input';
import { Savestates } from '../../bgt/runtime/savestates';
import { instrumentCheckpointWasm } from '../../bgt/runtime/savestate-wasm';
import type { BGTRuntime } from '../../bgt/runtime/runtime';
import { compileC } from '../support/compile';

function harness(budget?: {retained:number;workspace:number}) {
  const canvas = {width: 4, height: 4}, lb = {x: 0, y: 0, w: 4, h: 4, scale: 1};
  const renderer = {
    canvas, kind: 'webgl2', lost: false, finish: async () => {},
    inspectTestSurfaces: () => ({pixelBytes:64, shadows:{buffers:[],textures:[]}, lazy:new Map()}),
    captureTestSurfaces: vi.fn(async () => ({physical:{...canvas,data:new Uint8Array(64)}, buffers:[], textures:[], retained:false, letterbox:lb})),
  };
  const vfs = new Vfs(), input = new InputManager(canvas as HTMLCanvasElement);
  // This adapter does not require a browser GPU; the host, requests and frame recorder are real.
  const rt = {renderer, canvas, vfs, input, testQuiescent: () => true} as unknown as BGTRuntime;
  const states = new Savestates(rt, 1, budget);
  return {rt,states,renderer,canvas,lb,vfs};
}

it('keeps rolling GPU history across more than two journal windows of overlapping streamed reads', async () => {
  const {rt,states,lb,vfs}=harness();
  vfs.addStream('test.bin',1024);
  const outstanding = new Map<number, (bytes: Uint8Array<ArrayBuffer>)=>void>();
  const wasm = instrumentCheckpointWasm(await compileC('tests/fixtures/c/savestate-stream.c'));
  const host = rt.host = await GameHost.create(wasm, {
    vfs, log:()=>{}, now:()=>0, rangeRead: (_, at) => new Promise(resolve => outstanding.set(at, resolve)),
  }, {backend:BACKEND_HEADLESS,caps:0,seed:1,arg0:0,arg1:0,displayWidth:4,displayHeight:4});
  host.init();
  const frame = new Frame(); frame.reset(4,4);
  const resolve = (at:number) => {outstanding.get(at)!(new Uint8Array([at&255]));outstanding.delete(at);};
  const step = async () => {
    await host.update();
    const harness = rt.testHarness!;
    harness.updated(); harness.frame(frame,lb,host.frameIndex,4,4);
    await harness.afterFrame!();
  };
  let rollsWhilePending = 0;
  for(let i=0;i<600;i++) {
    await step();
    expect(host.requests.hasPending()).toBe(true);
    rollsWhilePending = states.journalStats().compactions;
    if(i>0)resolve(i-1); // leave the newest request pending across every render boundary
  }
  // Compaction isn't a guest snapshot: pending results still prevent the latter.
  await expect(states.snapshot()).rejects.toThrow(/pending|quiescent/i);
  resolve(599); await host.settleRequests();
  expect(host.requests.hasPending()).toBe(false);
  const snap = await states.snapshot();
  expect(snap.gpuBase?.frame.update).toBe(600);
  expect(snap.journal).toEqual([]);
  expect(rollsWhilePending).toBeGreaterThanOrEqual(4);
  expect(states.journalStats().error).toBeNull();
});

it('charges the previous base and input journal while a replacement base is being built', async () => {
  // Each empty base costs 320 estimated bytes. It fits by itself and the
  // retained journal is tiny, but two bases plus the next frame do not fit.
  const {rt,states,renderer,lb}=harness({retained:1024,workspace:750});
  const frame = new Frame(); frame.reset(4,4);
  const record=(update:number)=>rt.testHarness!.frame(frame,lb,update,4,4);
  record(1);await states.compactJournal();
  record(2);
  await expect(states.compactJournal()).rejects.toThrow(/bounded GPU capture workspace/);
  expect(renderer.captureTestSurfaces).toHaveBeenCalledTimes(1);
  expect(states.journalStats()).toMatchObject({frames:1,error:null});
});

it('drops a detached replay cursor whose native copy would exceed the retained cap',async()=>{
  const {rt,states,renderer,lb}=harness({retained:2000,workspace:10_000});
  // Draw into packed depth/stencil, then clear both aspects before the next draw.
  // The bounded cut replays into a detached renderer and normally parks it.
  const detached={...renderer,onError:()=>{},onLost:()=>{},restoreTestSurfaces:()=>{},
    resize:()=>{},drawFrame:async()=>null,presentationBytes:()=>1950,destroy:vi.fn(),
    gpu:{execute:()=>0}};
  vi.spyOn(states as unknown as {createRenderer: () => Promise<typeof detached>},'createRenderer').mockResolvedValue(detached);
  const frame = new Frame(); frame.reset(4,4);
  const item=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  frame.items=[item(GPU_OP.TEXTURE_CREATE_EX,[1,0,4,4,1,1,5,3]),
    item(GPU_OP.PASS_BEGIN,[0,1,0,0,0,0,0]),item(GPU_OP.DRAW,[3,1,0,0]),item(GPU_OP.PASS_END,[])];
  rt.testHarness!.frame(frame,lb,1,4,4);
  frame.items=[item(GPU_OP.PASS_BEGIN,[0,1,0,1,1,0x3f800000,0]),item(GPU_OP.DRAW,[3,1,0,0]),item(GPU_OP.PASS_END,[])];
  rt.testHarness!.frame(frame,lb,2,4,4);
  await states.compactJournal();
  expect(detached.destroy).toHaveBeenCalledOnce();
  expect(states.journalStats()).toMatchObject({frames:1,error:null});
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(2000);
});
