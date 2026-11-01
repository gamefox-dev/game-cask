// @bgt-examples: x64-audio x64-input
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameHost, emptyInput } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { InputManager } from '../../bgt/input/input';
import { loadHeadless, ROOT } from '../support/headless';
import { oracle } from '../oracle/oracle';
import { compileC } from '../support/compile';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

it('WASAPI: exact stereo samples, frequency, amplitude, duration, conversion and threaded events', async () => {
  // Catches dropped audio, rate conversion, nondeterministic draining and disconnected scheduler event handles.
  const dir = join(ROOT, 'web/public/games/x64-audio');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const vfs = new Vfs();
  for (const a of manifest.assets) vfs.add(a.path, new Uint8Array(readFileSync(join(dir, 'assets', a.path))));
  const samples: number[] = [], times: number[] = [], logs: string[] = [];
  const host = await GameHost.create(readFileSync(join(dir, 'game.wasm')), {
    vfs, log: (_l, m) => logs.push(m), now: () => 123456789,
    audio: { sampleRate: 48000, queued: () => 0,
      push: () => { throw new Error('stereo WASAPI must not be folded into mono'); },
      pushStereo: (s) => { samples.push(...s); times.push(host.frameIndex); return s.length / 2; } },
  }, { backend: 3, caps: 1, seed: 1, displayWidth: 320, displayHeight: 160, arg0: 0, arg1: 0 });
  host.init();
  for (let i = 0; i < 100; i++) {
    host.writeInput(emptyInput()); host.update(); host.render(); host.consume();
  }
  expect(logs.some((s) => s.includes('x64-audio PASS')), logs.join('\n')).toBe(true);
  expect(logs.filter((s) => s.includes('x64-audio worker event PASS'))).toHaveLength(2);
  expect(logs.some(s => s.includes('x64-audio notification lifetime/errors PASS'))).toBe(true);
  expect(logs.some(s => s.includes('x64-audio notification no unsolicited changes PASS'))).toBe(true);
  expect(logs.some(s => s.includes('x64-audio audio thread joined PASS'))).toBe(true);
  expect(samples.length).toBe(48000 * 2);
  for (let pass = 0; pass < 2; pass++) {
    const left = samples.slice(pass * 48000, (pass + 1) * 48000).filter((_, i) => !(i & 1));
    const right = samples.slice(pass * 48000, (pass + 1) * 48000).filter((_, i) => i & 1);
    expect(Math.max(...left)).toBe(16384); expect(Math.min(...left)).toBe(-16384);
    expect(Math.max(...right)).toBe(8192); expect(Math.min(...right)).toBe(-8192);
    expect(right.every((s, i) => s === -left[i] / 2)).toBe(true);
    // Every output frame must contain the generated tone, not merely occasional nonzero extrema.
    expect(left.every((s, i) => s === (Math.floor(i / 24) % 2 ? -16384 : 16384))).toBe(true);
    const crossings = left.slice(1).filter((s, i) => s > 0 && left[i] < 0).length;
    expect(crossings / 0.5).toBeCloseTo(1000, -1);
  }
  expect(times.at(-1)! - times[0]).toBeGreaterThanOrEqual(58);
  expect(times.at(-1)! - times[0]).toBeLessThanOrEqual(62);
  expect((host.metrics() as any).interp_insns).toBe(0);
  expect((host.metrics() as any).stubs).toEqual([]);
});

it('input: virtual gamepad is separate from keyboard, Raw Input data and consistent key state', async () => {
  // Catches accidental merged-button XInput, bad Win64 RAWINPUT layout, missing key breaks and mouse deltas.
  const h = await loadHeadless('x64-input'); await h.stepAsync(2);
  const manager = new InputManager({} as HTMLCanvasElement);
  manager.logicalW = 320; manager.logicalH = 160;
  manager.injectTest([{ type: 'key', code: 'KeyK', down: true },
    { type: 'pointer', x: 100, y: 90, buttons: 1 },
    { type: 'gamepad', index: 0, connected: true, buttons: 1, axes: [0.5, -0.25, 0, 0], triggers: [0.75, 0] }]);
  manager.snapshot(h.input);
  // Headless.step replaces keysPressed but preserves held HID keys and additive pad state.
  await h.stepAsync(2);
  expect(h.logs.some((s) => /connected=1.*buttons=4096 lx=16384 ly=8192 lt=191/.test(s)), h.logs.join('\n'))
    .toBe(true);
  expect(h.logs.some((s) => /rawkey=1 vk=75 down=1.*consistent=1/.test(s))).toBe(true);
  manager.injectTest([{ type: 'key', code: 'KeyK', down: false },
    { type: 'pointer', x: 107, y: 86, buttons: 0 },
    { type: 'gamepad', index: 0, connected: false }]);
  manager.snapshot(h.input); await h.stepAsync(2);
  expect(h.logs.some((s) => /connected=0.*rawkey=2 vk=75 down=0.*dx=7 dy=-4 consistent=1/.test(s)),
    h.logs.join('\n')).toBe(true);
  expect((h.host.metrics() as any).interp_insns).toBe(0);
  expect((h.host.metrics() as any).stubs).toEqual([]);
});

it('physical Gamepad API preserves slot, buttons, axes and triggers independently from keyboard', () => {
  // Catches implementations that work only for the injected pad event and never poll real browser pads.
  const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 3, value: i === 6 ? 0.5 : 0 }));
  vi.stubGlobal('navigator', { getGamepads: () => [null, { connected: true, buttons, axes: [-0.5, 1, 0, 0] }] });
  try {
    const manager = new InputManager({} as HTMLCanvasElement), snapshot = emptyInput();
    manager.injectTest([{ type: 'key', code: 'Space', down: true }]); manager.snapshot(snapshot);
    expect(snapshot.gamepads?.[0].connected).toBe(false);
    expect(snapshot.gamepads?.[1]).toEqual({ connected: true, buttons: 8,
      axes: [-16383, 32767, 0, 0], triggers: [32768, 0] });
    expect(snapshot.buttons & 16).toBe(16); // merged virtual A comes from Space, not pad slot 1.
  } finally { vi.unstubAllGlobals(); }
});

it('additive imports: bounds, separated pad snapshot, rumble and stereo partial acceptance', async () => {
  const logs: string[] = [], rumble: number[][] = [], pcm: number[][] = [];
  const host = await GameHost.create(await compileC('tests/fixtures/c/audio_input_abi.c'), {
    vfs: new Vfs(), now: () => 0, log: (_l, m) => logs.push(m),
    gamepadRumble: (...args) => { rumble.push(args); },
    audio: { sampleRate: 48000, queued: () => 0, push: () => 0,
      pushStereo: (s) => { pcm.push([...s]); return 1; } },
  }, { backend: 3, caps: 0, seed: 1, displayWidth: 1, displayHeight: 1, arg0: 0, arg1: 0 });
  host.init();
  const snapshot = emptyInput();
  snapshot.gamepads = [{ connected: true, buttons: 5, axes: [16384, -32767, 0, 0], triggers: [65535, 0] }];
  host.writeInput(snapshot);
  snapshot.gamepads[0].buttons = 0; // A sampled snapshot must not alias a mutable producer.
  host.update();
  expect(logs).toEqual(['abi-ok']); expect(rumble).toEqual([[0, 12345, 23456]]);
  expect(pcm).toEqual([[1200, -800, 400, -200]]);
});

for (const id of ['x64-audio', 'x64-input']) it(`${id}: fully lifted, 300-frame identical oracle`, async () => {
  buildGame(`examples/${id}`, { interpretOnly: true, quiet: true });
  const r = await oracle(id, 300);
  expect(r.frames).toBe(300); expect(r.identical).toBe(true);
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect((r.metrics.lifted as any).interp_insns).toBe(0);
  expect((r.metrics.lifted as any).stubs).toEqual([]);
}, 120_000);
