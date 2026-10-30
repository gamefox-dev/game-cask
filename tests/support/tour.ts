// Resource tour (Win32 pipeline games): open every menu item through real input and record what happens.
//
//   import { runTour } from '../../tests/support/tour';   (from port/tests/*.spec.ts, or p.tour() in a probe script)
//   const index = await runTour(page, { game: 'mygame', backend: 'webgl2', outDir: 'reports/tour/webgl2' });
//
// For each top-level menu and each item in it: reload the game (deterministic start), click the menu title and the
// item at the rectangles the profile reports in debugState().ui (read-only layout), step, screenshot, and record
// errors/aborts, new stubs, new APIs and metric deltas. Message boxes and dialogs that open are screenshotted, then
// dismissed with Escape, else with their Cancel/No/OK button, and screenshotted again. Items whose label looks like
// exit/quit/close are listed but skipped unless `includeExit`. Separators, disabled items and cascading submenus are
// listed with the reason they were not clicked. The tour only sends input; it never writes game state.
// Output: <outDir>/index.json + PNGs (default reports/tour/, private). Self-contained: no other kit test imports.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export interface TourOptions {
  game: string;
  backend?: string;
  outDir?: string;
  /** frames to run after boot before touching anything (default 30) */
  settleFrames?: number;
  /** frames to run after clicking an item (default 20) */
  itemFrames?: number;
  /** also click items that look like they exit the program */
  includeExit?: boolean;
  exitPattern?: RegExp;
  /** extra URL parameters (e.g. { seed: '2' }) */
  params?: Record<string, string>;
}

type Rect = [number, number, number, number];
interface UiItem { pos: number; text: string; id: number; flags: number; separator: boolean; disabled: boolean; checked: boolean; popup: boolean; rect: Rect }
interface UiWindow { hwnd: number; parent: number; class: string; text: string; id: number; style: number; exstyle: number; dialog: boolean; enabled: boolean; checked: number; rect: Rect; client: Rect }
interface Ui {
  main: number; modal: number;
  menubar: { rect: Rect; open: number; items: UiItem[] } | null;
  popup: { menu: number; rect: Rect; items: UiItem[] } | null;
  messagebox: { caption: string; text: string; type: number; rect: Rect; buttons: { id: number; text: string; rect: Rect }[] } | null;
  windows: UiWindow[];
}

export interface TourItem {
  menu: string;
  menuPos: number;
  item: string;
  pos: number;
  id: number;
  skipped?: string;
  screenshot?: string;
  opened?: { kind: 'messagebox' | 'dialog'; title: string; text?: string; controls?: { class: string; text: string; id: number; style: number; exstyle: number; rect: Rect }[]; buttons?: string[] };
  dismissed?: boolean;
  dismissScreenshot?: string;
  errors: { kind: string; message: string }[];
  aborted: boolean;
  exited: boolean;
  newStubs: string[];
  newApis: string[];
  metricsDelta: Record<string, number>;
  windows?: UiWindow[];
}
export interface TourIndex {
  schema: 'game-cask/tour/1';
  game: string;
  backend: string;
  generated: string;
  start: string;
  notes: string[];
  menus: { pos: number; text: string; screenshot?: string; items: number }[];
  items: TourItem[];
  summary: { items: number; clicked: number; skipped: number; aborted: number; withErrors: number; dialogs: number; messageboxes: number };
}

const clean = (s: string) => s.split('\t')[0].replace(/&(&?)/g, '$1').trim(); // "&&" is a literal '&'
const centre = (r: Rect): [number, number] => [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)];

export async function runTour(page: Page, opts: TourOptions): Promise<TourIndex> {
  const backend = opts.backend ?? 'webgl2';
  const outDir = opts.outDir ?? 'reports/tour';
  const settle = opts.settleFrames ?? 30, itemFrames = opts.itemFrames ?? 20;
  const exitRe = opts.exitPattern ?? /^(exit|quit|close)\b/i;
  mkdirSync(outDir, { recursive: true });

  const api = <T>(fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__BGT_TEST__[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
  const step = (n: number) => api<void>('step', n);
  const ui = async () => ((await api<{ ui?: Ui }>('debugState'))?.ui ?? null);
  const metrics = async () => ((await api<{ metrics: Record<string, unknown> }>('diagnostics')).metrics ?? {}) as Record<string, unknown>;
  const shot = async (name: string) => {
    const b64: string = await page.evaluate(async () => {
      const blob: Blob = await (window as any).__BGT_TEST__.screenshot();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(join(outDir, name), Buffer.from(b64, 'base64'));
    return name;
  };
  const click = async (r: Rect, frames = 2) => {
    const [x, y] = centre(r);
    await api('input', [{ type: 'pointer', x, y, buttons: 1 }]);
    await step(1);
    await api('input', [{ type: 'pointer', x, y, buttons: 0 }]);
    await step(frames);
  };
  const key = async (code: string, frames = 3) => {
    await api('input', [{ type: 'key', code, down: true }]);
    await step(1);
    await api('input', [{ type: 'key', code, down: false }]);
    await step(frames);
  };
  const load = async () => {
    const q = new URLSearchParams({ game: opts.game, backend, paused: '1', ephemeral: '1', ...(opts.params ?? {}) });
    await page.goto(`/?${q}`);
    await page.waitForFunction(() => {
      const t = (window as any).__BGT_TEST__;
      return !!t && (t.ready() || t.failed());
    }, null, { timeout: 30_000 });
    if (await api<boolean>('failed')) throw new Error(`tour: ${opts.game} failed to start`);
    await step(settle);
  };

  const index: TourIndex = {
    schema: 'game-cask/tour/1', game: opts.game, backend, generated: new Date().toISOString(), start: '', notes: [], menus: [], items: [],
    summary: { items: 0, clicked: 0, skipped: 0, aborted: 0, withErrors: 0, dialogs: 0, messageboxes: 0 },
  };
  await load();
  index.start = await shot('start.png');
  const base = await metrics();
  const baseStubs = new Set((base.stubs as string[]) ?? []), baseApis = new Set((base.apis_hit as string[]) ?? []);
  const bar = (await ui())?.menubar;
  if (!bar) index.notes.push('no menu bar reported by the profile (not a Win32 pipeline game, or the main window has no menu)');

  for (const top of bar?.items ?? []) {
    await load();
    await click(top.rect);
    const popup = (await ui())?.popup;
    const menu = { pos: top.pos, text: clean(top.text), screenshot: await shot(`menu-${top.pos}.png`), items: popup?.items.length ?? 0 };
    index.menus.push(menu);
    if (!popup) { index.notes.push(`menu "${menu.text}" did not open a popup`); continue; }
    for (const it of popup.items) {
      const entry: TourItem = { menu: menu.text, menuPos: top.pos, item: it.separator ? '----' : clean(it.text), pos: it.pos, id: it.id, errors: [], aborted: false, exited: false, newStubs: [], newApis: [], metricsDelta: {} };
      index.items.push(entry);
      if (it.separator) { entry.skipped = 'separator'; continue; }
      if (it.popup) { entry.skipped = 'cascading submenu: the profile cannot open nested popups'; continue; }
      if (it.disabled) { entry.skipped = 'disabled (grayed) when the menu opens'; continue; }
      if (exitRe.test(entry.item) && !opts.includeExit) { entry.skipped = 'looks like it exits the program (runTour({ includeExit: true }) to click it)'; continue; }
      await load();
      await click(top.rect);
      const again = (await ui())?.popup?.items.find((x) => x.pos === it.pos);
      if (!again) { entry.skipped = 'popup did not reopen identically'; continue; }
      await click(again.rect, itemFrames);
      const tag = `item-${top.pos}-${it.pos}`;
      entry.screenshot = await shot(`${tag}.png`);
      let u = await ui();
      entry.windows = u?.windows;
      const dlg = u?.windows.find((w) => w.dialog);
      if (u?.messagebox) {
        entry.opened = { kind: 'messagebox', title: u.messagebox.caption, text: u.messagebox.text, buttons: u.messagebox.buttons.map((b) => b.text) };
      } else if (dlg) {
        entry.opened = {
          kind: 'dialog', title: dlg.text,
          controls: u!.windows.filter((w) => w.parent === dlg.hwnd).map((w) => ({ class: w.class, text: w.text, id: w.id, style: w.style, exstyle: w.exstyle, rect: w.rect })),
        };
      }
      if (entry.opened) {
        await key('Escape');
        u = await ui();
        const stillOpen = () => !!(u?.messagebox || u?.windows.some((w) => w.dialog));
        if (stillOpen()) {
          const pick = (xs: { text: string; rect: Rect }[]) => ['Cancel', 'No', 'OK', 'Close'].map((t) => xs.find((b) => clean(b.text).toLowerCase() === t.toLowerCase())).find(Boolean);
          const btn = u?.messagebox ? pick(u.messagebox.buttons) : pick((u?.windows ?? []).filter((w) => w.class === 'button'));
          if (btn) { await click(btn.rect, 3); u = await ui(); }
        }
        entry.dismissed = !stillOpen();
        entry.dismissScreenshot = await shot(`${tag}-after.png`);
      }
      const d = await api<{ errors: { kind: string; message: string }[]; metrics: Record<string, unknown> }>('diagnostics');
      const m = d.metrics ?? {};
      entry.errors = d.errors.map((e) => ({ kind: e.kind, message: e.message }));
      entry.aborted = await api<boolean>('failed');
      entry.exited = m.exited === 1;
      entry.newStubs = ((m.stubs as string[]) ?? []).filter((s) => !baseStubs.has(s));
      entry.newApis = ((m.apis_hit as string[]) ?? []).filter((s) => !baseApis.has(s));
      for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && typeof base[k] === 'number' && v !== base[k] && k !== 'trace_hash') entry.metricsDelta[k] = v - (base[k] as number);
    }
  }
  const s = index.summary;
  s.items = index.items.length;
  s.skipped = index.items.filter((i) => i.skipped).length;
  s.clicked = s.items - s.skipped;
  s.aborted = index.items.filter((i) => i.aborted).length;
  s.withErrors = index.items.filter((i) => i.errors.length).length;
  s.dialogs = index.items.filter((i) => i.opened?.kind === 'dialog').length;
  s.messageboxes = index.items.filter((i) => i.opened?.kind === 'messagebox').length;
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  return index;
}
