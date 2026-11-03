// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';
import { builtinRegressions } from '../support/glsl-builtin-regressions';

// Catches incorrect numeric values and texture coordinates/LOD/offsets, not just native compilation.
// Bound each context/test to 48 cases without raising the suite's existing deadline.
for (let start=0; start<builtinRegressions.length; start+=48) {
  const end=Math.min(start+48,builtinRegressions.length);
  test('GLSL builtins known-answer pixels '+start+'..'+(end-1), async ({ page, backendParam, collector }, info) => {
    void collector;
    expect(await openGame(page,backendParam)).toBe('ready');
    await assertBackend(page,backendParam,info);
    const result=await page.evaluate(async ({root,backend,start,end})=>{
      const {glslProbe}=await import(/* @vite-ignore */ root+'/tests/e2e/gpu-glsl-probe.ts');
      const {builtinRegressions}=await import(/* @vite-ignore */ root+'/tests/support/glsl-builtin-regressions.ts');
      return glslProbe(backend,builtinRegressions.slice(start,end));
    }, {root:'/@fs'+resolve('.'),backend:backendParam,start,end});
    expect(result.errors).toEqual([]);
    expect(result.rejections).toEqual([]);
    expect(result.count).toBe(end-start);
    expect(result.pixels).toHaveLength((end-start)*2);
    for(const {name,language,pixel,expected} of result.pixels) for(let i=0;i<4;i++)
      expect(Math.abs(pixel[i]-expected[i]),name+', language '+language+', channel '+i).toBeLessThanOrEqual(1);
  });
}

// Reject GLSL-invalid offsets even on manually lowered integer/shadow/depth paths.
// A subsequent real draw in the same context must still work.
test('GLSL texture offsets require constant expressions', async ({page,backendParam,collector},info)=>{
  void collector;
  expect(await openGame(page,backendParam)).toBe('ready');
  await assertBackend(page,backendParam,info);
  const result=await page.evaluate(async({root,backend})=>{
    const {glslProbe}=await import(/* @vite-ignore */ root+'/tests/e2e/gpu-glsl-probe.ts');
    const {invalidOffsetRegressions,builtinRegressions}=await import(/* @vite-ignore */ root+'/tests/support/glsl-builtin-regressions.ts');
    return glslProbe(backend,[...invalidOffsetRegressions,builtinRegressions[0]]);
  },{root:'/@fs'+resolve('.'),backend:backendParam});
  expect(result.errors).toEqual([]);
  expect(result.rejections).toHaveLength(36);
  for(const rejection of result.rejections) expect(rejection).toContain('constant expression');
  expect(result.count).toBe(19);
  expect(result.pixels).toHaveLength(2);
  for(const {pixel,expected} of result.pixels) for(let i=0;i<4;i++) expect(Math.abs(pixel[i]-expected[i])).toBeLessThanOrEqual(1);
});

// WebGL 2's depth32f linear-filter approximation must be visible and counted, never black.
test('WebGL depth32f linear filtering is counted nearest approximation', async ({page,backendParam,collector},info)=>{
  void collector; expect(await openGame(page,backendParam)).toBe('ready'); await assertBackend(page,backendParam,info);
  const warnings: string[]=[];
  page.on('console', message=>{if(message.type()==='warning') warnings.push(message.text());});
  const result=await page.evaluate(async({root,backend})=>{
    const {glslProbe}=await import(/* @vite-ignore */ root+'/tests/e2e/gpu-glsl-probe.ts');
    const {depthApproximationRegressions}=await import(/* @vite-ignore */ root+'/tests/support/glsl-builtin-regressions.ts');
    return glslProbe(backend,depthApproximationRegressions);
  },{root:'/@fs'+resolve('.'),backend:backendParam});
  expect(result.errors).toEqual([]); expect(result.count).toBe(7); expect(result.rejections).toEqual([]);
  expect(result.pixels).toHaveLength(14);
  expect(result.depth32fLinearApproximations).toBe(backendParam==='webgl2'?14:0);
  expect(warnings.filter(w=>w.includes('DEPTH32F linear filtering approximated as nearest on WebGL 2'))).toHaveLength(backendParam==='webgl2'?1:0);
  for(const {name,language,pixel} of result.pixels){
    const expected=backendParam==='webgpu' && name.startsWith('depth-clamped') ? [128,0,0,255] : [64,0,0,255];
    for(let i=0;i<4;i++) expect(Math.abs(pixel[i]-expected[i]),name+', language '+language+', channel '+i).toBeLessThanOrEqual(1);
  }
});
