// Win32 profile conformance against the API contract, headless (no GPU): module loading (E1), pixel reads answered
// by CPU replay of the recorded GDI ops (E2), the read-only test peek (E5) and the UI layout in debugState.
// The browser test tests/e2e/win32-conformance.spec.ts compares the same reads with real GPU pixels.
import { describe, expect, it } from 'vitest';
import { loadHeadless, Headless } from '../support/headless';
import { CW, LOADER_CHECKS, REPORT_BYTES, colorref, parseReport, reportAddress, ConformanceReport } from '../support/conformance';

async function runConformance(): Promise<{ h: Headless; r: ConformanceReport; addr: number }> {
  const h = await loadHeadless('win32-conformance');
  for (let i = 0; i < 60 && reportAddress(h.logs) === null; i++) h.step(1);
  const addr = reportAddress(h.logs);
  if (addr === null) throw new Error(`no conformance report; logs:\n${h.logs.join('\n')}`);
  const bytes = new Uint8Array(REPORT_BYTES);
  for (let o = 0; o < REPORT_BYTES; o += 65536) {
    const part = h.host.peek(addr + o, Math.min(65536, REPORT_BYTES - o));
    if (!part) throw new Error(`peek failed at +${o}`);
    bytes.set(part, o);
  }
  return { h, r: parseReport(bytes), addr };
}

describe('Win32 profile: module loading (Win32 contract)', () => {
  it('LoadLibrary/GetProcAddress resolve shipped modules, then profile DLLs; anything else fails with 126/127', async () => {
    const { h, r } = await runConformance();
    expect(r.magic).toBe('BGT-CONFORMANCE');
    const failed = LOADER_CHECKS.filter((_, i) => r.loader[i] !== 1).map((c) => `${c} (GetLastError ${r.errs[LOADER_CHECKS.indexOf(c)]})`);
    expect(failed).toEqual([]);
    expect(r.loaderTotal).toBe(LOADER_CHECKS.length);
    expect(r.errs[0]).toBe(126); // ERROR_MOD_NOT_FOUND
    expect(r.errs[4]).toBe(127); // ERROR_PROC_NOT_FOUND
    const m = h.host.metrics() as Record<string, unknown>;
    expect(m.stubs).toEqual([]); // no faulting thunk was handed out for the missing DLL
    expect(h.host.suspended).toBe(true);
  });
});

describe('Win32 profile: pixel reads by CPU replay', () => {
  it('GetPixel/GetDIBits on GPU surfaces return the drawn pixels, with no impossible reads', async () => {
    const { h, r } = await runConformance();
    const m = h.host.metrics() as Record<string, number>;
    expect(r.gdiDone).toBe(1);
    expect(m.pixel_replay).toBe(1); // enabled because the module imports GetPixel/GetDIBits
    expect(m.gdi_getpixel_noread).toBe(0);
    expect(m.gdi_cpu_replays).toBeGreaterThanOrEqual(CW * 160 + 64 * 64);
    expect(r.outsideClip).toBe(0xffffffff); // CLR_INVALID outside the clip region (not counted as a failure)
    expect([r.screenW, r.screenH]).toEqual([320, 200]);
    const px = (x: number, y: number) => r.screen[y * CW + x];
    // analytic spot checks per op kind (cell c at x = 32*(c%8), y = 32*floor(c/8))
    expect(px(10, 10)).toBe(colorref(200, 30, 40)); // FillRect
    expect(px(32 + 31, 31)).toBe(colorref(20, 180, 60)); // PatBlt PATCOPY
    expect([px(64 + 3, 5), px(64 + 20, 5)]).toEqual([colorref(0, 0, 0), colorref(255, 255, 255)]); // BLACKNESS/WHITENESS
    expect([px(96 + 1, 1), px(96 + 10, 10), px(96 + 10, 20)]).toEqual([colorref(255, 0, 255), colorref(0, 255, 0), colorref(255, 0, 255)]); // DSTINVERT
    expect(px(32 * 1 + 8 + 1, 32 * 2 + 8)).toBe(colorref(16, 255 - 0, 77)); // SetPixel (cell 17: x=1,y=0)
    // screen -> memory -> screen copy (cell 25 at 32,96): left half of cell 0 colour, right half cell 1 colour
    expect([px(32 + 2, 96 + 5), px(32 + 20, 96 + 5)]).toEqual([colorref(200, 30, 40), colorref(20, 180, 60)]);
    // the memory bitmap read three ways must agree: GetPixel on its DC, GetDIBits, and its 1:1 blit on the screen
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const mem = r.mem[y * 64 + x], dib = r.dib[y * 64 + x];
        const dibAsColorref = ((dib >> 16) & 255) | (dib & 0xff00) | ((dib & 255) << 16);
        if (mem !== px(256 + x, y) || dibAsColorref !== mem) throw new Error(`memory bitmap mismatch at ${x},${y}: mem ${mem.toString(16)} dib ${dib.toString(16)} screen ${px(256 + x, y).toString(16)}`);
      }
    }
    expect(r.mem[5 * 64 + 5]).toBe(colorref(10, 100, 250));
  });

  it('peek is read-only and refuses unmapped or oversized reads', async () => {
    const { h, addr } = await runConformance();
    const before = h.host.stateHash();
    const a = h.host.peek(addr, 16)!;
    expect(String.fromCharCode(...a.subarray(0, 15))).toBe('BGT-CONFORMANCE');
    a[0] = 0; // the copy is ours; guest memory is untouched
    expect(String.fromCharCode(...h.host.peek(addr, 15)!)).toBe('BGT-CONFORMANCE');
    expect(h.host.peek(0x10, 4)).toBeNull(); // unmapped page
    expect(h.host.peek(addr, 65537)).toBeNull();
    expect(h.host.peek(addr, 0)).toBeNull();
    expect(h.host.stateHash()).toBe(before);
  });
});

describe('Win32 profile: program metrics exclude presentation chrome', () => {
  it('extra bgt_render calls cannot increase gdi_ops or change the guest trace', async () => {
    const h = await loadHeadless('win32-hello'); h.step(5);
    const before = h.host.metrics() as Record<string, number>;
    for (let i = 0; i < 3; i++) { h.host.render(); h.host.consume(); }
    const after = h.host.metrics() as Record<string, number>;
    expect(after.gdi_ops).toBe(before.gdi_ops);
    expect(after.trace_hash).toBe(before.trace_hash);
    expect(after.chrome_ops).toBeGreaterThan(before.chrome_ops);
  });
});

describe('Win32 profile: read-only UI layout in debugState', () => {
  it('exposes the menu bar, the open popup and dialog controls so tests can click them through real input', async () => {
    const h = await loadHeadless('win32-hello');
    h.step(5);
    type Item = { text: string; id: number; rect: number[]; separator: boolean };
    const ui = () => (h.state() as { ui: { menubar: { items: Item[] }; popup: { items: Item[] } | null; windows: { class: string; text: string; dialog: boolean; rect: number[]; style: number }[]; modal: number } }).ui;
    expect(ui().menubar.items.map((i) => i.text)).toEqual(['&Game', '&Help']);
    const click = (rect: number[]) => {
      const x = rect[0] + Math.floor(rect[2] / 2), y = rect[1] + Math.floor(rect[3] / 2);
      h.pointer(x, y, 1); h.step(1); h.pointer(x, y, 0); h.step(2);
    };
    click(ui().menubar.items[0].rect);
    const popup = ui().popup!;
    expect(popup.items.map((i) => (i.separator ? '-' : i.text))).toEqual(['&New\tF2', '&Options...', '-', 'E&xit']);
    click(popup.items[1].rect); // Options...
    const dlg = ui().windows.find((w) => w.dialog)!;
    expect(dlg.text).toBe('Options');
    expect(ui().modal).toBeGreaterThan(0);
    const ctl = ui().windows.filter((w) => w.class === 'button').map((w) => w.text);
    expect(ctl).toEqual(expect.arrayContaining(['&Small tiles', '&Large tiles', '&Sound', 'OK', 'Cancel']));
    const modules = (h.state() as { modules: { name: string; base: number }[] }).modules;
    expect(modules[0]).toMatchObject({ name: 'hello.exe', base: 0x400000 });
  });
});
