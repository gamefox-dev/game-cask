// Debug-only deterministic test interface, installed as window.__BGT_TEST__.
// Present in dev builds and builds made with VITE_BGT_TEST=1; never in a
// plain production build (see web/src/main.ts).

import type { BGTDiagnostics, BGTRuntime } from './runtime';
import type { DecodeResult } from './commands';
import type { TestInputEvent } from '../input/input';
import { recordFrame, type RecordedFrame } from '../renderers/recording';
import type { Savestate } from './savestates';
import type {ExportOptions,SnapshotSource} from './savestate-file';

export type BGTTestInputEvent = TestInputEvent;

export interface BGTPixels {
  width: number;
  height: number;
  /** base64 RGBA8, rows top-to-bottom, device pixels of the whole canvas. */
  base64: string;
}

export interface BGTTestAPI {
  snapshot(): Promise<Savestate>;
  exportSnapshot(snapshot: Savestate,options?:ExportOptions): ReadableStream<Uint8Array>;
  importSnapshot(file: SnapshotSource): Promise<Savestate>;
  exportSnapshotDebugJson(snapshot:Savestate):string;
  importSnapshotDebugJson(file:string):Savestate;
  compactJournal():Promise<void>;
  journalStats():{bytes:number;frames:number;limit:number;error:string|null};
  restore(snapshot: Savestate): Promise<void>;
  ready(): boolean;
  pause(): void;
  step(frames: number): Promise<void>;
  input(events: BGTTestInputEvent[]): void;
  screenshot(): Promise<Blob>;
  diagnostics(): BGTDiagnostics;
  stateHash(): string | null;
  backend(): 'webgpu' | 'webgl2' | 'unavailable';
  // ---- extensions (documented in bgt/abi/ABI.md §Test API)
  resume(): void;
  failed(): boolean;
  readPixels(): Promise<BGTPixels | null>;
  debugState(): unknown;
  coverage(): ReturnType<BGTRuntime['coverageSnapshot']>;
  profileReset():boolean;
  injectCommands(base64: string): DecodeResult | null;
  simulateDeviceLoss(opts?: { unrecoverable?: boolean }): Promise<void>;
  /**
   * TEST-ONLY, READ-ONLY: `len` bytes (1..65536) of the game's guest memory at `addr` (pipeline games: the emulated
   * address space, e.g. a variable's address from the disassembly), or null when unavailable or unmapped. There is
   * deliberately no write counterpart: tests may observe game state, never change it.
   */
  peek(addr: number, len: number): Uint8Array | null;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function installTestAPI(rt: BGTRuntime): Promise<BGTTestAPI> {
  // The probe exposes this binding BEFORE navigation/startup. No late resource checkpoint,
  // no native readback replaced by CPU shadows, and no recorder in ordinary production builds.
  const sink = (window as unknown as { __BGT_RECORD_FRAME__?: (frame: RecordedFrame) => Promise<boolean> }).__BGT_RECORD_FRAME__;
  if (sink) rt.frameObserver = async (...args) => { if (!await sink(recordFrame(...args))) rt.frameObserver = undefined; };
  const q = new URLSearchParams(location.search);
  const feature = q.get('deterministic') === '1' || q.get('savestates') === '1' ? await import('./savestates') : null;
  const codec = feature ? await import('./savestate-file') : null;
  const states = feature ? new feature.Savestates(rt,Number(q.get('seed') ?? 1)) : null;
  const required = () => { if (!states) throw new Error('Savestates require test-only ?deterministic=1 before boot'); return states; };
  const api: BGTTestAPI = {
    snapshot: () => required().snapshot(),
    exportSnapshot: (snapshot,options) => { required(); return codec!.exportSavestate(snapshot,options); },
    exportSnapshotDebugJson: snapshot => {required();return codec!.exportSavestateDebugJson(snapshot);},
    importSnapshotDebugJson: file => {required();return codec!.importSavestateDebugJson(file);},
    compactJournal:()=>required().compactJournal(),
    journalStats:()=>required().journalStats(),
    importSnapshot: file => { required(); return codec!.importSavestate(file); },
    restore: snapshot => required().restore(snapshot),
    ready: () => rt.ready && !rt.failed,
    pause: () => rt.pause(),
    resume: () => rt.resume(),
    failed: () => rt.failed,
    step: (frames) => rt.step(Math.max(0, Math.floor(frames))),
    input: (events) => rt.injectInput(events),
    async screenshot() {
      const px = await rt.readPixels();
      if (!px) throw new Error('screenshot unavailable (no renderer or device lost)');
      const cv = document.createElement('canvas');
      cv.width = px.width;
      cv.height = px.height;
      const c2 = cv.getContext('2d')!;
      c2.putImageData(new ImageData(new Uint8ClampedArray(px.data.buffer, px.data.byteOffset, px.data.byteLength), px.width, px.height), 0, 0);
      // Build the Blob from in-memory bytes: Chromium can back toBlob() results with a temp file
      // that intermittently fails to read (NotReadableError).
      return new Blob([unb64(cv.toDataURL('image/png').split(',')[1])], { type: 'image/png' });
    },
    diagnostics: () => rt.diagnostics(),
    stateHash: () => rt.host?.stateHash() ?? null,
    backend: () => rt.renderer?.kind ?? 'unavailable',
    async readPixels() {
      const px = await rt.readPixels();
      return px ? { width: px.width, height: px.height, base64: b64(px.data) } : null;
    },
    debugState: () => rt.host?.debugState() ?? null,
    coverage: () => rt.coverageSnapshot(),
    profileReset: () => rt.profileReset(),
    injectCommands: (base64) => rt.injectCommands(unb64(base64)),
    simulateDeviceLoss: (opts) => rt.simulateDeviceLoss(opts),
    peek: (addr, len) => rt.host?.peek(addr, len) ?? null,
  };
  (window as unknown as { __BGT_TEST__: BGTTestAPI }).__BGT_TEST__ = api;
  return api;
}
