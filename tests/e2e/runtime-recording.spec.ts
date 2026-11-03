// SPDX-License-Identifier: CC0-1.0
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect, openGame, assertBackend } from './fixtures';

// Exercises a real ResizeObserver while the recorder's asynchronous sink stalls.
// Metadata equality alone is insufficient: assert the pending resize is applied
// afterwards and the next frame uses it, on each production backend.
test('capture and draw use one atomic size across ResizeObserver delivery', async ({ page, backendParam, collector }, info) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, info);
  const result = await page.evaluate(async ({ root, kind }) => {
    const { BGTRuntime } = await import(root + '/runtime/runtime.ts');
    const { recordFrame } = await import(root + '/renderers/recording.ts');
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;width:320px;height:180px'; document.body.append(container);
    const rt: any = new BGTRuntime({ container, gameUrl: '/games/sample2d/', backend: kind,
      debug: true, startPaused: true, autostart: false, ephemeralStorage: true });
    await rt.start(); if (!rt.ready) throw Error('runtime failed');
    // Drain initial observer/repaint before installing the deliberately stalled sink.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await rt.renderFrame(false);
    let recorded: any; let entered!: () => void, release!: () => void;
    const start = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r);
    rt.frameObserver = async (...args: any[]) => { recorded ??= recordFrame(...args); entered(); await gate; };
    const draws: any[] = [];
    const original = rt.renderer.drawFrame.bind(rt.renderer);
    rt.renderer.drawFrame = (frame: any, lb: any, readback: boolean) => {
      draws.push({ width: rt.canvas.width, height: rt.canvas.height, letterbox: { ...lb } });
      return original(frame, lb, readback);
    };
    const work = rt.renderFrame(false); await start;
    const delivered = new Promise<void>(resolve => {
      const ro = new ResizeObserver(entries => {
        if (entries[0].contentRect.width === 640) { ro.disconnect(); resolve(); }
      }); ro.observe(rt.stage);
    });
    container.style.width = '640px'; container.style.height = '360px';
    await delivered;
    release(); await work; rt.frameObserver = undefined;
    await rt.renderFrame(false);
    await rt.renderTail; rt.resizeObs.disconnect(); rt.renderer.destroy();
    return { recorded: { width: recorded.width, height: recorded.height, letterbox: recorded.letterbox }, draws,
      errors: rt.diagnostics().errors };
  }, { root: '/@fs' + resolve('bgt'), kind: backendParam });
  expect(result.errors).toEqual([]);
  expect(result.recorded).toEqual({ width: 320, height: 180, letterbox: { x: 0, y: 0, w: 320, h: 180, scale: 1 } });
  expect(result.draws[0]).toEqual(result.recorded);
  expect(result.draws.at(-1)).toEqual({ width: 640, height: 360, letterbox: { x: 0, y: 0, w: 640, h: 360, scale: 2 } });
});

// Run the documented public CLI and shipped driver, not makeProbe mocks or an
// alternate driver. A complete footer and contiguous frames catch truncated files.
test('documented capture command writes a complete startup-to-target recording', async ({ backendParam }, info) => {
  const out = info.outputPath('capture');
  const { stdout } = await promisify(execFile)('npm', ['run', 'probe', '--', '--game', 'sample2d',
    '--backend', backendParam, '--script', 'tools/probe/record-to-frame.mjs', '--params', 'recordTo=3',
    '--record-frame', '3', '--out', out], { timeout: 45000 });
  expect(stdout).toContain('0 error(s)');
  const records = readFileSync(resolve(out, 'frame-recording.ndjson'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
  expect(records[0]).toEqual({ type: 'header', schema: 'game-cask/renderer-recording/1', fromStartup: true, targetUpdate: 3 });
  const frames = records.slice(1, -1);
  expect(frames.length).toBeGreaterThanOrEqual(3);
  expect(frames.map(f => f.sequence)).toEqual(frames.map((_, i) => i));
  expect(frames.at(-1).update).toBe(3);
  expect(records.at(-1)).toEqual({ type: 'end', frames: frames.length, targetUpdate: 3 });
  expect(JSON.parse(readFileSync(resolve(out, 'probe.json'), 'utf8')).errors).toEqual([]);
});
