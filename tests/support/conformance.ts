// Reader for the win32-conformance fixture's report (examples/win32-conformance/src/conformance.c, struct report).
// Shared by the headless unit test and the browser conformance test.

export const CW = 320, RH = 160;
export const LOADER_CHECKS = [
  'LoadLibraryA("missing.dll") == NULL, GetLastError() == 126',
  'LoadLibraryA("C:\\\\nowhere\\\\missing") == NULL, 126 (path stripped, ".dll" appended)',
  'LoadLibraryA("KERNEL32") != NULL (profile DLL, case-insensitive, ".dll" appended)',
  'GetProcAddress(kernel32, "GetTickCount") != NULL',
  'GetProcAddress(kernel32, "NoSuchFunctionAnywhere") == NULL, 127',
  'GetProcAddress(kernel32, ordinal 1) == NULL, 127 (the profile implements names, not ordinals)',
  'GetProcAddress(self, ordinal 1) == conf_export_one (shipped module, by ordinal)',
  'GetProcAddress(self, "conf_export_one") == conf_export_one (by name)',
  'GetProcAddress(self, ordinal 99) == NULL, 127',
  'LoadLibraryA("Conformance.EXE") == GetModuleHandleA(NULL) (shipped module first)',
  'GetModuleHandleA("missing.dll") == NULL, 126',
  'FreeLibrary(kernel32) != 0',
  'calling the GetProcAddress result works (== GetTickCount())',
];

export interface ConformanceReport {
  magic: string;
  loaderTotal: number;
  loaderPass: number;
  loader: number[];
  errs: number[];
  gdiDone: number;
  outsideClip: number;
  screenW: number;
  screenH: number;
  /** COLORREF 0x00BBGGRR per pixel, rows of CW */
  screen: Uint32Array;
  mem: Uint32Array;
  /** GetDIBits 32 bpp: 0x00RRGGBB per pixel, top-down 64x64 */
  dib: Uint32Array;
}

export const REPORT_BYTES = 16 + 8 + 64 + 64 + 16 + CW * RH * 4 + 64 * 64 * 4 * 2;

export function reportAddress(logs: string[]): number | null {
  for (const l of logs) {
    const m = /conformance: gdi done report=0x([0-9a-f]+)/.exec(l);
    if (m) return parseInt(m[1], 16);
  }
  return null;
}

export function parseReport(b: Uint8Array): ConformanceReport {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u = (o: number) => dv.getUint32(o, true);
  const arr = (o: number, n: number) => {
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = u(o + 4 * i);
    return out;
  };
  const so = 16 + 8 + 64 + 64 + 16;
  return {
    magic: String.fromCharCode(...b.subarray(0, 15)),
    loaderTotal: u(16),
    loaderPass: u(20),
    loader: [...arr(24, 16)],
    errs: [...arr(88, 16)],
    gdiDone: u(152),
    outsideClip: u(156),
    screenW: u(160),
    screenH: u(164),
    screen: arr(so, CW * RH),
    mem: arr(so + CW * RH * 4, 64 * 64),
    dib: arr(so + CW * RH * 4 + 64 * 64 * 4, 64 * 64),
  };
}

export const colorref = (r: number, g: number, b: number) => (r | (g << 8) | (b << 16)) >>> 0;
export const rgbOf = (c: number): [number, number, number] => [c & 255, (c >> 8) & 255, (c >> 16) & 255];
