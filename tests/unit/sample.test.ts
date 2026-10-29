// The sample game reaches L3 headless: boot -> play -> win, plus lose loop,
// determinism and persistence. Browser coverage lives in tests/e2e.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHeadless } from '../support/headless';
import { CoinCaveState, botDecide, parseLevel } from '../support/bot';

const walls = parseLevel(readFileSync('examples/sample2d/assets/level.txt', 'utf8'));

async function playToEnd(storage?: Map<string, Uint8Array>) {
  const h = await loadHeadless('sample2d', { storage });
  h.step(1);
  h.press('START');
  h.step(1);
  h.release();
  let s = h.state<CoinCaveState>();
  for (let i = 0; i < 6000 && s.state === 'playing'; i++) {
    h.hold(...botDecide(s, walls));
    h.step(1);
    s = h.state<CoinCaveState>();
  }
  return { h, s };
}

describe('Coin Cave (headless)', () => {
  it('boots to the title screen and renders from the atlas', async () => {
    const h = await loadHeadless('sample2d');
    h.step(1);
    expect(h.state<CoinCaveState>().state).toBe('title');
    expect(h.host.textures.count).toBe(1);
    expect(h.host.commandErrorCount).toBe(0);
    expect(h.logs).toContain('coin cave ready');
  });

  it('L3: the bot completes the level and wins', async () => {
    const { h, s } = await playToEnd();
    expect(s.state).toBe('win');
    expect(s.score).toBe(500);
    expect(s.coins.every((c) => c.taken)).toBe(true);
    expect(h.logs.filter((l) => l === 'coin')).toHaveLength(5);
    expect(h.host.commandErrorCount).toBe(0);
  });

  it('identical input yields identical state hashes', async () => {
    const a = await playToEnd();
    const b = await playToEnd();
    expect(a.h.host.stateHash()).toBe(b.h.host.stateHash());
    expect(a.s.frame).toBe(b.s.frame);
  });

  it('persists the best score through bgt_storage_*', async () => {
    const store = new Map<string, Uint8Array>();
    await playToEnd(store);
    expect(store.has('best')).toBe(true);
    const h = await loadHeadless('sample2d', { storage: store });
    expect(h.state<CoinCaveState>().best).toBe(500);
  });

  it('three hits end the game; START returns to the title', async () => {
    const h = await loadHeadless('sample2d');
    h.press('START');
    h.step(1);
    h.release();
    let s = h.state<CoinCaveState>();
    for (let i = 0; i < 4000 && s.state === 'playing'; i++) {
      const targets = s.enemies.map((e) => ({ c: Math.floor((e.x + 6) / 16), r: Math.floor((e.y + 6) / 16), taken: false }));
      h.hold(...botDecide({ ...s, coins: targets, enemies: [] }, walls));
      h.step(1);
      s = h.state<CoinCaveState>();
    }
    expect(s.state).toBe('gameover');
    expect(h.logs.filter((l) => l === 'hit')).toHaveLength(3);
    h.release();
    h.step(40);
    h.press('START');
    h.step(1);
    expect(h.state<CoinCaveState>().state).toBe('title');
  });

  it('bench example supports both batched and direct paths', async () => {
    for (const mode of [0, 1]) {
      const h = await loadHeadless('bench', { arg0: 500, arg1: mode });
      h.step(3);
      expect(h.host.commandErrorCount).toBe(0);
    }
  });
});
