// Input aggregation: keyboard, pointer/touch, gamepad, on-screen touch
// overlay and scripted test input all merge into one InputSnapshot per
// simulation step. Presses are latched so a tap shorter than one step is
// never lost.

import { BUTTONS, ButtonName, EVENT_AUDIO_UNLOCKED, EVENT_FOCUS_LOST, EVENT_RESIZED, EVENT_DEVICE_RESET } from '../runtime/abi';
import type { InputSnapshot } from '../runtime/host';
import type { Letterbox } from '../renderers/types';

/** KeyboardEvent.code -> USB HID usage id. */
export const HID: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = 4 + i;
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 29 + i;
  m.Digit0 = 39;
  Object.assign(m, {
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
    Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
    Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
    ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
    NumpadEnter: 88, ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  });
  for (let i = 1; i <= 12; i++) m[`F${i}`] = 57 + i;
  return m;
})();

export const DEFAULT_KEYMAP: Record<string, ButtonName> = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  KeyW: 'UP', KeyS: 'DOWN', KeyA: 'LEFT', KeyD: 'RIGHT',
  KeyZ: 'A', Space: 'A', KeyX: 'B', KeyC: 'X', KeyV: 'Y',
  Enter: 'START', NumpadEnter: 'START', ShiftRight: 'SELECT', Backspace: 'SELECT',
  KeyQ: 'L', KeyE: 'R',
};

/** Standard Gamepad mapping button index -> virtual button. */
const PAD_BUTTONS: Array<[number, ButtonName]> = [
  [0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'L'], [5, 'R'], [8, 'SELECT'], [9, 'START'],
  [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT'],
];

export type TestInputEvent =
  | { type: 'key'; code: string; down: boolean }
  | { type: 'button'; button: ButtonName; down: boolean }
  /** buttons: MouseEvent.buttons bitmask (1 primary, 2 secondary, 4 middle); overrides `down`. */
  | { type: 'pointer'; x: number; y: number; down?: boolean; buttons?: number };

export interface TouchConfig {
  dpad?: boolean;
  buttons?: ButtonName[];
  labels?: Partial<Record<ButtonName, string>>;
}

export interface InputConfig {
  /** KeyboardEvent.code -> button; `null` removes a default binding (e.g. "KeyW": null). */
  keys?: Record<string, ButtonName | null>;
}

const setBit = (arr: Uint32Array, k: number, on: boolean) => {
  if (k < 0 || k > 255) return;
  if (on) arr[k >> 5] |= 1 << (k & 31);
  else arr[k >> 5] &= ~(1 << (k & 31));
};

export class InputManager {
  private keymap: Record<string, ButtonName>;
  private keysHeld = new Uint32Array(8);
  private keysLatched = new Uint32Array(8);
  private keyButtons = new Map<string, ButtonName>();
  private sources = { keys: 0, overlay: 0, test: 0, pad: 0 };
  private latchedPress = 0;
  private prevButtons = 0;
  private pointer = { x: -1, y: -1, buttons: 0, inside: false, latched: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private events = 0;
  private axes: [number, number, number, number] = [0, 0, 0, 0];
  private overlayEl: HTMLElement | null = null;
  private disposers: Array<() => void> = [];
  letterbox: Letterbox = { x: 0, y: 0, w: 1, h: 1, scale: 1 };
  logicalW = 1;
  logicalH = 1;
  dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    cfg: InputConfig = {},
  ) {
    this.keymap = { ...DEFAULT_KEYMAP };
    for (const [code, btn] of Object.entries(cfg.keys ?? {})) {
      if (btn === null) delete this.keymap[code];
      else this.keymap[code] = btn;
    }
  }

  attach(): void {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (this.key(e.code, true) && !e.metaKey && !e.ctrlKey) e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.key(e.code, false);
    });
    on(window, 'blur', () => {
      this.keysHeld.fill(0);
      this.keyButtons.clear();
      this.sources.keys = 0;
      this.events |= EVENT_FOCUS_LOST;
    });
    const pt = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const dx = (e.clientX - r.left) * this.dpr, dy = (e.clientY - r.top) * this.dpr;
      const lb = this.letterbox;
      this.pointer.x = Math.floor(((dx - lb.x) / lb.w) * this.logicalW);
      this.pointer.y = Math.floor(((dy - lb.y) / lb.h) * this.logicalH);
      this.pointer.inside = this.pointer.x >= 0 && this.pointer.y >= 0 && this.pointer.x < this.logicalW && this.pointer.y < this.logicalH;
      this.pointer.buttons = e.buttons;
      if (e.pointerType === 'touch') {
        if (e.type === 'pointerup' || e.type === 'pointercancel') this.touches.delete(e.pointerId);
        else this.touches.set(e.pointerId, { x: this.pointer.x, y: this.pointer.y });
      }
    };
    on(this.canvas, 'pointerdown', (e: PointerEvent) => {
      pt(e);
      this.pointer.latched |= e.buttons || 1;
      this.canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    on(this.canvas, 'pointermove', pt);
    on(this.canvas, 'pointerup', pt);
    on(this.canvas, 'pointercancel', pt);
    on(this.canvas, 'contextmenu', (e: Event) => e.preventDefault());
  }

  private held(): number {
    return this.sources.keys | this.sources.overlay | this.sources.test | this.sources.pad;
  }

  /** Latch a press only on a real up->down transition of the merged button state. */
  private latch(bits: number, wasHeld: number): void {
    this.latchedPress |= bits & ~wasHeld;
  }

  /** Returns true when the key is mapped to a virtual button. */
  private key(code: string, down: boolean): boolean {
    const hid = HID[code];
    if (hid !== undefined) {
      setBit(this.keysHeld, hid, down);
      if (down) setBit(this.keysLatched, hid, true);
    }
    const btn = this.keymap[code];
    if (btn) {
      const was = this.held();
      if (down) this.keyButtons.set(code, btn);
      else this.keyButtons.delete(code);
      let m = 0;
      for (const b of this.keyButtons.values()) m |= BUTTONS[b];
      this.sources.keys = m;
      if (down) this.latch(BUTTONS[btn], was);
    }
    return !!btn;
  }

  injectTest(events: TestInputEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'key') this.key(ev.code, ev.down);
      else if (ev.type === 'button') {
        const bit = BUTTONS[ev.button];
        if (bit === undefined) throw new Error(`unknown button ${ev.button}`);
        if (ev.down) {
          this.latch(bit, this.held());
          this.sources.test |= bit;
        } else this.sources.test &= ~bit;
      } else if (ev.type === 'pointer') {
        this.pointer.x = Math.floor(ev.x);
        this.pointer.y = Math.floor(ev.y);
        this.pointer.inside = ev.x >= 0 && ev.y >= 0 && ev.x < this.logicalW && ev.y < this.logicalH;
        const b = ev.buttons ?? (ev.down ? 1 : 0);
        if (b && !this.pointer.buttons) this.pointer.latched |= b;
        this.pointer.buttons = b;
      }
    }
  }

  markEvent(ev: 'resized' | 'deviceReset' | 'audioUnlocked'): void {
    this.events |= ev === 'resized' ? EVENT_RESIZED : ev === 'deviceReset' ? EVENT_DEVICE_RESET : EVENT_AUDIO_UNLOCKED;
  }

  private pollGamepads(): void {
    this.sources.pad = 0;
    this.axes = [0, 0, 0, 0];
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      for (const [i, name] of PAD_BUTTONS) if (p.buttons[i]?.pressed) this.sources.pad |= BUTTONS[name];
      for (let a = 0; a < 4; a++) {
        const v = p.axes[a] ?? 0;
        if (Math.abs(v) > Math.abs(this.axes[a] / 32767)) this.axes[a] = Math.round(v * 32767);
      }
      const dz = 0.5;
      if ((p.axes[0] ?? 0) < -dz) this.sources.pad |= BUTTONS.LEFT;
      if ((p.axes[0] ?? 0) > dz) this.sources.pad |= BUTTONS.RIGHT;
      if ((p.axes[1] ?? 0) < -dz) this.sources.pad |= BUTTONS.UP;
      if ((p.axes[1] ?? 0) > dz) this.sources.pad |= BUTTONS.DOWN;
    }
    const newly = this.sources.pad & ~this.prevPad;
    this.latch(newly, this.sources.keys | this.sources.overlay | this.sources.test | this.prevPad);
    this.prevPad = this.sources.pad;
  }
  private prevPad = 0;

  /** Build the snapshot for the next simulation step and clear latches. */
  snapshot(out: InputSnapshot, pollPads = true): InputSnapshot {
    if (pollPads) this.pollGamepads();
    const held = this.sources.keys | this.sources.overlay | this.sources.test | this.sources.pad;
    const buttons = held | this.latchedPress;
    out.buttons = buttons;
    out.pressed = (buttons & ~this.prevButtons) | this.latchedPress;
    out.released = this.prevButtons & ~buttons;
    this.prevButtons = held;
    this.latchedPress = 0;
    for (let k = 0; k < 8; k++) {
      out.keys[k] = this.keysHeld[k] | this.keysLatched[k];
      out.keysPressed[k] = this.keysLatched[k];
    }
    this.keysLatched.fill(0);
    out.pointerX = this.pointer.x;
    out.pointerY = this.pointer.y;
    out.pointerButtons = this.pointer.buttons | this.pointer.latched;
    this.pointer.latched = 0;
    out.pointerInside = this.pointer.inside;
    out.axes = [...this.axes];
    out.touches = [...this.touches.entries()].slice(0, 4).map(([id, t]) => ({ id, ...t }));
    out.events = this.events;
    this.events = 0;
    return out;
  }

  /** On-screen controls for touch devices. Buttons are real <button>s for accessibility. */
  createOverlay(container: HTMLElement, cfg: TouchConfig): HTMLElement {
    const root = document.createElement('div');
    root.className = 'bgt-touch';
    root.setAttribute('aria-label', 'On-screen game controls');
    const mk = (btn: ButtonName, label: string, cls: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `bgt-touch-btn ${cls}`;
      b.textContent = label;
      b.dataset.button = btn;
      b.setAttribute('aria-label', btn.toLowerCase());
      const down = (e: Event) => {
        e.preventDefault();
        this.latch(BUTTONS[btn], this.held());
        this.sources.overlay |= BUTTONS[btn];
        b.classList.add('active');
      };
      const up = (e: Event) => {
        e.preventDefault();
        this.sources.overlay &= ~BUTTONS[btn];
        b.classList.remove('active');
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      return b;
    };
    if (cfg.dpad !== false) {
      const pad = document.createElement('div');
      pad.className = 'bgt-dpad';
      pad.append(mk('UP', '▲', 'up'), mk('LEFT', '◀', 'left'), mk('RIGHT', '▶', 'right'), mk('DOWN', '▼', 'down'));
      root.append(pad);
    }
    const acts = document.createElement('div');
    acts.className = 'bgt-actions';
    for (const b of cfg.buttons ?? ['A', 'B', 'START']) acts.append(mk(b, cfg.labels?.[b] ?? b, `act act-${b.toLowerCase()}`));
    root.append(acts);
    container.append(root);
    this.overlayEl = root;
    return root;
  }

  detach(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.overlayEl?.remove();
  }
}
