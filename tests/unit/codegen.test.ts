// Generated C versus the unchanged instruction interpreter: full CPU bytes and RAM, not API hashes alone.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compileC } from '../support/compile';
import { ROOT } from '../support/headless';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
const base = 0x01001000;

// Minimal original PE32+ container with one .pdata range. No host execution or external binary input.
function pe(code: Buffer): Buffer {
  const b = Buffer.alloc(0x400 + Math.ceil(code.length / 512) * 512);
  b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80);
  b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(2, 0x86); b.writeUInt16LE(240, 0x94);
  b.writeUInt16LE(0x20b, 0x98); b.writeUInt32LE(0x1000, 0x98 + 16);
  b.writeBigUInt64LE(0x01000000n, 0x98 + 24); b.writeUInt32LE(0x10000, 0x98 + 56);
  b.writeUInt32LE(0x200, 0x98 + 60); b.writeUInt32LE(0x200, 0x98 + 112 + 3 * 8);
  b.writeUInt32LE(12, 0x98 + 116 + 3 * 8);
  const s = 0x188;
  b.write('.text', s); b.writeUInt32LE(code.length, s + 8); b.writeUInt32LE(0x1000, s + 12);
  b.writeUInt32LE(code.length, s + 16); b.writeUInt32LE(0x400, s + 20);
  b.writeUInt32LE(0x60000020, s + 36);
  b.write('.pdata', s + 40); b.writeUInt32LE(12, s + 48); b.writeUInt32LE(0x200, s + 52);
  b.writeUInt32LE(12, s + 56); b.writeUInt32LE(0x200, s + 60); b.writeUInt32LE(0x40000040, s + 76);
  b.writeUInt32LE(0x1000, 0x200); b.writeUInt32LE(0x1000 + code.length, 0x204);
  code.copy(b, 0x400); return b;
}
it.each(['--lift-inline-memory', '--lift-inline-alu', '--lift-affine-counting', '--lift-optimize-small'])(
  'CLI %s rejects invalid values and accepts on/off', (option) => {
    const root = join(ROOT, 'node_modules/.cache/bgt/codegen-tests'); mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'cli-'));
    try {
      const input = join(dir, 'input.exe'), output = join(dir, 'lifted.c');
      writeFileSync(input, pe(Buffer.from('4883c001c3', 'hex')));
      const tool = x86tool();
      const args = ['lift', input, '--name', 'probe', '--out', output, option];
      const invalid = spawnSync(tool, [...args, 'banana'], { encoding: 'utf8' });
      expect(invalid.error).toBeUndefined();
      expect(invalid.status).toBe(2);
      expect(invalid.stderr).toContain(`${option} must be on or off`);
      for (const value of ['on', 'off']) {
        const valid = spawnSync(tool, [...args, value], { encoding: 'utf8' });
        expect(valid.error).toBeUndefined();
        expect(valid.status, valid.stderr).toBe(0);
        expect(readFileSync(output, 'utf8')).toContain('void F_01001000(void)');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
);

describe.each(['size', 'fast'])('lift preset %s', (preset) => {
const fast = preset === 'fast';
async function harness(hex: string) {
  const root = join(ROOT, 'node_modules/.cache/bgt/codegen-tests'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-')), code = Buffer.from(hex, 'hex');
  writeFileSync(join(dir, 'input.exe'), pe(code));
  execFileSync(x86tool(), ['lift', join(dir, 'input.exe'), '--name', 'probe', '--out', join(dir, 'lifted.c'), '--lift-preset', fast ? 'fast' : 'size']);
  const text = readFileSync(join(dir, 'lifted.c'), 'utf8');
  const source = `static const unsigned char test_code[]={${[...code].join(',')}};\n`
    + `#include "${ROOT}/tests/fixtures/c/codegen_harness.h"\n`
    + text.replace('#include "x86_lift64.h"', `#include "${ROOT}/platforms/x86/x86_lift64.h"`) + `
BGT_EXPORT(run) unsigned run(unsigned interpreted) {
    unsigned fallback_blocks=0;
    for(unsigned guard=0;!X.transfer && X.eip>=${base}u && X.eip<${base + code.length}u;guard++) {
        if(guard>5000000u)__builtin_trap();
        if(interpreted){reference();continue;}
        F_01001000();
        if(x86_lift_pending){const x86_insn_t *p=x86_lift_pending;x86_lift_pending=0;x86_exec_one(p);}
        else if(x86_lift_count){unsigned n=x86_lift_count;x86_lift_count=0;fallback_blocks++;x86_lift_block(n);}
    }
    return fallback_blocks;
}`;
  writeFileSync(join(dir, 'probe.c'), source);
  const wasm = await compileC(relative(ROOT, join(dir, 'probe.c')));
  const { instance } = await WebAssembly.instantiate(wasm, { bgt: { coverage_entry: () => {} } });
  const ex = instance.exports as any;
  const memory = () => new Uint8Array(ex.memory.buffer);
  const view = () => new DataView(ex.memory.buffer);
  return { ex, memory, view, code, text, stats: JSON.parse(readFileSync(join(dir, 'lifted.c.stats.json'), 'utf8')) };
}

it('specialized ALU flag masks agree with all arithmetic reference flags and preserve dead bits', async () => {
  const dir = join(ROOT, 'node_modules/.cache/bgt/codegen-alu'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'probe.c'), `
#define X86_WIDE_CPU 1
#include "${ROOT}/platforms/x86/x86_lift64.h"
#include "bgt.h"
x86_cpu_t X;
BGT_EXPORT(check) unsigned check(void) {
 unsigned ops[]={XO_ADD,XO_ADC,XO_SUB,XO_SBB,XO_CMP,XO_AND,XO_OR,XO_XOR,XO_TEST};
 unsigned masks[]={0,1,4,16,64,128,2048,0x8d5};
 uint64_t values[]={0,1,15,16,127,128,255,256,32767,32768,65535,0x7fffffff,0x80000000,
                   0xffffffff,0x7fffffffffffffffull,0x8000000000000000ull,UINT64_MAX};
 for(unsigned n=1;n<=8;n*=2)for(unsigned op=0;op<9;op++)
 for(unsigned i=0;i<17;i++)for(unsigned j=0;j<17;j++)for(unsigned carry=0;carry<2;carry++) {
   X.flags=0xcd4|carry;uint64_t want=x64_alu(ops[op],values[i],values[j],n);unsigned wf=X.flags;
   for(unsigned k=0;k<8;k++) {unsigned f=0xcd4|carry;uint64_t got=xl_alu(ops[op],values[i],values[j],n,&f,masks[k]);
     if(got!=want||((wf^f)&masks[k])||((f^(0xcd4|carry))&~masks[k]))return 1;
   }
 }
 return 0;
}`);
  const { instance } = await WebAssembly.instantiate(await compileC(relative(ROOT, join(dir, 'probe.c'))));
  expect((instance.exports.check as () => number)()).toBe(0);
});

it('inline memory checks match the slow path for width, holes, protection and full-width bounds', async () => {
  const dir = join(ROOT, 'node_modules/.cache/bgt/codegen-pointer'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'probe.c'), `
static const unsigned char test_code[]={0xc3};
#include "${ROOT}/tests/fixtures/c/codegen_harness.h"
BGT_EXPORT(check) unsigned check(void) {
 uint64_t addresses[]={0,1,4095,4096,8190,8192,65520,65535,65536,0xffffffffull,
                       0x100002000ull,UINT64_MAX-7,UINT64_MAX};
 unsigned widths[]={0,1,2,4,8,16,4096,4097,12288};
 unsigned modes[]={0,1,2,4,0x10,0x20,0x40,0xff};
 for(unsigned mode=0;mode<8;mode++)for(unsigned hole=0;hole<2;hole++) {
  reset(0,0);x86_protection[1]=modes[mode];if(hole)x86_pages[2]=0;
  for(unsigned i=0;i<13;i++)for(unsigned n=0;n<9;n++)for(unsigned a=1;a<=3;a++)
   if(xl_pointer_access(addresses[i],widths[n],a)!=xl_pointer_slow(addresses[i],widths[n],a))return 1;
 }
 return 0;
}`);
  const { instance } = await WebAssembly.instantiate(await compileC(relative(ROOT, join(dir, 'probe.c'))));
  expect((instance.exports.check as () => number)()).toBe(0);
});

it('native locals, byte aliases, branches, memory and generic barriers preserve every CPU byte', async () => {
  // Includes a carry reader after INC, dead flag writes, a join, a backwards loop, and CPUID as a generic barrier.
  const h = await harness('48b88877665544332211b4aa40b4554883c00148ffc04883d000'
    + 'b90300000048c7c300200000488903488b034883c001ffc975f24885c00f95c20fa2c3');
  const execute = (interp: number, entry = base, budget = 0) => {
    h.ex.reset(entry, budget); h.ex.run(interp);
    return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
      ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536), yields: h.ex.yields() };
  };
  expect(h.stats.specialized).toBeGreaterThan(10); expect(h.stats.generic).toBe(1);
  expect(h.stats.flagsElided).toBeGreaterThan(0);
  expect(execute(0)).toEqual(execute(1));
  expect(execute(0, base, 1999995)).toEqual(execute(1, base, 1999995));
  // Entry in the middle of a native basic block must resume correctly, not run its prefix again.
  expect(execute(0, base + 10)).toEqual(execute(1, base + 10));
});

it('affine counting preserves RDTSC, forward diamonds, loop yields and every interior entry', async () => {
  // Three loop iterations take both forward paths. RDTSC is a generic observation boundary.
  const h = await harness('b90300000031c0ffc083f802740583c003eb03909090ffc975ed0f31c3');
  expect(h.text.includes('debt+=')).toBe(fast);
  const snapshot = () => ({ cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
    ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536), yields: h.ex.yields(), clock: h.ex.clock() });
  for (const budget of [0, 1999960, 1999990, 1999999, 2000000]) for (const stop of [0, 1]) {
    h.ex.reset(base, budget); h.ex.stop_at_quantum(stop); h.ex.run(0); const lifted = snapshot();
    h.ex.reset(base, budget); h.ex.stop_at_quantum(stop); h.ex.run(1);
    expect(lifted, `budget=${budget} stop=${stop}`).toEqual(snapshot());
  }
  // Known instruction starts, including interior fallthrough (reference single-step resume).
  for (const offset of [0, 5, 7, 9, 12, 14, 17, 19, 20, 21, 22, 24, 26]) {
    h.ex.reset(base + offset, 0); h.ex.set_reg(1, 3n); h.ex.run(0); const lifted = snapshot();
    h.ex.reset(base + offset, 0); h.ex.set_reg(1, 3n); h.ex.run(1);
    expect(lifted, `interior=${offset}`).toEqual(snapshot());
  }
});

it('flat-memory faults spill locals, live flags and reference partial cross-page stores', async () => {
  for (const hex of [
    '48b8887766554433221148c7c3fc2f0000488903c3',
    // XOR's flags are live at the fault, despite the later ADD overwriting them on normal execution.
    '4831c048c7c3fc2f00004889034883c001c3',
    // An arithmetic memory destination computes flags before its failing write.
    '48c7c3fc2f000048830301c3',
  ]) {
    const h = await harness(hex);
    const execute = (interp: number) => {
      h.ex.reset(base, 0); h.ex.unmap(3);
      expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
    };
    expect(execute(0), hex).toEqual(execute(1));
  }
});

it('cold inverse-ALU recipes recover exact fault flags without saved hot operands', async () => {
  // Changing RBX within each block prevents the whole-span guard. Each first ALU's flags are
  // killed after the memory operation on the success path, but observable on its abort path.
  const cases = [
    '48c7c0ff0000004883c00148c7c300300000488b134883c001c3',
    '48c7c0000000004883e80148c7c3003000004889134883c001c3',
    '48c7c0000000004883f80148c7c300300000488b134883c001c3',
    '48c7c01000000048a91000000048c7c3003000004889134883c001c3',
    '48c7c0ff00000048ffc048c7c300300000488b134883c001c3',
    '48c7c00000000048ffc848c7c300300000488b134883c001c3',
    // Destroyed dependencies must keep conservative flags (AL and AH aliases, POP).
    '48c7c0100000004883c001b00048c7c300300000488b134883c001c3',
    '48c7c0100000004883e801b40048c7c300300000488b134883c001c3',
    // RSP update before a PUSH fault cannot use its post-decrement value to invert ADD.
    '48bc10300000000000004883ec08504883c001c3',
    // RMW store fault sees the newly computed flags, not the predecessor recipe.
    '48c7c0100000004883c00148c7c300300000488303014883c001c3',
  ];
  for (const [i, hex] of cases.entries()) {
    const h = await harness(hex);
    if (i < 6) expect(h.text.includes('{uint64_t z=')).toBe(fast);
    if (fast) expect(h.text).not.toContain('xl_alu_full(');
    const execute = (interp: number) => {
      h.ex.reset(base, 0);
      if (i === 9) h.ex.protect(3, 2); else h.ex.unmap(3);
      expect(() => h.ex.run(interp), `case ${i} ${hex}`).toThrow(WebAssembly.RuntimeError);
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536),
        address: h.ex.fault_address(), diagnostic: h.ex.fault_hash() };
    };
    expect(execute(0), hex).toEqual(execute(1));
  }
});

it('global protection flag disables lifted span fast paths and protected writes fault with identical state', async () => {
  // Straight-line guarded block writes across two mapped pages: first RW, second read-only.
  const h = await harness('48c7c3fc2f0000eb0048b88877665544332211488903c3');
  expect(h.text).toContain(`if(x86_protection_active||!${fast ? 'xl_pointer_fast' : 'xl_pointer'}(`);
  const execute = (interp: number) => {
    h.ex.reset(base, 0); h.ex.protect(3, 2); // PAGE_READONLY
    expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
    return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
      ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
  };
  expect(execute(0)).toEqual(execute(1));
  // A read-only load is legal, but the global flag must still force the checked boundary.
  const read = await harness('48c7c300300000eb00488b03c3');
  read.ex.reset(base, 0); read.ex.protect(3, 2);
  expect(read.ex.run(0)).toBeGreaterThan(0);
});

it('negative RBP displacements stay in signed guarded spans without reference fallback', async () => {
  // Set RBP in a preceding block so the guarded block has an unchanged base.
  // Wrongly zero-extending -8 guards RBP+0xfffffff8 instead and forces reference execution.
  const h = await harness('48c7c508200000eb00'
    + '48b88877665544332211488945f8488b5df8488345f801c3');
  const execute = (interp: number) => {
    h.ex.reset(base, 0);
    const fallbackBlocks = h.ex.run(interp);
    return { fallbackBlocks, cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
      ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
  };
  const lifted = execute(0), interpreted = execute(1);
  expect(lifted.fallbackBlocks).toBe(0);
  expect(lifted).toEqual(interpreted);
  expect(new DataView(lifted.ram.buffer).getBigUint64(0x2000, true)).toBe(0x1122334455667789n);
  expect(h.text).toContain('+0xfffffffffffffff8ull,8u)');
});

it.each([
  // Absolute SIB disp32 is signed in addr64 mode; normalized RIP-relative addresses are uint32.
  ['488b0425f8ffffffc3', 'fffffffffffffff8'],
  ['488b05f1effffec3', 'fffffff8'],
])('no-base guard displacement keeps its address width (%s)', async (hex, offset) => {
  const h = await harness(hex);
  expect(h.text).toContain(`+0x${offset}ull,8u)`);
  const execute = (interp: number) => {
    h.ex.reset(base, 0);
    expect(() => h.ex.run(interp)).toThrow(WebAssembly.RuntimeError);
    return h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size());
  };
  expect(execute(0)).toEqual(execute(1));
});

it('implicit stack operations retain reference low-address behavior for full-width RSP', async () => {
  for (const hex of ['48bc008000000100000050c3', '48bc008000000100000058c3']) {
    const h = await harness(hex);
    const execute = (interp: number) => {
      h.ex.reset(base, 0);
      let faulted = false;
      try { h.ex.run(interp); } catch (e) {
        expect(e).toBeInstanceOf(WebAssembly.RuntimeError); faulted = true;
      }
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536), faulted };
    };
    expect(execute(0), hex).toEqual(execute(1));
  }
});

it('prefix variants of SSE logical memory operations preserve reference scalar read widths', async () => {
  let hex = '48c7c30020000048b8887766554433221148890348b8ffeeddccbbaa998848894308';
  let offset = 0x100;
  for (const prefix of ['f2', 'f3']) for (const op of ['54', '55', '56', '57']) {
    const disp = Buffer.alloc(4); disp.writeUInt32LE(offset); offset += 16;
    hex += `660f1003${prefix}0f${op}03660f1183${disp.toString('hex')}`;
  }
  const h = await harness(hex + 'c3');
  const execute = (interp: number) => {
    h.ex.reset(base, 0); h.ex.run(interp);
    return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
      ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
  };
  expect(h.stats.generic).toBe(0);
  expect(execute(0)).toEqual(execute(1));
});

it('specialized SSE loads, scalar upper lanes, arithmetic and stores match every CPU byte', async () => {
  const h = await harness('48c7c30020000048b8000000000000f83f488903'
    + 'f20f1003f20f10c8f20f58c1f20f110348b8000000000000004048894308'
    + '660f100b660f57c1660f58c1660f1103f30f100bf30f11c8c3');
  const execute = (interp: number) => {
    h.ex.reset(base, 0); h.ex.run(interp);
    return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
      ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
  };
  expect(h.stats.generic).toBe(0);
  expect(execute(0)).toEqual(execute(1));
});
});
