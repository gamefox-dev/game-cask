import { test, expect, openGame, step, debugState, diagnostics } from './fixtures';

test.beforeEach(async ({ collector }) => { void collector; });

// Catches CAP_GPU advertised on a partial native implementation, without disabling the v0.2 renderer.
for (const extension of ['OES_draw_buffers_indexed', 'EXT_color_buffer_float']) {
  test(`GPU WebGL2: missing ${extension} clears CAP_GPU but preserves legacy rendering`,
    async ({ page, backendParam }) => {
      test.skip(backendParam !== 'webgl2', 'WebGL2-specific backend contract');
      await page.addInitScript(extension => {
        const get = WebGL2RenderingContext.prototype.getExtension;
        WebGL2RenderingContext.prototype.getExtension = function (name: string) {
          return name === extension ? null : get.call(this, name);
        };
      }, extension);
      expect(await openGame(page, 'webgl2', { game: 'gpu-scenes', debug: '1' })).toBe('ready');
      await step(page, 2);
      const state = await debugState<{ phase: number; caps: number; languages: number }>(page);
      expect(state.phase).toBe(99); expect(state.caps & (1 << 12)).toBe(0); expect(state.languages).toBe(0);
      await page.evaluate(() => (window as any).__BGT_TEST__.simulateDeviceLoss());
      await step(page, 2);
      let d = await diagnostics(page);
      expect(d.deviceResets).toBeGreaterThan(0);
      expect(d.errors.filter(e => e.kind !== 'device-lost')).toEqual([]);
      expect(await openGame(page, 'webgl2', { game: 'sample2d', debug: '1' })).toBe('ready');
      await step(page, 2);
      d = await diagnostics(page);
      expect(d.lastFrame.drawCalls).toBeGreaterThan(0); expect(d.errors).toEqual([]);
      expect(d.commandErrors.count).toBe(0);
    });
}
