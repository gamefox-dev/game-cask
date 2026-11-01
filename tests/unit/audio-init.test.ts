import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameHost, emptyInput } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { ROOT } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

/* Q23 / K6c: WASAPI shared-mode initialisation contracts on the normally compiled x64-audio-init fixture.
 * The fixture asserts every HRESULT, capacity, COM identity and lifetime itself (a failure logs "FAIL n");
 * this test asserts the stereo samples that reach the sink, which no implementation can fake without
 * actually resampling, scaling and timing them. */
const SEGMENTS = [4800, 21000, 4800, 2400, 7200]; // sink frames per fixture segment, in order
async function run() {
  const dir = join(ROOT, 'web/public/games/x64-audio-init');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const vfs = new Vfs();
  for (const a of manifest.assets) vfs.add(a.path, new Uint8Array(readFileSync(join(dir, 'assets', a.path))));
  const samples: number[] = [], logs: string[] = [];
  const host = await GameHost.create(readFileSync(join(dir, 'game.wasm')), {
    vfs, log: (_l, m) => logs.push(m), now: () => 123456789,
    audio: { sampleRate: 48000, queued: () => 0,
      push: () => { throw new Error('stereo WASAPI must not be folded into mono'); },
      pushStereo: (s) => { samples.push(...s); return s.length / 2; } },
  }, { backend: 3, caps: 1, seed: 1, displayWidth: 320, displayHeight: 160, arg0: 0, arg1: 0 });
  host.init();
  for (let i = 0; i < 300 && !logs.some((s) => /x64-audio-init (PASS|FAIL)/.test(s)); i++) {
    host.writeInput(emptyInput()); host.update(); host.render(); host.consume();
  }
  return { host, samples, logs };
}
function chan(s: number[], from: number, frames: number, c: number) {
  const out: number[] = [];
  for (let i = 0; i < frames; i++) out.push(s[(from + i) * 2 + c]);
  return out;
}
const peak = (v: number[]) => [Math.min(...v), Math.max(...v)];
/** rising zero crossings (negative to non-negative) in a segment */
const cycles = (v: number[]) => v.slice(1).filter((x, i) => v[i] < 0 && x >= 0).length;
/** frequency check tolerant of one partial cycle at the segment edges */
const expectHz = (v: number[], f: number) => expect(Math.abs(cycles(v) - (v.length / 48000) * f)).toBeLessThanOrEqual(1);

// Independent output-time reference: each sink-frame crossing lies between two source-frame ends.
// Compare every sample, not just extrema/crossings (which would miss phase or interpolation errors).
function referenceTone(frames: number, rate: number, half: number, left: number, right: number, rightGain = 1) {
  const values: number[] = [];
  const sign = (i: number) => Math.floor(Math.max(0, i) / half) % 2 ? -1 : 1;
  const rounded = (n: number, d: number) => Math.trunc((n + (n < 0 ? -d / 2 : d / 2)) / d);
  for (let j = 0; j < frames; j++) {
    const time = (j + 1) * rate, index = Math.ceil(time / 48000) - 1;
    const fraction = time - index * 48000;
    const sample = (level: number) => {
      const prev = sign(index - 1) * level, cur = sign(index) * level;
      return prev + rounded((cur - prev) * fraction, 48000);
    };
    const r = sample(right) * rightGain;
    values.push(sample(left), r >= 0 ? Math.floor(r + 0.5) : Math.ceil(r - 0.5));
  }
  return values;
}

it('WASAPI init contracts: flags, formats, durations, COM lifetime, clock, volume and resampled samples', async () => {
  const { host, samples, logs } = await run();
  expect(logs.filter((s) => s.includes('FAIL')), logs.join('\n')).toEqual([]);
  expect(logs.some((s) => s.includes('x64-audio-init contracts PASS')), logs.join('\n')).toBe(true);
  expect(logs.some((s) => s.includes('x64-audio-init PASS sinkframes=40200')), logs.join('\n')).toBe(true);
  expect(logs.some((s) => s.includes('audio thread joined PASS'))).toBe(true);
  expect(logs.filter((s) => /segment \d done/.test(s))).toHaveLength(5);
  expect(samples.length / 2).toBe(SEGMENTS.reduce((a, b) => a + b, 0)); // exact duration, nothing dropped
  let at = 0;
  const seg = SEGMENTS.map((n) => { const s = at; at += n; return s; });

  // 1: float32 44.1 kHz -> 48 kHz (RATEADJUST, interpolated); right channel stream volume 0.5.
  let l = chan(samples, seg[0], SEGMENTS[0], 0), r = chan(samples, seg[0], SEGMENTS[0], 1);
  expect(peak(l)).toEqual([-16384, 16384]); expect(peak(r)).toEqual([-4096, 4096]);
  expectHz(l, 44100 / 44); // ~1002 Hz source tone, pitch preserved by resampling
  expect(l.some((x) => Math.abs(x) > 0 && Math.abs(x) < 16384)).toBe(true); // interpolation, not repetition
  expect(r.every((x, i) => Math.abs(x * 4 + l[i]) <= 4)).toBe(true); // opposite polarity at 1/4 level

  expect(samples.slice(seg[0] * 2, (seg[0] + SEGMENTS[0]) * 2))
    .toEqual(referenceTone(4800, 44100, 22, 16384, -8192, 0.5));

  // 2: 24 kHz int16 with SetSampleRate 24000 / 48000 / 12000: 6000 + 3000 + 12000 sink frames, pitch x1, x2, x0.5.
  const lens = [6000, 3000, 12000], freq = [500, 1000, 250]; let o = seg[1];
  lens.forEach((n, k) => {
    l = chan(samples, o, n, 0); r = chan(samples, o, n, 1);
    expect(peak(l)).toEqual([-16384, 16384]); expect(peak(r)).toEqual([-8192, 8192]);
    expectHz(l, freq[k]);
    expect(samples.slice(o * 2, (o + n) * 2))
      .toEqual(referenceTone(n, [24000, 48000, 12000][k], 24, 16384, -8192));
    o += n;
  });
  l = chan(samples, seg[1] + 9000, 12000, 0); // 4x upsample: quarter-step interpolation values exist
  expect(l.some((x) => x === 8192 || x === -8192)).toBe(true);

  // 3: mono int16 44.1 kHz -> both channels, exactly 450 Hz, amplitude 20000, linear (SRC_DEFAULT_QUALITY).
  l = chan(samples, seg[2], SEGMENTS[2], 0); r = chan(samples, seg[2], SEGMENTS[2], 1);
  expect(r).toEqual(l); expect(peak(l)).toEqual([-20000, 20000]);
  expectHz(l, 450);
  expect(samples.slice(seg[2] * 2, (seg[2] + SEGMENTS[2]) * 2))
    .toEqual(referenceTone(4800, 44100, 49, 20000, 20000));

  // 4: EXTENSIBLE 24-bit PCM at the mix rate: exact amplitudes, no resampling.
  l = chan(samples, seg[3], SEGMENTS[3], 0); r = chan(samples, seg[3], SEGMENTS[3], 1);
  expect(peak(l)).toEqual([-16384, 16384]); expect(peak(r)).toEqual([-8192, 8192]);
  expect(new Set(l)).toEqual(new Set([16384, -16384])); // no interpolation at 1:1
  expectHz(l, 1000);

  // 5: session volume 0.5, mute, restored.
  const part = (k: number) => [chan(samples, seg[4] + k * 2400, 2400, 0), chan(samples, seg[4] + k * 2400, 2400, 1)];
  expect(part(0).map(peak)).toEqual([[-8192, 8192], [-4096, 4096]]);
  expect(part(1).every((c) => c.every((x) => x === 0))).toBe(true);
  expect(part(2).map(peak)).toEqual([[-16384, 16384], [-8192, 8192]]);

  expect((host.metrics() as any).interp_insns).toBe(0);
  expect((host.metrics() as any).stubs).toEqual([]);
});

it('x64-audio-init: fully lifted, 300-frame identical oracle', async () => {
  buildGame('examples/x64-audio-init', { interpretOnly: true, quiet: true });
  const r = await oracle('x64-audio-init', 300);
  expect(r.frames).toBe(300); expect(r.identical).toBe(true);
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect((r.metrics.lifted as any).interp_insns).toBe(0);
  expect((r.metrics.lifted as any).stubs).toEqual([]);
}, 120_000);
