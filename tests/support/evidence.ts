// Helpers that make browser tests able to fail (browser-validation skill, "Tests must be able to fail").
//   catches('...')                state the breakage this test would catch (recorded as a test annotation)
//   expectChange(page, action)     assert that an action changes the state hash and/or a screen region
//   captureRegion / regionDiff     logical-pixel samples of a rectangle and their difference
//   peekBytes(page, addr, len)     read-only guest memory (any length; chunked through __BGT_TEST__.peek)
// Self-contained (no imports from other kit test files), so probe scripts can import it too.
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Region { rect: Rect; rgb: Uint8Array }

/** Record what breakage this test catches. The validator rejects tests without it. */
export function catches(description: string): void {
  test.info().annotations.push({ type: 'catches', description });
}

/** Sample a logical-pixel rectangle at pixel centres from the presented canvas (any backend, any letterbox). */
export async function captureRegion(page: Page, rect: Rect): Promise<Region> {
  const b64: string = await page.evaluate(async (r) => {
    const t = (window as any).__BGT_TEST__;
    const d = t.diagnostics();
    const px = await t.readPixels();
    if (!px) throw new Error('readPixels returned null');
    const bin = atob(px.base64);
    const s = d.letterbox.w / d.logical.width;
    const out = new Uint8Array(r.w * r.h * 3);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const dx = Math.floor(d.letterbox.x + (r.x + x + 0.5) * s), dy = Math.floor(d.letterbox.y + (r.y + y + 0.5) * s);
        const o = (dy * px.width + dx) * 4, k = (y * r.w + x) * 3;
        out[k] = bin.charCodeAt(o); out[k + 1] = bin.charCodeAt(o + 1); out[k + 2] = bin.charCodeAt(o + 2);
      }
    let s2 = '';
    for (let i = 0; i < out.length; i += 0x8000) s2 += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s2);
  }, rect);
  return { rect, rgb: new Uint8Array(Buffer.from(b64, 'base64')) };
}

/** Fraction of pixels whose max channel delta exceeds `tol`. */
export function regionDiff(a: Region, b: Region, tol = 8): number {
  let bad = 0;
  for (let i = 0; i < a.rgb.length; i += 3) {
    const d = Math.max(Math.abs(a.rgb[i] - b.rgb[i]), Math.abs(a.rgb[i + 1] - b.rgb[i + 1]), Math.abs(a.rgb[i + 2] - b.rgb[i + 2]));
    if (d > tol) bad++;
  }
  return bad / (a.rgb.length / 3);
}

/**
 * Run `action` and fail unless it changed what it should: the game's state hash (`hash`, default true when the
 * game exports one) and/or `region` by at least `minFraction` of its pixels. Returns the measurements.
 */
export async function expectChange(
  page: Page,
  action: () => Promise<void>,
  opts: { hash?: boolean; region?: Rect; minFraction?: number; tol?: number; what?: string } = {},
): Promise<{ hashBefore: string | null; hashAfter: string | null; changedFraction: number | null }> {
  const hashOf = () => page.evaluate(() => (window as any).__BGT_TEST__.stateHash() as string | null);
  const hashBefore = await hashOf();
  const before = opts.region ? await captureRegion(page, opts.region) : null;
  await action();
  const hashAfter = await hashOf();
  const after = opts.region ? await captureRegion(page, opts.region) : null;
  const changedFraction = before && after ? regionDiff(before, after, opts.tol ?? 8) : null;
  const what = opts.what ?? 'the action';
  if (opts.hash ?? hashBefore !== null) expect(hashAfter, `${what} must change the state hash`).not.toBe(hashBefore);
  if (opts.region) expect(changedFraction!, `${what} must change region ${JSON.stringify(opts.region)}`).toBeGreaterThanOrEqual(opts.minFraction ?? 0.01);
  return { hashBefore, hashAfter, changedFraction };
}

/** Read-only guest memory through __BGT_TEST__.peek, any length (64 KiB per call). null if unmapped. */
export async function peekBytes(page: Page, addr: number, len: number): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  for (let o = 0; o < len; o += 65536) {
    const n = Math.min(65536, len - o);
    const b64: string | null = await page.evaluate(([a, k]) => {
      const u: Uint8Array | null = (window as any).__BGT_TEST__.peek(a, k);
      if (!u) return null;
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    }, [addr + o, n] as [number, number]);
    if (b64 === null) return null;
    parts.push(Buffer.from(b64, 'base64'));
  }
  return Buffer.concat(parts);
}
