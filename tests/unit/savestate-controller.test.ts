// SPDX-License-Identifier: CC0-1.0
import { expect, it, vi } from 'vitest';
import { GameHost } from '../../bgt/runtime/host';
import { BACKEND_HEADLESS, GPU_OP } from '../../bgt/runtime/abi';
import { Frame } from '../../bgt/runtime/commands';
import { Vfs } from '../../bgt/runtime/vfs';
import { InputManager } from '../../bgt/input/input';
import { Savestates } from '../../bgt/runtime/savestates';
import { replayGPU } from '../../bgt/runtime/savestate-gpu';
import { ReplayAllocations, checkGPUBytes, paddedReadbackBytes, textureReadbackStagingBytes } from '../../bgt/runtime/savestate-budget';
import { recordCheckpointFrame } from '../../bgt/runtime/savestate-recording';
import { instrumentCheckpointWasm } from '../../bgt/runtime/savestate-wasm';
import type { BGTRuntime } from '../../bgt/runtime/runtime';
import type { GpuItem } from '../../bgt/renderers/types';
import { compileC } from '../support/compile';

function harness(budget?: {retained:number;workspace:number}) {
  const canvas = {width: 4, height: 4}, lb = {x: 0, y: 0, w: 4, h: 4, scale: 1};
  const renderer = {
    canvas, kind: 'webgl2', lost: false, finish: async () => {},
    inspectTestSurfaces: () => ({pixelBytes:64, pixelStagingBytes:64, shadows:{buffers:[],textures:[]}, lazy:new Map()}),
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

it('rolls for retained headroom below the fixed frame, byte and command triggers',async()=>{
  const {rt,states,lb}=harness({retained:820,workspace:4096});
  const frame=new Frame();frame.reset(4,4);
  const hooks=rt.testHarness!;
  const record=async(update:number,clears:number)=>{
    frame.items=Array.from({length:clears},()=>({kind:'draw' as const,first:0,count:0,texture:0,filter:0,blend:0,clip:{x:0,y:0,w:4,h:4},target:0}));
    hooks.frame(frame,lb,update,4,4);await hooks.afterFrame!();
  };
  await record(1,0);await states.compactJournal();
  await record(2,1);await record(3,1);
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(820);
});

it('tries the consumed over-cap frame before dropping history',async()=>{
  const {rt,states,lb}=harness({retained:820,workspace:4096});
  const frame=new Frame();frame.reset(4,4);
  const hooks=rt.testHarness!;
  hooks.frame(frame,lb,1,4,4);await hooks.afterFrame!();await states.compactJournal();
  // Without compaction no residual can fit beside the current base.
  frame.items=Array.from({length:6},()=>({kind:'draw' as const,first:0,count:0,texture:0,filter:0,blend:0,clip:{x:0,y:0,w:4,h:4},target:0}));
  hooks.frame(frame,lb,2,4,4);await hooks.afterFrame!();
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(820);
});

it('tries an earlier cut when the live end is safe but its base cannot fit',async()=>{
  const {rt,states,renderer,lb}=harness({retained:700,workspace:8192});
  const detached={...renderer,onError:()=>{},onLost:()=>{},resize:()=>{},drawFrame:async()=>null,
    destroy:()=>{},gpu:{execute:()=>0}};
  vi.spyOn(states as unknown as {createRenderer: () => Promise<typeof detached>},'createRenderer').mockResolvedValue(detached);
  const frame=new Frame();frame.reset(4,4);
  const hooks=rt.testHarness!;
  hooks.frame(frame,lb,1,4,4);await hooks.afterFrame!();
  frame.items=[{kind:'gpu',op:GPU_OP.BUFFER_CREATE,words:[1,1,1024,0,0]}];
  hooks.frame(frame,lb,2,4,4);await hooks.afterFrame!();
  // Both cuts are logically safe. The latest needs 1024 readback bytes, so
  // keep the smaller previous base plus the command that creates the buffer.
  await states.compactJournal();
  expect(states.journalStats()).toMatchObject({frames:1,error:null});
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(700);
});

it('recovers capture after an over-cap packed prefix once a live cut becomes provable',async()=>{
  const {rt,states,renderer,lb}=harness({retained:1500,workspace:4096});
  const frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  const hooks=rt.testHarness!;
  frame.items=[cmd(GPU_OP.TEXTURE_CREATE_EX,[1,0,4,4,1,1,5,3]),
    cmd(GPU_OP.PASS_BEGIN,[0,1,0,0,0,0,0]),...Array.from({length:14},()=>cmd(GPU_OP.DRAW,[3,1,0,0])),cmd(GPU_OP.PASS_END,[])];
  hooks.frame(frame,lb,1,4,4);await hooks.afterFrame!();
  expect(states.journalStats()).toMatchObject({frames:0,error:expect.stringMatching(/safe cut/)});
  expect(renderer.captureTestSurfaces).not.toHaveBeenCalled();
  frame.items=[cmd(GPU_OP.PASS_BEGIN,[0,1,0,1,1,0x3f800000,3]),cmd(GPU_OP.PASS_END,[])];
  hooks.frame(frame,lb,2,4,4);await hooks.afterFrame!();
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
  expect(renderer.captureTestSurfaces).toHaveBeenCalledOnce();
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(1500);
});

it.each([false,true])('recovers after GPU byte pressure with a surviving legacy texture (target=%s)',async renderTarget=>{
  const budget={retained:1600,workspace:1700};
  const {rt,states,renderer,lb}=harness(budget);
  const frame=new Frame();frame.reset(4,4);
  const step=async(update:number,items:typeof frame.items)=>{
    frame.items=items;rt.testHarness!.frame(frame,lb,update,4,4);await rt.testHarness!.afterFrame!();
  };
  const shadow=Uint8Array.from({length:64},(_,i)=>i);
  const native=new Uint8Array(64).fill(211);
  const readTestLegacyTarget=vi.fn(async()=>native.slice());
  const drawFrame=vi.fn();
  Object.assign(renderer,{readTestLegacyTarget,drawFrame});
  const host=rt.host=await GameHost.create(instrumentCheckpointWasm(await compileC('tests/fixtures/c/legacy_v02.c')),
    {vfs:rt.vfs,log:()=>{},now:()=>0},
    {backend:BACKEND_HEADLESS,caps:0,seed:1,arg0:0,arg1:0,displayWidth:4,displayHeight:4});
  host.init();host.textures.entries.set(7,{width:4,height:4,renderTarget,shadow});host.textures.totalBytes=shadow.length;
  // The input journal overflows workspace and the large live buffer would not
  // fit in a base either. The legacy uploads are discarded with the journal.
  await step(1,[{kind:'texCreate',handle:7,width:4,height:4,renderTarget},
    {kind:'texUpdate',handle:7,x:0,y:0,w:4,h:4,data:shadow.slice()},
    {kind:'gpu',op:GPU_OP.BUFFER_CREATE,words:[1,1,4096,0,0]},
    ...Array.from({length:16},()=>({kind:'texUpdate' as const,handle:7,x:0,y:0,w:1,h:1,data:shadow.slice(0,4)}))]);
  expect(states.journalStats()).toMatchObject({frames:0,error:expect.stringMatching(/bounded GPU capture workspace/)});
  expect(renderer.captureTestSurfaces).not.toHaveBeenCalled();
  await step(2,[]); // still too much live data for a compact base
  expect(states.journalStats().error).not.toBeNull();
  expect(renderer.captureTestSurfaces).not.toHaveBeenCalled();
  await step(3,[{kind:'gpu',op:GPU_OP.BUFFER_DELETE,words:[1]}]);
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
  expect(states.journalStats().retainedBytes).toBeLessThanOrEqual(budget.retained);
  expect(drawFrame).not.toHaveBeenCalled(); // a read-only cut must not redraw the live canvas
  expect(readTestLegacyTarget).toHaveBeenCalledTimes(renderTarget?1:0);
  const snapshot=await states.snapshot();
  expect(snapshot.gpuBase?.frame.items.filter(i=>i.kind==='texUpdate')).toEqual([
    expect.objectContaining({handle:7,data:renderTarget?native:shadow}),
  ]);
  shadow.fill(0);
  expect(snapshot.gpuBase?.frame.items.find(i=>i.kind==='texUpdate')?.data).not.toEqual(shadow);
});

it.each(['rewrite','delete','repeated writes','repeated name reuse'])('backs off failed live readback and handles texture %s',async action=>{
  const {rt,states,renderer,lb}=harness({retained:1600,workspace:8192});
  const frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[]):GpuItem=>({kind:'gpu',op,words});
  let pixel=NaN;
  const readback=vi.fn((item:GpuItem)=>{
    expect(item.op).toBe(GPU_OP.TEXTURE_READBACK);
    item.readback!(new Uint8Array(new Float32Array(16).fill(pixel).buffer));return 0;
  });
  Object.assign(renderer,{gpu:{execute:readback}});
  const hooks=rt.testHarness!;
  const step=async(update:number,items:typeof frame.items)=>{
    frame.items=items;hooks.frame(frame,lb,update,4,4);await hooks.afterFrame!();
  };
  const clear=[cmd(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,0,0,1,0,0,0,0]),cmd(GPU_OP.PASS_END,[])];
  await step(1,[cmd(GPU_OP.TEXTURE_CREATE_EX,[1,0,4,4,1,1,10,3]),...Array.from({length:8},()=>clear).flat()]);
  expect(states.journalStats().error).toMatch(/non-finite GPU texture checkpoint/);
  expect(readback).toHaveBeenCalledOnce();
  const reuse=action==='repeated name reuse', repeated=reuse||action==='repeated writes';
  const write=[cmd(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,1,0,1,0,0,0,0]),cmd(GPU_OP.PASS_END,[])];
  for(let update=2;update<=32;update++){
    const create=update%2?cmd(GPU_OP.TEXTURE_CREATE,[1,4,4,1,10,3]):cmd(GPU_OP.TEXTURE_CREATE_EX,[1,0,4,4,1,1,10,3]);
    await step(update,reuse?[cmd(GPU_OP.TEXTURE_DELETE,[1]),create,...write]:repeated?write:clear);
  }
  expect(readback).toHaveBeenCalledTimes(repeated?2:1); // unrelated writes never wake; repeated writes wake once
  await step(33,[]);
  expect(readback).toHaveBeenCalledTimes(repeated?3:2);
  expect(states.journalStats().error).not.toBeNull();
  pixel=0.5;
  const data=new Uint8Array(new Float32Array(16).fill(pixel).buffer);
  await step(34,action==='rewrite'?[{...cmd(GPU_OP.TEXTURE_UPDATE_EX,[1,0,0,0,0,4,4,1,1,64]),data}]:[cmd(GPU_OP.TEXTURE_DELETE,[1])]);
  expect(readback).toHaveBeenCalledTimes(action==='delete'?2:3);
  expect(renderer.captureTestSurfaces).toHaveBeenCalledTimes(repeated?4:3);
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
});

it('keys the readback cooldown to the failed legacy target across delete and recreate',async()=>{
  const {rt,states,renderer,lb}=harness({retained:1600,workspace:8192});
  const readTestLegacyTarget=vi.fn(async(handle:number,_w:number,_h:number)=>{
    if(handle===7)throw new Error('unreadable legacy target');
    return new Uint8Array(64);
  });
  const failedReads=()=>readTestLegacyTarget.mock.calls.filter(([handle])=>handle===7).length;
  Object.assign(renderer,{readTestLegacyTarget});
  const frame=new Frame();frame.reset(4,4);
  const step=async(update:number,items:typeof frame.items)=>{
    frame.items=items;rt.testHarness!.frame(frame,lb,update,4,4);await rt.testHarness!.afterFrame!();
  };
  const create=(handle:number)=>({kind:'texCreate' as const,handle,width:4,height:4,renderTarget:true});
  const remove=(handle:number)=>({kind:'texDelete' as const,handle});
  const upload={kind:'texUpdate' as const,handle:7,x:0,y:0,w:1,h:1,data:new Uint8Array(4)};
  await step(1,[create(7),create(8),...Array(16).fill(upload)]); // force an over-cap live cut
  expect(states.journalStats().error).toMatch(/unreadable legacy target/);
  expect(readTestLegacyTarget).toHaveBeenCalledExactlyOnceWith(7,4,4);
  for(let update=2;update<=8;update++)await step(update,[remove(7),create(7),upload]);
  expect(failedReads()).toBe(2); // one retry, not one per replacement
  await step(9,[remove(8)]); // an unrelated deletion must not reset the cooldown either
  expect(failedReads()).toBe(2);
  await step(10,[remove(7)]);
  expect(states.journalStats()).toMatchObject({frames:0,compactions:1,error:null});
});

it('charges narrow WebGPU rows and both allocations in depth readback',()=>{
  const extent={width:1,height:64,depth:1};
  expect(paddedReadbackBytes(4,64)).toBe(16_384);
  expect(textureReadbackStagingBytes('webgpu',0,extent)).toBe(16_384);
  expect(textureReadbackStagingBytes('webgpu',6,extent)).toBe(17_408);
  expect(textureReadbackStagingBytes('webgl2',6,extent)).toBe(2_048);
});

it('reserves queued self-blit copies and stencil fallback planes before replay',()=>{
  const {lb}=harness(), frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  const blit=cmd(GPU_OP.BLIT,[1,0,1,0,0,0,4,4,0,0,2,2,4,0,0,0,2,2]);
  frame.items=[cmd(GPU_OP.TEXTURE_CREATE_EX,[1,0,4,4,1,1,5,3]),blit,blit];
  const record=recordCheckpointFrame(frame,lb,1,4,4);
  expect(new ReplayAllocations('webgpu').frame(record)).toBe(64+2*(64+32+8*16));
  expect(new ReplayAllocations('webgl2').frame(record)).toBe(64+64+16);
});

it('does not charge a new recovery chain for every lazy zero mip generation',()=>{
  const {lb}=harness(), frame=new Frame();frame.reset(4,4);
  frame.items=[{kind:'gpu',op:GPU_OP.TEXTURE_CREATE_EX,words:[1,0,4096,4096,1,13,0,1]},
    ...Array.from({length:40},()=>({kind:'gpu' as const,op:GPU_OP.TEXTURE_GENERATE_MIPS,words:[1,0]}))];
  const record=recordCheckpointFrame(frame,lb,1,4,4);
  for(const backend of ['webgl2','webgpu'] as const){
    const budget=new ReplayAllocations(backend);
    const fullMipBytes=4*(4**13-1)/3;
    expect(budget.frame(record)).toBe(4096**2*4+fullMipBytes);
    expect(budget.frame({...record,items:record.items.slice(1)})).toBe(0);
  }
});

it('reserves a retained mip source copy for each uploaded texture generated in one frame',()=>{
  const {lb}=harness(), frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  for(const h of [1,2])frame.items.push(cmd(GPU_OP.TEXTURE_CREATE_EX,[h,0,4,4,1,1,0,1]),
    cmd(GPU_OP.TEXTURE_UPDATE_EX,[h,0,0,0,0,4,4,1,0,64]),cmd(GPU_OP.TEXTURE_GENERATE_MIPS,[h,0]));
  const record=recordCheckpointFrame(frame,lb,1,4,4);
  for(const backend of ['webgl2','webgpu'] as const)expect(new ReplayAllocations(backend).frame(record)).toBe(2*3*64);
});

it('rejects transient same-frame replay buffer churn before drawing',async()=>{
  const {renderer,lb}=harness(), frame=new Frame();frame.reset(4,4);
  const detached={...renderer,onError:()=>{},onLost:()=>{},restoreTestSurfaces:()=>{},
    resize:()=>{},drawFrame:vi.fn(async()=>null),destroy:vi.fn()};
  for(let i=0;i<2;i++)frame.items.push(
    {kind:'gpu',op:GPU_OP.BUFFER_CREATE,words:[1,1,4096,0,0]},
    {kind:'gpu',op:GPU_OP.BUFFER_DELETE,words:[1]});
  const records=[recordCheckpointFrame(frame,lb,1,4,4)];
  await expect(replayGPU(detached as unknown as Parameters<typeof replayGPU>[0],null,records,
    bytes=>checkGPUBytes(bytes,12_000,'restore workspace'))).rejects.toThrow(/bounded GPU restore workspace/);
  expect(detached.drawFrame).not.toHaveBeenCalled();
});

it('rejects queued WebGPU vertex repacks before any draw even when the bound buffer fits',async()=>{
  const {renderer,lb}=harness(), frame=new Frame();frame.reset(4,4);
  const detached={...renderer,kind:'webgpu',onError:()=>{},onLost:()=>{},restoreTestSurfaces:()=>{},
    resize:()=>{},drawFrame:vi.fn(async()=>null)};
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  // One byte-aligned UNORM8X4 attribute in each 8-byte record. The renderer
  // repacks the entire binding, not just the 3 vertices the draw uses.
  const span=48*1024**2;
  const pipeline=[1,1,2,3,...Array<number>(19).fill(0),1,1,0,8,0,0,0,1,4];
  frame.items=[cmd(GPU_OP.BUFFER_CREATE,[1,1,span,0,0]),cmd(GPU_OP.PIPELINE_CREATE,pipeline),
    cmd(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,0,0,1,0,0,0,0]),cmd(GPU_OP.PIPELINE,[1]),
    cmd(GPU_OP.VERTEX_BUFFER,[0,1,0,span]),...Array.from({length:132},()=>cmd(GPU_OP.DRAW,[3,1,0,0])),cmd(GPU_OP.PASS_END,[])];
  await expect(replayGPU(detached as unknown as Parameters<typeof replayGPU>[0],null,[recordCheckpointFrame(frame,lb,1,4,4)],
    bytes=>checkGPUBytes(bytes,3*1024**3,'restore workspace'))).rejects.toThrow(/bounded GPU restore workspace/);
  expect(detached.drawFrame).not.toHaveBeenCalled();
});

it('reserves WebGPU transform feedback gather and output pools and queued clear uniforms',()=>{
  const {lb}=harness(), frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  const pipeline=[1,1,2,3,...Array<number>(19).fill(0),1,1,0,16,0,0,0,0,3];
  frame.items=[cmd(GPU_OP.PIPELINE_CREATE,pipeline),
    {...cmd(GPU_OP.FEEDBACK_VARYINGS,[1,0,1,0]),source:'position 3\n'},
    cmd(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,0,0,1,0,0,0,0]),cmd(GPU_OP.PIPELINE,[1]),
    cmd(GPU_OP.VERTEX_BUFFER,[0,1,0,48]),cmd(GPU_OP.FEEDBACK_CAPTURE,[1,2,0,48]),cmd(GPU_OP.DRAW,[3,1,0,0]),
    cmd(GPU_OP.CLEAR_BUFFER,[0|(15<<4),0,0,0,0,0]),cmd(GPU_OP.PASS_END,[])];
  expect(new ReplayAllocations('webgpu').frame(recordCheckpointFrame(frame,lb,1,4,4))).toBeGreaterThanOrEqual(2*256+16);
});

it('reserves WebGL2 wide-stride attribute and indexed draw stores',()=>{
  const {lb}=harness(), frame=new Frame();frame.reset(4,4);
  const cmd=(op:number,words:number[])=>({kind:'gpu' as const,op,words});
  const pipeline=[1,1,2,3,...Array<number>(19).fill(0),1,1,0,512,0,0,0,0,3];
  frame.items=[cmd(GPU_OP.PIPELINE_CREATE,pipeline),cmd(GPU_OP.PASS_BEGIN,[1,0,0,0,0,0,0,0,0,1,0,0,0,0]),
    cmd(GPU_OP.PIPELINE,[1]),cmd(GPU_OP.VERTEX_BUFFER,[0,1,0,512*20]),cmd(GPU_OP.INDEX_BUFFER,[2,1,0,12]),
    cmd(GPU_OP.DRAW_INDEXED,[3,1,0,0,0]),cmd(GPU_OP.PASS_END,[])];
  expect(new ReplayAllocations('webgl2').frame(recordCheckpointFrame(frame,lb,1,4,4))).toBeGreaterThanOrEqual(20*16+3*4);
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
