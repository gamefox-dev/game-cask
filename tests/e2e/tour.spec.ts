// The resource tour (tests/support/tour.ts) validated on win32-hello: every menu item opened through real input,
// dialogs and message boxes recorded and dismissed, exit items listed but skipped, screenshots written.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, catches } from './fixtures';
import { runTour } from '../support/tour';

test('resource tour opens every menu item of win32-hello and records dialogs and message boxes', async ({ page, backendParam, collector }, testInfo) => {
  catches('the tour missing menu items, not opening/dismissing dialogs or message boxes, or clicking an exit item');
  void collector;
  test.skip(backendParam === 'webgpu' && !process.env.BGT_TOUR_WEBGPU, 'the tour is backend-independent input + layout; one backend is enough');
  const outDir = testInfo.outputPath('tour');
  const index = await runTour(page, { game: 'win32-hello', backend: backendParam, outDir });
  await testInfo.attach('tour-index.json', { body: JSON.stringify(index, null, 2), contentType: 'application/json' });
  expect(index.menus.map((m) => m.text)).toEqual(['Game', 'Help']);
  const by = (item: string) => index.items.find((i) => i.item === item)!;
  expect(index.items.map((i) => `${i.menu}>${i.item}`)).toEqual(['Game>New', 'Game>Options...', 'Game>----', 'Game>Exit', 'Help>About']);
  expect(by('----').skipped).toBe('separator');
  expect(by('Exit').skipped).toMatch(/exits the program/);
  expect(by('Exit').screenshot).toBeUndefined(); // never clicked
  // Options... opens the DIALOG resource; its controls are listed with their styles; Escape dismisses it
  const opt = by('Options...');
  expect(opt.opened).toMatchObject({ kind: 'dialog', title: 'Options' });
  expect(opt.opened!.controls!.map((c) => c.text)).toEqual(expect.arrayContaining(['&Small tiles', '&Large tiles', '&Sound', 'OK', 'Cancel']));
  expect(opt.opened!.controls!.find((c) => c.text === '&Small tiles')!.style & 0xf).toBe(9); // BS_AUTORADIOBUTTON
  expect(opt.dismissed).toBe(true);
  expect(opt.newApis).toEqual(expect.arrayContaining(['DialogBoxParamA']));
  const about = by('About');
  expect(about.opened).toMatchObject({ kind: 'messagebox', title: 'About', text: 'Game Cask pipeline example' });
  expect(about.dismissed).toBe(true);
  expect(by('New').opened).toBeUndefined();
  expect(index.summary).toMatchObject({ items: 5, clicked: 3, skipped: 2, aborted: 0, withErrors: 0, dialogs: 1, messageboxes: 1 });
  for (const f of ['index.json', 'start.png', 'menu-0.png', 'menu-1.png', opt.screenshot!, opt.dismissScreenshot!, about.screenshot!]) expect(existsSync(join(outDir, f)), f).toBe(true);
});
