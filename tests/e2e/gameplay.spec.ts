import { readFileSync } from 'node:fs';
import {
  test,
  expect,
  openGame,
  assertBackend,
  diagnostics,
  step,
  input,
  press,
  debugState,
  stateHash,
  readPixels,
  findColor,
  attachScreenshot,
  PLAYER_CYAN,
  WIN_GOLD,
} from './fixtures';
import { botDecide, parseLevel, CoinCaveState } from '../support/bot';
import { loadHeadless } from '../support/headless';

const walls = parseLevel(readFileSync('examples/sample2d/assets/level.txt', 'utf8'));
const pause = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__BGT_TEST__.pause());

test.describe('Coin Cave gameplay', () => {
  test.beforeEach(async ({ page, backendParam }, testInfo) => {
    expect(await openGame(page, backendParam)).toBe('ready');
    await assertBackend(page, backendParam, testInfo);
    await pause(page);
  });

  test('scripted input moves the player (state and pixels)', async ({ page, collector }, testInfo) => {
    void collector;
    await press(page, 'START');
    await step(page, 1);
    const s0 = await debugState<CoinCaveState>(page);
    expect(s0.state).toBe('playing');
    const before = findColor(await readPixels(page), PLAYER_CYAN, 4);
    expect(before.count).toBeGreaterThan(20);

    await input(page, [{ type: 'button', button: 'RIGHT', down: true }]);
    await step(page, 30);
    await input(page, [{ type: 'button', button: 'RIGHT', down: false }]);
    const s1 = await debugState<CoinCaveState>(page);
    expect(s1.player.x - s0.player.x).toBe(45); // 1.5 px/update * 30
    expect(s1.player.y).toBe(s0.player.y);

    const after = findColor(await readPixels(page), PLAYER_CYAN, 4);
    const d = await diagnostics(page);
    const devPerLogical = d.letterbox.w / d.logical.width;
    expect(after.cx - before.cx).toBeGreaterThan(40 * devPerLogical);
    expect(after.cx - before.cx).toBeLessThan(50 * devPerLogical);
    await attachScreenshot(page, testInfo, 'moved-right.png');
  });

  test('simulation is deterministic and matches the headless Node host', async ({ page, collector }) => {
    void collector;
    const script: Array<[string | null, number]> = [['START', 1], [null, 3], ['RIGHT', 40], ['DOWN', 25], ['LEFT', 10], [null, 5]];
    const runBrowser = async () => {
      const hashes: string[] = [];
      for (const [btn, n] of script) {
        if (btn) await input(page, [{ type: 'button', button: btn, down: true }]);
        await step(page, n);
        if (btn) await input(page, [{ type: 'button', button: btn, down: false }]);
        hashes.push((await stateHash(page))!);
      }
      return hashes;
    };
    const a = await runBrowser();
    await page.reload();
    await page.waitForFunction(() => (window as any).__BGT_TEST__?.ready());
    await pause(page);
    const b = await runBrowser();
    expect(b).toEqual(a);

    const h = await loadHeadless('sample2d');
    const node: string[] = [];
    for (const [btn, n] of script) {
      if (btn) h.hold(btn as never);
      h.step(n);
      h.release();
      node.push(h.host.stateHash()!);
    }
    expect(node).toEqual(a);
  });

  test('L3: a full authentic loop — start, collect all coins, win, return to title', async ({ page, collector }, testInfo) => {
    void collector;
    await press(page, 'START');
    let s = await debugState<CoinCaveState>(page);
    expect(s.state).toBe('playing');
    let held: string[] = [];
    for (let i = 0; i < 4000 && s.state === 'playing'; i++) {
      const want = botDecide(s, walls);
      const ev = [
        ...held.filter((b) => !want.includes(b as never)).map((b) => ({ type: 'button', button: b, down: false })),
        ...want.filter((b) => !held.includes(b)).map((b) => ({ type: 'button', button: b, down: true })),
      ];
      if (ev.length) await input(page, ev);
      held = want;
      await step(page, 1);
      s = await debugState<CoinCaveState>(page);
    }
    await input(page, held.map((b) => ({ type: 'button', button: b, down: false })));
    expect(s.state).toBe('win');
    expect(s.coins.every((c) => c.taken)).toBe(true);
    expect(s.score).toBe(500);
    await step(page, 1);
    const px = await readPixels(page);
    expect(findColor(px, WIN_GOLD, 4).count).toBeGreaterThan(300); // "YOU WIN!" title
    await attachScreenshot(page, testInfo, 'win.png');

    const d = await diagnostics(page);
    expect(d.logs.filter((l) => l.message === 'coin').length).toBe(5);
    expect(d.logs.map((l) => l.message)).toContain('state=win');

    await step(page, 31);
    await press(page, 'START');
    expect((await debugState<CoinCaveState>(page)).state).toBe('title');
    expect((await debugState<CoinCaveState>(page)).best).toBe(500);
  });

  test('losing all lives reaches game over, then restarts', async ({ page, collector }) => {
    void collector;
    await press(page, 'START');
    // chase the nearest enemy with the same path planner, treating it as the goal
    let s = await debugState<CoinCaveState>(page);
    let guard = 0;
    while (s.state === 'playing' && guard++ < 3000) {
      const targets = s.enemies.map((e) => ({ c: Math.floor((e.x + 6) / 16), r: Math.floor((e.y + 6) / 16), taken: false }));
      const want = botDecide({ ...s, coins: targets, enemies: [] }, walls);
      await input(page, ['UP', 'DOWN', 'LEFT', 'RIGHT'].map((b) => ({ type: 'button', button: b, down: want.includes(b as never) })));
      await step(page, 1);
      s = await debugState<CoinCaveState>(page);
    }
    await input(page, ['UP', 'DOWN', 'LEFT', 'RIGHT'].map((b) => ({ type: 'button', button: b, down: false })));
    expect(s.state).toBe('gameover');
    expect(s.lives).toBe(0);
    const logs = (await diagnostics(page)).logs.map((l) => l.message);
    expect(logs.filter((m) => m === 'hit').length).toBe(3);
    await step(page, 31);
    await press(page, 'A');
    expect((await debugState<CoinCaveState>(page)).state).toBe('title');
  });
});

test('real keyboard events drive the game while running free', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await page.evaluate(() => (window as any).__BGT_TEST__.resume());
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await debugState<CoinCaveState>(page)).state).toBe('playing');
  const x0 = (await debugState<CoinCaveState>(page)).player.x;
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  const x1 = (await debugState<CoinCaveState>(page)).player.x;
  expect(x1 - x0).toBeGreaterThan(10);
  const d = await diagnostics(page);
  expect(d.frame).toBeGreaterThan(10);
  expect(d.timing.frameIntervalMs.avg).toBeGreaterThan(0);
});

test('touch overlay buttons and canvas taps provide input', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam, { touch: 'on' })).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  await pause(page);
  await expect(page.getByRole('button', { name: 'start' })).toBeVisible();
  // tap the canvas on the title screen (pointer path) to start
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await step(page, 2);
  expect((await debugState<CoinCaveState>(page)).state).toBe('playing');
  const x0 = (await debugState<CoinCaveState>(page)).player.x;
  const right = page.getByRole('button', { name: 'right' });
  const rb = (await right.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await step(page, 20);
  await page.mouse.up();
  await step(page, 1);
  expect((await debugState<CoinCaveState>(page)).player.x - x0).toBe(30);
  await attachScreenshot(page, testInfo, 'touch-overlay.png');
});

test('audio unlocks on a user gesture and gameplay pushes samples', async ({ page, backendParam, collector }, testInfo) => {
  void collector;
  expect(await openGame(page, backendParam)).toBe('ready');
  await assertBackend(page, backendParam, testInfo);
  expect((await diagnostics(page)).audio.unlocked).toBe(false); // no autoplay
  await page.evaluate(() => (window as any).__BGT_TEST__.resume());
  await page.locator('canvas').click(); // gesture: unlocks audio and starts the game
  await expect.poll(async () => (await diagnostics(page)).audio.unlocked).toBe(true);
  await pause(page);
  // walk right along the top corridor to the coin at column 14 via the route the bot uses
  let s = await debugState<CoinCaveState>(page);
  if (s.state === 'title') {
    await press(page, 'START');
    s = await debugState<CoinCaveState>(page);
  }
  let held: string[] = [];
  for (let i = 0; i < 1500 && !s.coins[0].taken; i++) {
    const want = botDecide({ ...s, coins: [s.coins[0]] }, walls);
    await input(page, ['UP', 'DOWN', 'LEFT', 'RIGHT'].map((b) => ({ type: 'button', button: b, down: want.includes(b as never) })));
    held = want;
    await step(page, 1);
    s = await debugState<CoinCaveState>(page);
  }
  void held;
  expect(s.coins[0].taken).toBe(true);
  const a = (await diagnostics(page)).audio;
  expect(a.playedFrames).toBeGreaterThan(1000);
});
