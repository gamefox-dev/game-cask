// Headless (no GPU) harness for running BGT games in Node.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_HEADLESS, BUTTONS, ButtonName, CAP_DIRECT_DRAW, CAP_LINEAR_FILTER, CAP_RENDER_TARGETS, CAP_SCISSOR, CAP_STORAGE, CAP_TRIANGLES } from '../../bgt/runtime/abi';
import { GameHost, InputSnapshot, StorageSink, emptyInput } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { RangeFiles } from '../../bgt/runtime/range-files';
import { HID } from '../../bgt/input/input';
/* LANE-GL: opt-in command-stream validation without a pixel backend. */
import { CAP_GPU, CAP_READBACK } from '../../bgt/runtime/abi';
import type { GpuBackend } from '../../bgt/renderers/types';
import type { Frame } from '../../bgt/runtime/commands';
export interface StreamOptions {
  onLog?: (message: string) => void;
  entropy?: (bytes: Uint8Array) => void; /* LANE-K1: explicit oracle replay only */
  gpuBackend?: GpuBackend;
  executeFrame?: (frame: Frame) => void;
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Headless {
  host: GameHost;
  logs: string[];
  input: InputSnapshot;
  storage: Map<string, Uint8Array>;
  hold(...b: ButtonName[]): void;
  press(...b: ButtonName[]): void;
  release(): void;
  /** pointer in logical px; buttons = MouseEvent.buttons bitmask (latched like the runtime does) */
  pointer(x: number, y: number, buttons?: number): void;
  /** key by KeyboardEvent.code (held until released) */
  key(code: string, down: boolean): void;
  step(n?: number): void;
  stepAsync(n?: number): Promise<void>;
  state<T = Record<string, unknown>>(): T;
}

export async function loadHeadless(id: string, opts: StreamOptions & {
  seed?: number; arg0?: number; arg1?: number; storage?: Map<string, Uint8Array>; dir?: string;
} = {}): Promise<Headless> {
  const dir = opts.dir ?? join(ROOT, 'web', 'public', 'games', id);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const vfs = new Vfs();
  for (const a of manifest.assets) vfs.add(a.path, new Uint8Array(readFileSync(join(dir, 'assets', a.path))));
  const ranges = new RangeFiles('',async (url) => new Response(readFileSync(join(dir,String(url))))) ;
  for(const s of manifest.streams ?? []) { ranges.add(s);vfs.addStream(s.path,s.size,s.chunks); }
  const logs: string[] = [];
  const store = opts.storage ?? new Map<string, Uint8Array>();
  const storage: StorageSink = {
    persistent: true,
    read: (k) => store.get(k) ?? null,
    write: (k, d) => (store.set(k, d), 0),
  };
  const host = await GameHost.create(readFileSync(join(dir, 'game.wasm')), {
    log: (_l, m) => { logs.push(m);opts.onLog?.(m); },
    vfs,
    storage,
    entropy: opts.entropy, /* LANE-K1 */
    now: () => performance.now(),
    rangeRead:(path,offset,length,ahead)=>ranges.read(path,offset,length,ahead),
  }, {
    backend: BACKEND_HEADLESS,
    caps: CAP_STORAGE | CAP_LINEAR_FILTER | CAP_SCISSOR | CAP_TRIANGLES | CAP_DIRECT_DRAW | CAP_RENDER_TARGETS |
      (opts.gpuBackend ? CAP_GPU : 0) | (opts.executeFrame ? CAP_READBACK : 0), /* LANE-GL */
    gpuBackend: opts.gpuBackend,
    seed: opts.seed ?? 1,
    displayWidth: 640,
    displayHeight: 360,
    arg0: opts.arg0 ?? 0,
    arg1: opts.arg1 ?? 0,
    sliceCode:manifest.slice?.code,
  });
  host.init();
  const input = emptyInput();
  let held = 0;
  let prevHeld = 0;
  let latchedButtons = 0;
  const keysPressed = new Uint32Array(8);
  const h: Headless = {
    host,
    logs,
    input,
    storage: store,
    hold: (...b) => { held = b.reduce((m, n) => m | BUTTONS[n], 0); },
    press: (...b) => { held |= b.reduce((m, n) => m | BUTTONS[n], 0); },
    release: () => { held = 0; },
    pointer: (x, y, buttons = 0) => {
      if (buttons & ~input.pointerButtons) latchedButtons |= buttons & ~input.pointerButtons;
      input.pointerX = Math.floor(x); input.pointerY = Math.floor(y);
      input.pointerButtons = buttons; input.pointerInside = true;
    },
    key: (code, down) => {
      const hid = HID[code];
      if (hid === undefined) throw new Error(`unknown key ${code}`);
      if (down) { input.keys[hid >> 5] |= 1 << (hid & 31); keysPressed[hid >> 5] |= 1 << (hid & 31); }
      else input.keys[hid >> 5] &= ~(1 << (hid & 31));
    },
    step: (n = 1) => {
      for (let i = 0; i < n; i++) {
        input.buttons = held;
        input.pressed = held & ~prevHeld;
        input.released = prevHeld & ~held;
        prevHeld = held;
        const pb = input.pointerButtons;
        input.pointerButtons = pb | latchedButtons;
        for (let k = 0; k < 8; k++) input.keysPressed[k] = keysPressed[k];
        host.writeInput(input);
        input.pointerButtons = pb;
        latchedButtons = 0;
        keysPressed.fill(0);
        host.update();
        const frame = host.render();
        opts.executeFrame?.(frame); /* LANE-GL: requests still become visible only at the next update. */
        host.consume();
      }
    },
    stepAsync: async (n=1) => { for(let i=0;i<n;i++) { await host.settleRequests();h.step(1); } },
    state: <T,>() => host.debugState() as T,
  };
  return h;
}
