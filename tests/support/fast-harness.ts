// Shared by the fast-lifting unit tests (K52 lift-fast, K78 fast-check): a minimal PE around raw AMD64 code, the
// lifter on it, and the production runtime + emitted code compiled to wasm (tests/fixtures/c/native_calls_harness.h)
// with complete CPU/RAM snapshots, run lifted or interpreted.
import { expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './headless';
// @ts-expect-error plain ESM
import { CFLAGS, LDFLAGS, WASM_OPT_FEATURES } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { requireZig } from '../../tools/build/toolchain.mjs';
// @ts-expect-error plain ESM
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error plain ESM
import { functionNames } from '../../tools/build/wasm-names.mjs';
import { instantiateFixture } from './wasm-fixture';

export type Cut = number | [number, number];
export function fastHarness(tool: () => string) {
  function pe(code: Buffer, cuts: Cut[]) {
    const b = Buffer.alloc(0x400 + Math.ceil(code.length / 512) * 512);
    b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80); b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(2, 0x86); b.writeUInt16LE(240, 0x94); b.writeUInt16LE(0x20b, 0x98);
    b.writeUInt32LE(0x1000, 0xa8); b.writeBigUInt64LE(0x1000n, 0xb0); b.writeUInt32LE(0x10000, 0xd0); b.writeUInt32LE(0x200, 0xd4); b.writeUInt32LE(0x200, 0x98 + 112 + 24); b.writeUInt32LE(cuts.length * 12, 0x98 + 116 + 24);
    for (const [i, name, rva, size, raw] of [[0, '.text', 0x1000, code.length, 0x400], [1, '.pdata', 0x200, cuts.length * 12, 0x200]] as const) {
      const s = 0x188 + i * 40; b.write(name, s); b.writeUInt32LE(size, s + 8); b.writeUInt32LE(rva, s + 12); b.writeUInt32LE(size, s + 16); b.writeUInt32LE(raw, s + 20); b.writeUInt32LE(i ? 0x40000040 : 0x60000020, s + 36);
    }
    // .pdata: a cut runs to the next cut (or the end of the code); a [start, end] pair leaves the bytes after it
    // without unwind data (functions found only as call targets: no .pdata sweep).
    const start = (c: Cut) => (Array.isArray(c) ? c[0] : c);
    cuts.forEach((c, i) => { b.writeUInt32LE(0x1000 + start(c), 0x200 + i * 12); b.writeUInt32LE(0x1000 + (Array.isArray(c) ? c[1] : cuts[i + 1] !== undefined ? start(cuts[i + 1]) : code.length), 0x204 + i * 12); });
    code.copy(b, 0x400); return b;
  }
  function lift(code: Buffer, cuts: Cut[], args: string[]) {
    const root = join(ROOT, 'node_modules/.cache/bgt/lift-fast'); mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      writeFileSync(join(dir, 'test.exe'), pe(code, cuts));
      execFileSync(tool(), ['lift', join(dir, 'test.exe'), '--base', '1000', '--name', 'probe', '--out', join(dir, 'lifted.c'), ...args], { stdio: 'pipe' });
      return readFileSync(join(dir, 'lifted.c'), 'utf8');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  async function harness(code: Buffer, cuts: Cut[], args: string[], suspension?: 'asyncify' | 'jspi') {
    const root = join(ROOT, 'node_modules/.cache/bgt/lift-fast'); mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'run-'));
    try {
      const text = lift(code, cuts, args);
      const defines = ['X86_ACCOUNTING_ENABLED=1', 'X86_NATIVE_STATS=1', 'X86_FLAT_GUEST=1', 'X86_FLAT_BYTES=65536ull', 'X86_PROFILE_ENABLED=0', 'X86_COVERAGE_MODE=0'];
      writeFileSync(join(dir, 'test.c'), defines.map((d) => '#define ' + d.replace('=', ' ')).join('\n') + '\nstatic const unsigned char test_code[]={' + [...code].join(',') + '};\n' +
        text.replace('#include "x86_lift64.h"', '#include "' + ROOT + '/platforms/x86/x86_lift64.h"') + '\n#include "' + ROOT + '/tests/fixtures/c/native_calls_harness.h"\n');
      const out = join(dir, 'raw.wasm');
      execFileSync(requireZig({ quiet: true }).path, ['cc', ...CFLAGS, ...defines.map((d) => '-D' + d), '-I', join(ROOT, 'bgt/include'), '-I', join(ROOT, 'platforms/x86'),
        join(dir, 'test.c'), join(ROOT, 'bgt/sdk/bgt_libc.c'), ...LDFLAGS.filter((f: string) => f !== '-Wl,--strip-debug'), '-o', out], { stdio: 'pipe' });
      let raw = new Uint8Array(readFileSync(out));
      if (suspension === 'asyncify') {
        const linked = new Set(functionNames(raw).map((n: { name: string }) => n.name));
        const names = [...text.matchAll(/void (N_[0-9a-f]+)\(uint32_t pc\)\{/g)].map((m) => m[1]).filter((n) => linked.has(n));
        transform(out, join(dir, 'async.wasm'), [...WASM_OPT_FEATURES, '-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
          ...(names.length ? ['--pass-arg=asyncify-removelist@' + names.join(',')] : [])]);
        raw = new Uint8Array(readFileSync(join(dir, 'async.wasm')));
      }
      const { exports, host, logs } = await instantiateFixture(raw, suspension ? { suspensionMode: suspension } : {});
      const ex = exports as unknown as { memory: WebAssembly.Memory; prepare(i: number, pc: number, b: number): void; execute(): void; resume(): void; cpu(): number; ram(): number;
        interpretation(): number; generic(): number; set_reg(i: number, v: bigint): void; configure_service(n: number): void; service_count(): number; service_complete(): number; retired(): bigint;
        service_flag(i: number): number; frame_insns(): number; tsc(): bigint; state_hash(parts: number): number; poke_backing(addr: number, v: number): void; page_mapped(addr: number): number;
        sync_violations(): number; sync_by_kind(k: number): number; sync_first(i: number): number; sync_live(): number; sync_reset(): void };
      const view = () => new DataView(ex.memory.buffer);
      const eip = () => view().getUint32(ex.cpu() + 128, true);
      /* Run to the sentinel return, resuming after every scheduler transfer. */
      const run = (interpreted: number, budget: number, setup?: () => void) => {
        ex.prepare(interpreted, 0x2000, budget); setup?.(); ex.execute();
        for (let n = 0; n < 64 && eip() !== 0xfffffff4; n++) ex.resume();
        expect(eip()).toBe(0xfffffff4);
        return { regs: new Uint8Array(ex.memory.buffer).slice(ex.cpu(), ex.cpu() + 128), ram: new Uint8Array(ex.memory.buffer).slice(ex.ram() + 0x1000, ex.ram() + 0xa000), retired: ex.retired(),
          clock: { tsc: ex.tsc(), frame: ex.frame_insns() } };
      };
      return { ex, host, text, run, logs };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { pe, lift, harness };
}
