import { test, expect, openGame, assertBackend, step, diagnostics, input, stateHash,
  readPixels, attachScreenshot, catches } from './fixtures';

test('XInput + Raw Input: state and pixels change on gamepad, keyboard, mouse, then release',
  async ({ page, backendParam, collector }, info) => {
    catches('missing gamepad separation, raw keyboard/mouse messages, release edges or state-square drawing');
    collector.allow(/guest:/);
    const logs: string[] = []; page.on('console', (m) => logs.push(m.text()));
    expect(await openGame(page, backendParam, { game: 'x64-input' })).toBe('ready');
    await assertBackend(page, backendParam, info); await step(page, 2);
    const d = await diagnostics(page), scale = d.letterbox.w / d.logical.width;
    const color = async (x: number) => {
      const px = await readPixels(page);
      const offset = (Math.floor(d.letterbox.y + 60.5 * scale) * px.width +
        Math.floor(d.letterbox.x + (x + 0.5) * scale)) * 4;
      return [...px.data.subarray(offset, offset + 3)];
    };
    expect(await color(20)).toEqual([220, 0, 0]);
    expect(await color(90)).toEqual([220, 0, 0]);
    const before = await stateHash(page);
    await input(page, [{ type: 'gamepad', index: 0, connected: true, buttons: 1,
      axes: [0.5, -0.25, 0, 0], triggers: [0.75, 0] },
    { type: 'key', code: 'KeyK', down: true }, { type: 'pointer', x: 100, y: 90, buttons: 1 }]);
    await step(page, 2);
    expect(await stateHash(page)).not.toBe(before);
    for (const x of [20, 90, 160, 230]) expect(await color(x)).toEqual([0, 220, 0]);
    expect(logs.some((s) => /connected=1.*buttons=4096 lx=16384 ly=8192 lt=191/.test(s)), logs.join('\n'))
      .toBe(true);
    expect(logs.some((s) => /rawkey=1 vk=75 down=1.*consistent=1/.test(s))).toBe(true);
    await attachScreenshot(page, info, 'x64-input-held.png');
    await input(page, [{ type: 'gamepad', index: 0, connected: false },
      { type: 'key', code: 'KeyK', down: false }, { type: 'pointer', x: 107, y: 86, buttons: 0 }]);
    await step(page, 2);
    for (const x of [20, 90, 230]) expect(await color(x)).toEqual([220, 0, 0]);
    expect(logs.some((s) => /connected=0.*rawkey=2 vk=75 down=0.*dx=7 dy=-4 consistent=1/.test(s)))
      .toBe(true);
    const after = await diagnostics(page);
    expect(after.errors).toEqual([]); expect(after.commandErrors.count).toBe(0);
    expect((after.metrics as any).interp_insns).toBe(0); expect((after.metrics as any).stubs).toEqual([]);
  });

test('WASAPI tone reaches browser stereo audio after a real gesture',
  async ({ page, backendParam, collector }, info) => {
    catches('COM activation failure, missing render-service calls, broken event polling or browser audio routing');
    collector.allow(/guest:/);
    const logs: string[] = []; page.on('console', (m) => logs.push(m.text()));
    expect(await openGame(page, backendParam, { game: 'x64-audio' })).toBe('ready');
    await assertBackend(page, backendParam, info);
    await page.keyboard.press('Shift');
    await expect.poll(async () => (await diagnostics(page)).audio.unlocked).toBe(true);
    await step(page, 70);
    expect(logs.some((s) => s.includes('x64-audio PASS')), logs.join('\n')).toBe(true);
    const d = await diagnostics(page);
    expect(d.audio.playedFrames).toBeGreaterThan(0);
    expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
    expect((d.metrics as any).interp_insns).toBe(0); expect((d.metrics as any).stubs).toEqual([]);
  });
