// SPDX-License-Identifier: CC0-1.0
import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

// Catches vK17a's premature builtin validation and invalid WGSL local const
// initializers through native pipeline creation AND known-answer readback.
for (const [group, count] of [['user-', 17], ['local-const-', 3]] as const) test('vK17a ' + group + ' known-answer pixels', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const result = await page.evaluate(async ({ root, backend, group }) => {
    const { glslProbe } = await import(/* @vite-ignore */ root + '/tests/e2e/gpu-glsl-probe.ts');
    const { reviewRegressions } = await import(/* @vite-ignore */ root + '/tests/support/glsl-review-regressions.ts');
    return glslProbe(backend, reviewRegressions.filter((c: { name: string }) => c.name.startsWith(group)));
  }, { root: '/@fs' + resolve('.'), backend: backendParam, group });
  expect(result.errors).toEqual([]);
  expect(result.rejections).toEqual([]);
  expect(result.count).toBe(count);
  expect(result.pixels).toHaveLength(count * 2);
  for (const { name, language, pixel, expected } of result.pixels) for (let i = 0; i < 4; i++)
    expect(Math.abs(pixel[i] - expected[i]), name + ', language ' + language + ', channel ' + i).toBeLessThanOrEqual(1);
});
