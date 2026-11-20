// SPDX-License-Identifier: CC0-1.0. K51: honest GPU uniform-block limits on real devices.
// Catches: (1) CAP_GPU refused on a real WebGL2 GPU that only guarantees 16384-byte uniform blocks
// (ANGLE Metal on Apple silicon), (2) the guest being told a fixed 65536 instead of the device's limit,
// (3) an at-limit std140 block not reaching the native compiler/draw intact.
import { test, expect, openGame, assertBackend, diagnostics, readPixels } from './fixtures';
import { stepUntilLog } from './guest-progress';

test.beforeEach(async ({ collector }) => { void collector; });

test('x64-gl-limits: guest GL_MAX_UNIFORM_BLOCK_SIZE is the device limit; an at-limit block draws', async ({ page, backendParam }, info) => {
  expect(await openGame(page, backendParam, { game: 'x64-gl-limits' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  await stepUntilLog(page, 'x64-gl-limits pixel=', 60);
  const d = await diagnostics(page);
  expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
  const logs = d.logs.map(l => l.message);
  expect(logs.filter(l => l.includes('FAIL')), logs.join('\n')).toEqual([]);
  const device = d.gpuDevice!;
  expect(device, 'CAP_GPU must be available on this backend').not.toBeNull();
  const expected = Math.min(65536, device.nativeMaxUniformRange - device.nativeMaxUniformRange % 16);
  expect(device.maxUniformRange).toBe(expected);
  expect(logs.some(l => l.endsWith(`x64-gl-limits uniform-block-limit=${expected}`)), logs.join('\n')).toBe(true);
  expect(logs.some(l => l.endsWith(`x64-gl-limits PASS checks limit=${expected} failures=0`)), logs.join('\n')).toBe(true);
  // v[0] + v[limit/16 - 2] + tail == magenta; the green clear means the at-limit draw did not happen.
  expect(logs.some(l => l.endsWith('x64-gl-limits pixel=255,0,255,255')), logs.join('\n')).toBe(true);
  // 1024 default-block vec4s (split profile block) compile natively and draw cyan on the left half.
  expect(logs.some(l => l.endsWith('x64-gl-limits default-pixel=0,255,255,255')), logs.join('\n')).toBe(true);
  const px = await readPixels(page), b = d.letterbox;
  const at = (Math.floor(b.y + b.h / 2) * px.width + Math.floor(b.x + b.w * 3 / 4)) * 4;
  expect([...px.data.slice(at, at + 4)]).toEqual([255, 0, 255, 255]);
  await info.attach('gpu-device.json', { body: JSON.stringify({ backend: d.backend, device }, null, 2), contentType: 'application/json' });
  // Opt-in hardware gate: BGT_WEBGL2_GPU=1 runs the WebGL2 project on the native GPU; it must not be a CPU rasterizer.
  if (backendParam === 'webgl2' && process.env.BGT_WEBGL2_GPU === '1') expect(device.software, device.renderer ?? '').toBe(false);
});

// Runs on any WebGL2 implementation (including SwiftShader): the gate accepts exactly the real minimum.
for (const [reported, accepted] of [[16384, true], [16368, false]] as const) {
  test(`GPU WebGL2: MAX_UNIFORM_BLOCK_SIZE ${reported} ${accepted ? 'keeps CAP_GPU and is reported' : 'clears CAP_GPU'}`,
    async ({ page, backendParam }) => {
      test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
      await page.addInitScript(value => {
        const get = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (name: number) {
          return name === WebGL2RenderingContext.MAX_UNIFORM_BLOCK_SIZE ? value : get.call(this, name);
        };
      }, reported);
      expect(await openGame(page, 'webgl2', { game: 'x64-gl-limits' })).toBe('ready');
      const d = await diagnostics(page);
      if (!accepted) { expect(d.gpuDevice).toBeNull(); return; }
      expect(d.gpuDevice?.languages).toBe(6); expect(d.gpuDevice?.maxUniformRange).toBe(16384);
      await stepUntilLog(page, 'x64-gl-limits pixel=', 60);
      const logs = (await diagnostics(page)).logs.map(l => l.message);
      expect(logs.some(l => l.endsWith('x64-gl-limits PASS checks limit=16384 failures=0')), logs.join('\n')).toBe(true);
      expect(logs.some(l => l.endsWith('x64-gl-limits pixel=255,0,255,255')), logs.join('\n')).toBe(true);
    });
}
