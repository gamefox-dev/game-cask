import { describe, expect, it } from 'vitest';
import { BACKEND_HEADLESS } from '../../bgt/runtime/abi';
import { GameHost } from '../../bgt/runtime/host';
import { jspiApi, selectWasmVariant } from '../../bgt/runtime/jspi';
import { Vfs } from '../../bgt/runtime/vfs';
import { compileC } from '../support/compile';

const artifact = (url: string) => ({ url, size: 1, sha256: '0'.repeat(64) });
const services = () => ({ log: () => {}, vfs: new Vfs(), now: () => 0 });
const config = { backend: BACKEND_HEADLESS, caps: 0, seed: 1, displayWidth: 100, displayHeight: 100, arg0: 0, arg1: 0 };

describe('opt-in JSPI variant selection', () => {
  const manifest = { wasm: artifact('game.wasm'), variants: { jspi: artifact('game.jspi.wasm') } };
  it('uses Asyncify by default and when JSPI is unavailable', () => {
    expect(selectWasmVariant(manifest, undefined, true).mode).toBe('asyncify');
    expect(selectWasmVariant(manifest, 'jspi', true)).toEqual({ artifact: manifest.variants.jspi, mode: 'jspi' });
    expect(selectWasmVariant(manifest, 'asyncify', true).mode).toBe('asyncify');
    expect(selectWasmVariant(manifest, 'jspi', false)).toEqual({ artifact: manifest.wasm, mode: 'asyncify' });
    expect(selectWasmVariant({ wasm: manifest.wasm }, 'jspi', true)).toEqual({ artifact: manifest.wasm, mode: 'asyncify' });
  });

  it('honors a per-game JSPI preference, explicit override and unsupported fallback', () => {
    const preferred = { ...manifest, preferredSuspension: 'jspi' as const };
    expect(selectWasmVariant(preferred, undefined, true).mode).toBe('jspi');
    expect(selectWasmVariant(preferred, undefined, false).mode).toBe('asyncify');
    expect(selectWasmVariant(preferred, 'asyncify', true).mode).toBe('asyncify');
    expect(selectWasmVariant({wasm:manifest.wasm,preferredSuspension:'jspi'},undefined,true).mode).toBe('asyncify');
  });

  it('requires an actual JSPI API for a JSPI-only artifact and never invents fallback', () => {
    const only = { wasm: artifact('game.wasm'), suspension: 'jspi' as const };
    expect(selectWasmVariant(only, undefined, true)).toEqual({ artifact: only.wasm, mode: 'jspi' });
    expect(() => selectWasmVariant(only, undefined, false)).toThrow(/JSPI-only build requires/);
    expect(() => selectWasmVariant(only, 'asyncify', true)).toThrow(/no fallback artifact/);
  });

  it('runs a suspending import across fixed updates when JSPI is available', async () => {
    const plain = await compileC('tests/fixtures/c/yield_game.c');
    if (!jspiApi()) {
      await expect(GameHost.create(plain, services(), { ...config, suspensionMode: 'jspi' })).rejects.toThrow(/JSPI requested/);
      return;
    }
    const h = await GameHost.create(plain, services(), { ...config, suspensionMode: 'jspi' });
    h.init();
    expect(h.asyncCapable).toBe(true);
    for (let f = 1; f <= 300; f++) {
      await h.update();
      h.render();
      h.consume();
      expect(h.suspended).toBe(true);
      expect(h.stateHash()).toBe((f * 1000 + (f > 1 ? 15 + 19 + 35 + 51 + 67 : 0)).toString(16).padStart(8, '0'));
    }
    expect(h.yields).toBe(300);
    expect(h.importCounts.yield).toBe(300);
    expect(h.logicalWidth).toBe(128);
  }, 30_000);

  it('handles normal return, yield then return, overlap rejection and post-resume traps', async () => {
    if (!jspiApi()) return; // The required Chromium regression is unconditional; Node needs an explicit V8 flag.
    const make = async (mode: number) => {
      const wasm=await compileC('tests/fixtures/c/jspi_lifecycle.c',['MODE='+mode]);
      return GameHost.create(wasm,services(),{...config,suspensionMode:'jspi'});
    };
    const normal=await make(0);normal.init();
    for(let f=1;f<=5;f++){await normal.update();expect(normal.stateHash()).toBe(f.toString(16).padStart(8,'0'));}
    expect(normal.suspended).toBe(false);expect(normal.yields).toBe(0);
    const once=await make(1);
    await expect(once.update()).rejects.toThrow(/before init/);once.init();
    const first=once.update();await expect(once.update()).rejects.toThrow(/overlapping/);await first;
    expect(once.suspended).toBe(true);expect(once.stateHash()).toBe('00000001');
    await once.update();expect(once.suspended).toBe(false);expect(once.stateHash()).toBe('00000002');
    await once.update();expect(once.suspended).toBe(true);expect(once.stateHash()).toBe('00000003');
    const trap=await make(2);trap.init();await trap.update();
    await expect(trap.update()).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
    expect(trap.frameIndex).toBe(1);expect(trap.suspended).toBe(false);
    const initYield=await make(3);expect(()=>initYield.init()).toThrow(/only valid inside bgt_update/);
    const renderYield=await make(4);renderYield.init();expect(()=>renderYield.render()).toThrow(/only valid inside bgt_update/);
  },30_000);
});
