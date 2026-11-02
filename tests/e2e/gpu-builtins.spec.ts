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
