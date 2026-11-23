// K69: the tie-aware screen comparison used by gpu-presentation must still catch lost or shifted content.
import { describe, expect, it } from 'vitest';
import { screenRetention, type Image } from '../support/gpu-image';

// A 160x128 logical screen letterboxed at scale 11.25 (Desktop Safari, DPR 2: 2560x1440, lb x=380 w=1800).
const lb = { x: 380, y: 0, w: 1800, h: 1440 }, W = 2560, H = 1440, s = 11.25;
const image = (red: (x: number, y: number) => boolean): Image => {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inside = x >= lb.x && x < lb.x + lb.w;
    data.set(!inside ? [0, 0, 0, 255] : red(x, y) ? [255, 0, 0, 255] : [0, 255, 0, 255], i);
  }
  return { width: W, height: H, data };
};
// Pixel-centre coverage of logical [70,90) x [50,70): centres exactly on an edge are covered on the left/top edge.
const square = (dx = 0) => image((x, y) => x + 0.5 - dx >= lb.x + 70 * s && x + 0.5 - dx < lb.x + 90 * s && y + 0.5 >= 50 * s && y + 0.5 < 70 * s);

describe('screenRetention', () => {
  it('accepts identical images and one-pixel moves on exact tie lines only', () => {
    expect(screenRetention(square(), square(), lb, 160, 128)).toEqual({ changed: 0, ties: 0, unexplained: 0 });
    // The opposite tie rule: centres on the left/top edges are not covered (x=1167 / y=562 and y=787 are ties).
    const other = image((x, y) => x + 0.5 > lb.x + 70 * s && x + 0.5 <= lb.x + 90 * s && y + 0.5 > 50 * s && y + 0.5 <= 70 * s);
    const r = screenRetention(square(), other, lb, 160, 128);
    expect(r.changed).toBe(0); expect(r.ties).toBeGreaterThan(0); expect(r.unexplained).toBe(0);
  });
  it('catches a lost overlay and a shift off the tie lines', () => {
    expect(screenRetention(square(), image(() => false), lb, 160, 128).changed).toBeGreaterThan(40000);
    expect(screenRetention(square(), square(3), lb, 160, 128).changed).toBeGreaterThan(0);
  });
  it('catches a tie pixel that takes a colour no neighbour had', () => {
    const b = square(); const i = (600 * W + 1167) * 4; b.data.set([0, 0, 255], i); // x=1167 is a tie column
    expect(screenRetention(square(), b, lb, 160, 128)).toEqual({ changed: 0, ties: 1, unexplained: 1 });
  });
});
