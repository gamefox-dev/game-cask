import { describe, expect, it } from 'vitest';
import { BACKEND_HEADLESS, E_UNSUPPORTED } from '../../bgt/runtime/abi';
import { GameHost, HostServices, emptyInput } from '../../bgt/runtime/host';
import { Vfs, normalizeAssetPath } from '../../bgt/runtime/vfs';
import { compileC } from '../support/compile';

const cfg = { backend: BACKEND_HEADLESS, caps: 0, seed: 1, displayWidth: 100, displayHeight: 100, arg0: 0, arg1: 0 };
const services = (logs: string[] = []): HostServices => ({ log: (_l, m) => logs.push(m), vfs: new Vfs(), now: () => 0 });
const variant = (n: number) => compileC('tests/fixtures/c/bad_game.c', [`VARIANT=${n}`]);

describe('game host lifecycle and validation', () => {
  it('rejects modules with imports outside the BGT ABI', async () => {
    // (module (import "env" "puts" (func)) (memory (export "memory") 1))
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 12, 1, 3, 101, 110, 118, 4, 112, 117, 116, 115, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0]);
    await expect(GameHost.create(wasm, services(), cfg)).rejects.toThrow(/env\.puts/);
  });

  it('rejects modules missing required exports', async () => {
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0]);
    await expect(GameHost.create(wasm, services(), cfg)).rejects.toThrow(/missing required exports: bgt_abi_version/);
  });

  it('rejects an invalid logical size', async () => {
    const h = await GameHost.create(await variant(1), services(), cfg);
    expect(() => h.init()).toThrow(/invalid logical size 0x0/);
    const h5 = await GameHost.create(await variant(5), services(), cfg);
    expect(() => h5.init()).toThrow(/invalid logical size 99999x10/);
  });

  it('propagates bgt_init error codes', async () => {
    const logs: string[] = [];
    const h = await GameHost.create(await variant(2), services(logs), cfg);
    expect(() => h.init()).toThrow(/BGT_E_UNSUPPORTED/);
    expect(logs).toEqual(['probe']);
    expect(E_UNSUPPORTED).toBe(-4);
  });

  it('surfaces bgt_abort as GameAbort and traps as RuntimeError', async () => {
    const a = await GameHost.create(await variant(3), services(), cfg);
    a.init();
    expect(() => a.update()).toThrow(/game aborted \(BGT_E_STATE\): deliberate abort/);
    const t = await GameHost.create(await variant(4), services(), cfg);
    t.init();
    expect(() => t.update()).toThrow(WebAssembly.RuntimeError);
  });

  it('hostile pointers/keys/paths get error codes, not memory access', async () => {
    const logs: string[] = [];
    const s = services(logs);
    s.storage = { persistent: true, read: () => null, write: () => 0 };
    const h = await GameHost.create(await variant(6), s, cfg);
    h.init();
    h.writeInput(emptyInput());
    h.update();
    expect(logs).toContain('hostile-ok');
    expect(logs).not.toContain('hostile-unexpected');
    expect(h.commandErrors.map((e) => e.code)).toEqual([-2]); // out-of-range submit recorded as BGT_E_BOUNDS
  });
});

describe('vfs', () => {
  it('normalizes and rejects unsafe paths', () => {
    expect(normalizeAssetPath('a/b.txt')).toBe('a/b.txt');
    for (const bad of ['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', './a', 'a/.']) expect(normalizeAssetPath(bad)).toBeNull();
  });

  it('reads, seeks and records missing assets', () => {
    const v = new Vfs();
    v.add('d/f.bin', new Uint8Array([1, 2, 3, 4, 5]));
    const h = v.openFile('d/f.bin');
    expect(h).toBeGreaterThan(0);
    const dst = new Uint8Array(3);
    expect(v.read(h, dst)).toBe(3);
    expect([...dst]).toEqual([1, 2, 3]);
    expect(v.read(h, dst)).toBe(2);
    expect(v.read(h, dst)).toBe(0);
    expect(v.seek(h, 1)).toBe(0);
    expect(v.seek(h, 6)).toBeLessThan(0);
    expect(v.close(h)).toBe(0);
    expect(v.read(h, dst)).toBeLessThan(0);
    expect(v.openFile('nope')).toBeLessThan(0);
    expect([...v.missing]).toEqual(['nope']);
  });
});
