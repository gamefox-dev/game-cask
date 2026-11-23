// K69 review: WebGL2Renderer context reuse and destroy() bounds, on the project's real WebGL 2 implementation.
// Breakage caught: reuse() waiting seconds on a context that cannot be restored (it waited up to 2 x 2 s), reuse()
// returning a renderer on a still-lost context, and simulateLoss() hanging forever when destroy() removes its listener.
import { resolve } from 'node:path';
import { test, expect, openGame } from './fixtures';

test('WebGL2 reuse restores fast, falls back fast, and destroy settles a pending simulated loss', async ({ page, collector }) => {
  // Deliberate refusals below: browsers report them as console errors (WebKit) or warnings (Chromium).
  collector.allow(/^WebGL: INVALID_OPERATION: restoreContext: context restoration not allowed$/);
  expect(await openGame(page, 'webgl2')).toBe('ready');
  const r = await page.evaluate(async (root) => {
    const { WebGL2Renderer, REUSE_LOST_MS, REUSE_RESTORE_MS } = await import(root + '/renderers/webgl2/webgl2.ts');
    const timed = async <T>(f: () => Promise<T>) => { const t0 = performance.now(); const v = await f(); return { v, ms: performance.now() - t0 }; };
    const fresh = () => { const c = document.createElement('canvas'); c.width = c.height = 8; return c; };
    // 1. Normal reuse: the same canvas and context come back live.
    const a = WebGL2Renderer.create(fresh())!; a.destroy();
    const ok = await timed(() => WebGL2Renderer.reuse(a.canvas));
    const okv = ok.v as any, reused = !!okv && okv.canvas === a.canvas && !okv.gl.isContextLost();
    okv?.destroy(); await new Promise(res => setTimeout(res, 10));
    // 2. Not restorable: the browser refuses restoreContext (stubbed no-op, as for a context it will not restore).
    const b = WebGL2Renderer.create(fresh())!, bgl = (b as any).gl as WebGL2RenderingContext;
    const ext = bgl.getExtension('WEBGL_lose_context')!; b.destroy(); ext.restoreContext = () => {};
    const refused = await timed(() => WebGL2Renderer.reuse(b.canvas));
    // 3. Loss never delivered (loseContext suppressed): the canvas is not reused and the wait is bounded.
    const c = WebGL2Renderer.create(fresh())!, cext = ((c as any).gl as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
    cext.loseContext = () => {}; c.destroy();
    const undelivered = await timed(() => WebGL2Renderer.reuse(c.canvas));
    // 4. destroy() while simulateLoss waits for its restore settles it (rejects) instead of hanging. The restore is held
    // back (stubbed) so destroy() lands deterministically between restoreContext() and the restored event.
    const d = WebGL2Renderer.create(fresh())!;
    ((d as any).gl as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!.restoreContext = () => {};
    const pending = d.simulateLoss().then(() => 'resolved', (e: Error) => e.message);
    await new Promise(res => setTimeout(res, 40)); d.destroy();
    const settled = await Promise.race([pending, new Promise(res => setTimeout(() => res('hung'), 2000))]);
    // 5. ...also when destroyed before the restore is requested (during the 30 ms loss window).
    const e = WebGL2Renderer.create(fresh())!;
    const early = e.simulateLoss().then(() => 'resolved', (x: Error) => x.message); e.destroy();
    const settledEarly = await Promise.race([early, new Promise(res => setTimeout(() => res('hung'), 2000))]);
    return { reused, okMs: ok.ms, refused: refused.v === null, refusedMs: refused.ms, undelivered: undelivered.v === null,
      undeliveredMs: undelivered.ms, settled, settledEarly, bound: REUSE_LOST_MS + REUSE_RESTORE_MS };
  }, '/@fs' + resolve('bgt'));
  expect(r.reused).toBe(true); expect(r.okMs).toBeLessThan(r.bound);
  expect(r.refused).toBe(true); expect(r.refusedMs).toBeLessThan(r.bound + 200);
  expect(r.undelivered).toBe(true); expect(r.undeliveredMs).toBeLessThan(r.bound + 200);
  expect(r.settled).toMatch(/destroyed during simulated loss/); expect(r.settledEarly).toMatch(/destroyed during simulated loss/);
});
