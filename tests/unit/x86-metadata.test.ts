// Original synthetic PEs: no external executables or target bytes.
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM
import { analyzePeMetadata } from '../../tools/x86/pe-metadata.mjs';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
function image(records = 8) {
  const b = Buffer.alloc(0x400 + records * 12 + 0x100);
  b.write('MZ'); b.writeUInt32LE(0x80, 60); b.write('PE\0\0', 0x80);
  b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(3, 0x86); b.writeUInt16LE(240, 0x94);
  const o = 0x98, s = 0x188;
  b.writeUInt16LE(0x20b, o); b.writeUInt32LE(0x1000, o + 16); b.writeBigUInt64LE(0x1000000n, o + 24);
  b.writeUInt32LE(0x100000, o + 56); b.writeUInt32LE(0x200, o + 60); b.writeUInt32LE(16, o + 108);
  b.writeUInt32LE(0x2000, o + 112 + 24); b.writeUInt32LE(records * 12, o + 116 + 24);
  const section = (at: number, name: string, rva: number, size: number, raw: number, rawSize = size) => {
    b.write(name, at); b.writeUInt32LE(size, at + 8); b.writeUInt32LE(rva, at + 12);
    b.writeUInt32LE(rawSize, at + 16); b.writeUInt32LE(raw, at + 20); b.writeUInt32LE(0x60000020, at + 36);
  };
  // Large raw overlay comes before .pdata in section order, but is only 8 virtual bytes.
  section(s, '.text', 0x1000, 0x100, 0x200);
  section(s + 40, 'overlay', 0x1800, 8, 0x300, b.length - 0x300);
  section(s + 80, '.pdata', 0x2000, records * 12 + 0x100, 0x400);
  b[0x200] = 0xc3;
  const rec = (i: number, begin = 0x1000, end = 0x1001, unwind = 0x2000 + records * 12) => {
    b.writeUInt32LE(begin, 0x400 + i * 12); b.writeUInt32LE(end, 0x404 + i * 12); b.writeUInt32LE(unwind, 0x408 + i * 12);
  };
  for (let i = 0; i < records; i++) rec(i);
  b[0x400 + records * 12] = 1;
  return { b, rec, unwind: 0x400 + records * 12 };
}
function withFile(b: Buffer, fn: (file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-metadata-'));
  try { const file = join(dir, 'synthetic.exe'); writeFileSync(file, b); fn(file); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
it('bounded .pdata skips three empty ranges, continues all 49,775 ranges, and exposes unwind slots', () => {
  const f = image(49778); for (let i = 0; i < 3; i++) f.rec(i, 0, 0, 0x1234 + i * 4);
  f.b[f.unwind + 2] = 2; f.b[f.unwind + 3] = 0x25;
  f.b.set([1, 0x30, 2, 0x12], f.unwind + 4);
  withFile(f.b, file => {
    const m = analyzePeMetadata(file);
    expect(m.errors).toEqual([]); expect(m.diagnostics.map((d: any) => d.kind)).toEqual(Array(3).fill('empty-runtime-function'));
    expect(m.runtimeFunctions).toHaveLength(49775);
    expect(m.runtimeFunctions[0]).toMatchObject({ index: 3, beginRva: 0x1000, endRva: 0x1001, version: 1, frameRegister: 5, frameOffset: 2, unwindCodes: [1, 0x30, 2, 0x12] });
  });
});
it('malformed ranges/unwind are diagnosed per record, do not abort later records, never map overlay as virtual data', () => {
  const f = image(); f.rec(0, 0x1002, 0x1001); f.rec(1, 0x1000, 0x100001);
  f.rec(2, 0x1000, 0x1001, 0x1900); f.rec(3, 0x1000, 0x1001, 0x100004);
  f.rec(4, 0x1000, 0x1001, 0x2061);
  withFile(f.b, file => {
    const m = analyzePeMetadata(file); expect(m.errors).toHaveLength(5);
    expect(m.runtimeFunctions.at(-1)).toMatchObject({ index: 7, version: 1 });
    expect(m.runtimeFunctions.find((f: any) => f.index === 2).unwindError).toMatch(/not backed/);
  });
});
it('UNWIND_INFO exposes aligned handler/chained tails and rejects truncated code arrays', () => {
  const f = image(3); f.b[f.unwind] = 1 | (4 << 3);
  f.b.writeUInt32LE(0x1000, f.unwind + 4); f.b.writeUInt32LE(0x1001, f.unwind + 8); f.b.writeUInt32LE(0x2024, f.unwind + 12);
  f.rec(1, 0x1000, 0x1001, 0x2040); f.b[f.unwind + 28] = 9; f.b.writeUInt32LE(0x1000, f.unwind + 32);
  f.rec(2, 0x1000, 0x1001, 0x2110); f.b[0x510] = 1; f.b[0x512] = 255;
  withFile(f.b, file => {
    const m = analyzePeMetadata(file);
    expect(m.runtimeFunctions[0].chainedFunction).toEqual({ beginRva: 0x1000, endRva: 0x1001, unwindRva: 0x2024 });
    expect(m.runtimeFunctions[1].handlerRva).toBe(0x1000); expect(m.errors).toHaveLength(1);
  });
});
it('malformed directory presence and chained unwind alignment remain explicit diagnostics', () => {
  const f = image(1); f.b.writeUInt32LE(0, 0x98 + 112 + 24);
  withFile(f.b, file => expect(analyzePeMetadata(file).errors).toEqual([expect.stringMatching(/RVA\/size/)]));
  f.b.writeUInt32LE(0x2000, 0x98 + 112 + 24); f.b[f.unwind] = 33;
  f.b.writeUInt32LE(0x1000, f.unwind + 4); f.b.writeUInt32LE(0x1001, f.unwind + 8); f.b.writeUInt32LE(0x200d, f.unwind + 12);
  withFile(f.b, file => expect(analyzePeMetadata(file).errors).toEqual([expect.stringMatching(/unaligned chained/)]));
});
it('a printable-byte instruction stream remains a genuine indirect callback on AMD64', () => {
  const f = image(1); f.rec(0, 0x1000, 0x1008); Buffer.from('488d0539000000c3', 'hex').copy(f.b, 0x200);
  // PUSH RAX x8, followed by NUL-encoded ADD [RAX],AL, then RET: it looks like a string, but is code.
  f.b.fill(0x50, 0x240, 0x248); f.b[0x248] = 0; f.b[0x249] = 0; f.b[0x24a] = 0xc3;
  withFile(f.b, file => {
    const a = JSON.parse(execFileSync(x86tool(), ['analyze', file], { encoding: 'utf8' }));
    expect(a.functions.some((f: any) => f.addr === 0x1001040)).toBe(true); expect(a.dataSeeds).toEqual([]);
  });
});
it('DIR64-only NULL data seed records relocated-pointer rejection provenance', () => {
  const f = image(1); f.b[0x200] = 0xc3;
  f.b.writeUInt32LE(0x2080, 0x98 + 112 + 5 * 8); f.b.writeUInt32LE(12, 0x98 + 116 + 5 * 8);
  f.b.writeUInt32LE(0x1000, 0x480); f.b.writeUInt32LE(12, 0x484); f.b.writeUInt16LE(0xa800, 0x488);
  f.b.writeBigUInt64LE(0x1001040n, 0x300);
  withFile(f.b, file => {
    const a = JSON.parse(execFileSync(x86tool(), ['analyze', file], { encoding: 'utf8' }));
    expect(a.dataSeeds).toEqual([{ addr: 0x1001040, seed: 'relocated-pointer', reason: 'zero-pointer' }]);
    expect(a.totals.functions).toBe(1);
  });
});
it('AMD64 census matches function membership and prunes only pointer-proven NULL data, not UD2/calls/.pdata', () => {
  const f = image(1); f.rec(0, 0x1000, 0x1010);
  // LEA seeds: NULL pointer, UD2 function, direct-call target whose bytes are zero.
  const code = Buffer.from('488d0539000000488d0542000000d9e8c3488d0548000000e843000000c3', 'hex'); code.copy(f.b, 0x200);
  f.b[0x250] = 0x0f; f.b[0x251] = 0x0b;
  // Entry range includes FLD1, leaf at 0x1010 includes a second FLD1.
  f.b[0x21d] = 0xd9; f.b[0x21e] = 0xe8; f.b[0x21f] = 0xc3;
  f.rec(0, 0x1000, 0x1020);
  withFile(f.b, file => {
    const a = JSON.parse(execFileSync(x86tool(), ['analyze', file], { encoding: 'utf8' }));
    expect(a.totals.fpu).toBe(2); expect(a.census.fpu).toBe(2);
    expect(a.functions.reduce((n: number, f: any) => n + f.fpu, 0)).toBe(a.census.fpu);
    expect(a.dataSeeds).toContainEqual({ addr: 0x1001040, seed: 'immediate-pointer', reason: 'zero-pointer' });
    expect(a.functions.some((f: any) => f.addr === 0x1001050)).toBe(true);
    expect(a.functions.some((f: any) => f.addr === 0x1001060)).toBe(true);
    expect(a.functions.some((f: any) => f.addr === 0x1001000)).toBe(true);
  });
});
