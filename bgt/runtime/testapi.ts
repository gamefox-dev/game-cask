// Debug-only deterministic test interface, installed as window.__BGT_TEST__.
// Present in dev builds and builds made with VITE_BGT_TEST=1; never in a
// plain production build (see web/src/main.ts).

import type { BGTDiagnostics, BGTRuntime } from './runtime';
import type { DecodeResult } from './commands';
import type { TestInputEvent } from '../input/input';

export type BGTTestInputEvent = TestInputEvent;

export interface BGTPixels {
  width: number;
  height: number;
  /** base64 RGBA8, rows top-to-bottom, device pixels of the whole canvas. */
  base64: string;
}

export interface BGTTestAPI {
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
  injectCommands(base64: string): DecodeResult | null;
  simulateDeviceLoss(opts?: { unrecoverable?: boolean }): Promise<void>;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function installTestAPI(rt: BGTRuntime): BGTTestAPI {
  const api: BGTTestAPI = {
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
      return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    },
    diagnostics: () => rt.diagnostics(),
    stateHash: () => rt.host?.stateHash() ?? null,
    backend: () => rt.renderer?.kind ?? 'unavailable',
    async readPixels() {
      const px = await rt.readPixels();
      return px ? { width: px.width, height: px.height, base64: b64(px.data) } : null;
    },
    debugState: () => rt.host?.debugState() ?? null,
    injectCommands: (base64) => rt.injectCommands(unb64(base64)),
    simulateDeviceLoss: (opts) => rt.simulateDeviceLoss(opts),
  };
  (window as unknown as { __BGT_TEST__: BGTTestAPI }).__BGT_TEST__ = api;
  return api;
}
