// SPDX-License-Identifier: CC0-1.0
import { afterEach, expect, it, vi } from 'vitest';
import { WebGPUCommands } from '../../bgt/renderers/webgpu/gpu';
import { E_IO, GPU_OP as O } from '../../bgt/runtime/abi';
import type { GpuItem } from '../../bgt/renderers/types';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  vi.stubGlobal('GPUShaderStage', { VERTEX:1, FRAGMENT:2 });
  const scopes: Array<(error: GPUError | null) => void> = [];
  const device = {
    features: new Set(), pushErrorScope:vi.fn(),
    popErrorScope:vi.fn(() => new Promise<GPUError | null>(resolve => scopes.push(resolve))),
    createBindGroupLayout:vi.fn(() => ({})), createPipelineLayout:vi.fn(() => ({})),
    createRenderPipeline:vi.fn(() => ({})),
  };
  const errors: string[] = [], gpu = new WebGPUCommands(device as unknown as GPUDevice, e => errors.push(e));
  const pass = { setPipeline:vi.fn(), draw:vi.fn(), drawIndexed:vi.fn() };
  const internal = gpu as unknown as { shaders:Map<number,unknown>; pass:unknown };
  for (const h of [1,2]) internal.shaders.set(h, { native:{}, bindings:[], outputs:new Set([0]), item:{ words:[h,h,0], source:'' } });
  internal.pass = pass;
  const send = (op:number, words:number[], extra:Partial<GpuItem> = {}) => gpu.execute({kind:'gpu',op,words,...extra});
  const words = (h:number) => [h,1,2,3,0,0,0xffffffff,0,0,7,0,255,255,7,0,0,0,7,0,0,0,0,0,0,0,1,0,0,1,0,0,1,0,0,15];
  return {gpu,device,scopes,errors,pass,send,words};
}
it('settled native failure rejects all pipeline consumers and clears the old executable', async () => {
  const t=setup();
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(0); t.scopes[0](null); await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.PIPELINE,[1])).toBe(0);
  expect(t.send(O.PIPELINE_CREATE,t.words(2))).toBe(0);
  t.scopes[1]({message:'native test rejection'}); await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.FEEDBACK_VARYINGS,[2,0,1,0,9],{source:'result 3' + String.fromCharCode(10)})).toBe(E_IO);
  expect(t.send(O.PIPELINE,[2])).toBe(E_IO);
  expect(t.send(O.DRAW,[3,1,0,0])).toBe(E_IO);
  expect(t.send(O.DRAW_INDEXED,[3,1,0,0,0])).toBe(E_IO);
  expect(t.send(O.FEEDBACK_CAPTURE,[1,0,0,0])).toBe(E_IO);
  expect(t.pass.setPipeline).toHaveBeenCalledTimes(1); expect(t.pass.draw).not.toHaveBeenCalled(); expect(t.pass.drawIndexed).not.toHaveBeenCalled();
  expect(t.errors).toHaveLength(6); expect(t.errors.join(' ')).not.toMatch(/undefined|TypeError/);
});
it('a pipeline bound while pending becomes unusable when its native failure settles', async () => {
  const t=setup();
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(0);
  expect(t.send(O.PIPELINE,[1])).toBe(0);
  const state=t.gpu as unknown as {capture?:readonly number[]};
  expect(t.send(O.FEEDBACK_CAPTURE,[1,0,0,0])).toBe(0);
  const armed=state.capture;
  t.scopes[0]({message:'pending pipeline failed'}); await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.DRAW,[3,1,0,0])).toBe(E_IO);
  expect(state.capture).toBe(armed);
  expect(t.send(O.FEEDBACK_CAPTURE,[1,0,0,0])).toBe(E_IO);
  expect(t.pass.draw).not.toHaveBeenCalled(); expect(t.pass.setPipeline).toHaveBeenCalledTimes(1);
});
it('late native failure cannot poison a deleted and reused pipeline handle', async () => {
  const t=setup();
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(0);
  expect(t.send(O.PIPELINE_DELETE,[1])).toBe(0);
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(0);
  t.scopes[1](null); t.scopes[0]({message:'retired native pipeline'}); await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.PIPELINE,[1])).toBe(0); expect(t.pass.setPipeline).toHaveBeenCalledTimes(1);
  expect(t.send(O.PIPELINE_DELETE,[1])).toBe(0);
});
it('synchronous native failure balances its error scope and permits deletion/reuse', async () => {
  const t=setup(); t.device.createRenderPipeline.mockImplementationOnce(() => { throw Error('native constructor failure'); });
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(E_IO);
  expect(t.device.pushErrorScope).toHaveBeenCalledTimes(1); expect(t.device.popErrorScope).toHaveBeenCalledTimes(1);
  t.scopes[0](null); await Promise.resolve();
  expect(t.send(O.PIPELINE,[1])).toBe(E_IO);
  expect(t.send(O.FEEDBACK_VARYINGS,[1,0,1,0,9],{source:'result 3' + String.fromCharCode(10)})).toBe(E_IO);
  expect(t.send(O.PIPELINE_DELETE,[1])).toBe(0);
  expect(t.send(O.PIPELINE_CREATE,t.words(1))).toBe(0); t.scopes[1](null); await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.PIPELINE,[1])).toBe(0);
});

it('a synchronous native bind rejection clears current instead of drawing the prior executable', async () => {
  const t=setup();
  for (const h of [1,2]) {
    expect(t.send(O.PIPELINE_CREATE,t.words(h))).toBe(0); t.scopes[h-1](null);
  }
  await Promise.resolve(); await Promise.resolve();
  expect(t.send(O.PIPELINE,[1])).toBe(0);
  t.pass.setPipeline.mockImplementationOnce(() => { throw Error('native bind failure'); });
  expect(t.send(O.PIPELINE,[2])).toBe(E_IO);
  expect(t.send(O.DRAW,[3,1,0,0])).toBe(E_IO);
  expect(t.send(O.DRAW_INDEXED,[3,1,0,0,0])).toBe(E_IO);
  expect(t.pass.draw).not.toHaveBeenCalled(); expect(t.pass.drawIndexed).not.toHaveBeenCalled();
  expect(t.send(O.PIPELINE,[1])).toBe(0);
});
