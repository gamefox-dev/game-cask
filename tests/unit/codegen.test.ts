// @bgt-examples: none
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
async function harness(hex: string, defines: string[] = []) {
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
  const wasm = await compileC(relative(ROOT, join(dir, 'probe.c')),defines);
  const coverage: [number, number][] = [];
  const { instance } = await WebAssembly.instantiate(wasm, { bgt: {
    coverage_entry: (address: number, kind: number) => coverage.push([address, kind]),
    slice_missing: () => { throw new Error('strict slice stop'); },
  } });
  const ex = instance.exports as any;
  const memory = () => new Uint8Array(ex.memory.buffer);
  const view = () => new DataView(ex.memory.buffer);
  return { ex, memory, view, code, text, coverage, input: join(dir, 'input.exe'),
    stats: JSON.parse(readFileSync(join(dir, 'lifted.c.stats.json'), 'utf8')) };
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

it('strict host restrictions stop an in-region indirect landing before its memory write',async()=>{
  // MOV EAX, internal target; JMP RAX; MOV [0x2000],123; RET. Target is in the same native region.
  const h=await harness('b807100001ffe0c70425002000007b000000c3',['X86_COVERAGE_MODE=2']);
  h.ex.reset(base,0);h.ex.configure_policy();
  expect(()=>h.ex.run(0)).toThrow('strict slice stop');
  expect(h.view().getUint32(h.ex.ram()+0x2000,true)).toBe(0);
});
it('an internal indirect jump does not taint a later direct region-exit census reason',async()=>{
  // Internal indirect target ends with a direct JMP outside the PE image.
  const h=await harness('b807100001ffe0e9f4efff00');
  h.ex.reset(base,0);h.ex.run(0);
  expect(h.ex.last_exit_reason()).toBe(6); // XE_OTHER, not stale XE_INDIRECT
});

it('buffers real emitted indirect-entry hooks without losing or inventing coverage', async () => {
  // Two accepted native entries; the external direct destination must not be recorded by this region.
  const h = await harness('b807100001ffe0e9f4efff00');
  for (let n = 0; n < 2; n++) { h.ex.reset(base, 0); h.ex.run(0); }
  expect(h.coverage).toEqual([]);
  expect(h.ex.coverage_events()).toBe(4n);
  expect(h.ex.coverage_hits()).toBe(2n);
  h.ex.coverage_flush();
  expect(h.coverage).toEqual([[base, 1], [base + 7, 1]]);
  expect(h.ex.coverage_crossings()).toBe(2n);
  h.ex.coverage_flush();
  expect(h.coverage).toHaveLength(2);
});

it('strict checks and buffered coverage also guard K13 native interior suffix entries', async () => {
  // The MOV at +7 is an interior native suffix, not a block-start dispatch case.
  const hex = 'b807100001ffe0c70425002000007b000000c3';
  const h = await harness(hex);
  h.ex.reset(base, 0); h.ex.run(0);
  expect(h.view().getUint32(h.ex.ram() + 0x2000, true)).toBe(123);
  expect(h.coverage).toEqual([]);
  h.ex.coverage_flush();
  expect(h.coverage).toEqual([[base, 1], [base + 7, 1]]);
  const strict = await harness(hex, ['X86_COVERAGE_MODE=2']);
  strict.ex.reset(base, 0); strict.ex.configure_policy();
  expect(() => strict.ex.run(0)).toThrow('strict slice stop');
  expect(strict.view().getUint32(strict.ex.ram() + 0x2000, true)).toBe(0);
});

it('classifies native interior quantum boundaries without losing suffix guard reasons', async () => {
  const hex = '90f30f2ac1c3';
  const h = await harness(hex);
  h.ex.reset(base + 1, 2000000); h.ex.stop_at_quantum(1); h.ex.run(0);
  expect(h.ex.last_block_reason()).toBe(3);
  const guard = await harness('90488b03c3');
  guard.ex.reset(base + 1, 0); guard.ex.set_reg(3, 0x3000n); guard.ex.protect(3, 2); guard.ex.run(0);
  expect(guard.ex.last_block_reason()).toBe(2);
});

it('classifies guard, quantum and interior semantic boundaries in both counting policies', async () => {
  const guard = await harness('48c7c300300000eb00488b03c3');
  guard.ex.reset(base, 0); guard.ex.protect(3, 2); guard.ex.run(0);
  expect(guard.ex.last_block_reason()).toBe(2); // XE_GUARD
  const quantum = await harness('90c3');
  quantum.ex.reset(base, 2000000); quantum.ex.stop_at_quantum(1); quantum.ex.run(0);
  expect(quantum.ex.last_block_reason()).toBe(3); // XE_QUANTUM, including affine reservation
  // Larger non-SSE suffixes intentionally retain the bounded shared-semantic boundary.
  const interior = await harness('b80100000083c002' + '90'.repeat(16) + 'c3');
  interior.ex.reset(base + 5, 0); interior.ex.run(0);
  expect(interior.ex.last_block_reason()).toBe(4); // XE_INTERIOR
});

it('interior native entries count only their suffix and never replay flags from an unexecuted prefix', async () => {
  // MOV RBX inside the block makes its whole-span guard unsafe. Enter at +4 (before MOV),
  // so the unmapped load must reach the native operand fault edge, not guarded semantic replay.
  // The ADD recipe at position 0 must never reconstruct flags from this unexecuted prefix.
  const h = await harness('4883c00148c7c300300000488b134883c001c3');
  for (const offset of [0, 4, 11, 14, 18]) for (const hole of [false, true]) {
    const execute = (interp: number) => {
      h.ex.reset(base + offset, 0); h.ex.set_reg(0, 42n); h.ex.set_reg(3, 0x3000n); h.ex.set_flags(0x8d5);
      if (hole) h.ex.unmap(3);
      let faulted = false, blocks = 0;
      try { blocks = h.ex.run(interp); } catch (e) { expect(e).toBeInstanceOf(WebAssembly.RuntimeError); faulted = true; }
      if (!hole && !interp) expect(blocks).toBe(0);
      if (hole && offset === 4) {
        expect(faulted).toBe(true);
        expect(h.ex.get_flags()).toBe(0x8d5);
      }
      return { faulted, cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
    };
    expect(execute(0), `entry=${offset} hole=${hole}`).toEqual(execute(1));
  }
});

it('SSE interior landings stay native without duplicating every large-region integer suffix', async () => {
  const h = await harness('90'.repeat(16) + 'f30f2ac1f30f5ac0f20f5cc1c3');
  expect(h.stats.generic).toBe(0);
  for (const offset of [16, 20, 24]) {
    h.ex.reset(base + offset, 0); h.ex.set_reg(1, 7n); expect(h.ex.run(0)).toBe(0);
    const want = h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size());
    h.ex.reset(base + offset, 0); h.ex.set_reg(1, 7n); h.ex.run(1);
    expect(h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size())).toEqual(want);
  }
  h.ex.reset(base + 1, 0); expect(h.ex.run(0)).toBeGreaterThan(0);
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

it('scalar conversions and COMI/UCOMI use native forms, exact RC, flags and integer indefinite', async () => {
  // Original CC0 encodings. Every form tested with register and exact-width memory operands.
  for (const prefix of ['f2', 'f3']) for (const wide of ['', '48']) {
    for (const op of ['2a', '2c', '2d']) {
      const h = await harness(`${prefix}${wide}0f${op}c1c3`);
      expect(h.stats.generic).toBe(0);
      if (op === '2a') {
        const listing = execFileSync(x86tool(), ['disasm', h.input], { encoding: 'utf8' });
        expect(listing).toContain(`cvtsi2${prefix === 'f2' ? 'sd' : 'ss'} xmm0, ${wide ? 'rcx' : 'ecx'}`);
      }
      for (const rc of [0, 1, 2, 3]) for (const bits of [0n, 0x3ff8000000000000n,
        0xbff8000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x43e0000000000000n,
        0xc1e0000000100000n, 0x7fffffffn, 0x8000000000000000n, 0xffffffffffffffffn]) {
        const execute = (interp: number) => {
          h.ex.reset(base, 0); h.ex.set_mxcsr(0x1f80 | rc << 13);
          h.ex.set_reg(1, bits); h.ex.set_xmm(0, 0x76543210abcdef01n, 0x123456789abcdef0n);
          h.ex.set_xmm(1, bits, 0xfedcba9876543210n); h.ex.run(interp);
          return h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size());
        };
        expect(execute(0), `${prefix}/${wide}/${op}/${rc}/${bits}`).toEqual(execute(1));
      }
    }
  }
  for (const prefix of ['', '66']) for (const op of ['2e', '2f']) {
    const h = await harness(`${prefix}0f${op}c1c3`);
    expect(h.stats.generic).toBe(0);
    const values = prefix ? [0n, 0x3ff0000000000000n, 0xbff0000000000000n, 0x7ff8000000000000n,
      0x7ff0000000000001n] : [0n, 0x3f800000n, 0xbf800000n, 0x7fc00000n, 0x7f800001n];
    for (const x of values) for (const y of values) {
      h.ex.reset(base, 0); h.ex.set_flags(0xffff); h.ex.set_xmm(0, x, 123n); h.ex.set_xmm(1, y, 456n);
      h.ex.run(0);
      const unordered = x === values[3] || x === values[4] || y === values[3] || y === values[4];
      const rank = (v: bigint) => v === values[2] ? -1 : v === values[1] ? 1 : 0;
      const expected = unordered ? 0x45 : rank(x) === rank(y) ? 0x40 : rank(x) < rank(y) ? 1 : 0;
      expect(h.ex.get_flags()).toBe((0xffff & ~0x8d5) | expected);
    }
  }
  for (const prefix of ['f2', 'f3']) for (const rex of ['', '48']) for (const op of ['2a', '2c', '2d']) {
    const h = await harness(`${prefix}${rex}0f${op}03c3`);
    expect(h.stats.generic).toBe(0);
    const width = op === '2a' ? rex ? 8 : 4 : prefix === 'f2' ? 8 : 4;
    for (const address of [0x3000 - width, 0x3000 - width + 1]) {
      const execute = (interp: number) => {
        h.ex.reset(base, 0); h.ex.set_reg(3, BigInt(address)); h.ex.unmap(3);
        h.view().setBigUint64(h.ex.ram() + address, 0x3ff8000000000000n, true);
        let faulted = false;
        try { h.ex.run(interp); } catch (e) { expect(e).toBeInstanceOf(WebAssembly.RuntimeError); faulted = true; }
        expect(faulted).toBe(address > 0x3000 - width);
        return { faulted, cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()) };
      };
      expect(execute(0), `${prefix}/${rex}/${op}/${address}`).toEqual(execute(1));
    }
  }
  // CVTSS2SD reads 4 bytes at page edge (not 16); CVTSD2SS reads 8. Upper lanes survive.
  for (const [prefix, width, bits, result] of [
    ['f3', 4, 0x3fc00000n, 0x3ff8000000000000n], ['f2', 8, 0x3ff8000000000000n, 0xabcdef013fc00000n],
  ] as const) {
    const h = await harness(`${prefix}0f5a03c3`);
    expect(h.stats.generic).toBe(0);
    h.ex.reset(base, 0); h.ex.set_reg(3, BigInt(0x3000 - width)); h.ex.unmap(3);
    h.view().setBigUint64(h.ex.ram() + 0x3000 - width, bits, true);
    h.ex.set_xmm(0, 0xabcdef0100000000n, 0xfedcba9876543210n); h.ex.run(0);
    expect(h.ex.get_xmm(0, 0)).toBe(BigInt.asIntN(64, result));
    expect(h.ex.get_xmm(0, 1)).toBe(BigInt.asIntN(64, 0xfedcba9876543210n));
  }
});

it('native SSE memory reads accept read-only pages while stores and RMW still fault truthfully', async () => {
  const forms = ['0f2e03', '0f2f03', '660f2e03', '660f2f03', 'f30f5a03', 'f20f5a03',
    '0f5103', '660f5103', 'f30f5103', 'f20f5103', '0fc20300', '660fc20300', 'f30fc20300', 'f20fc20300'];
  for (const prefix of ['f2', 'f3']) for (const rex of ['', '48']) for (const op of ['2a', '2c', '2d'])
    forms.push(`${prefix}${rex}0f${op}03`);
  // Include existing SIMD readers to audit the shared discriminator beyond the newly native set.
  forms.push('0f1003', '0f2803', '660f6f03', '660f5403', '660f5803', 'f20f5c03');
  for (const form of forms) {
    // Changing RBX inside the block defeats the whole-span guard, exposing the operand access check.
    const h = await harness(`48c7c300300000${form}c3`);
    expect(h.stats.generic, form).toBe(0);
    const execute = (interp: number, protection: number) => {
      h.ex.reset(base, 0); h.ex.protect(3, protection);
      h.view().setBigUint64(h.ex.ram() + 0x3000, 0x3ff000003f800000n, true);
      h.view().setBigUint64(h.ex.ram() + 0x3008, 0x4010000040800000n, true);
      h.ex.set_xmm(0, 0x4010000040800000n, 0x4022000041100000n);
      expect(() => h.ex.run(interp), `${form} protection=${protection}`).not.toThrow();
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
    };
    for (const protection of [2, 0x20]) expect(execute(0, protection)).toEqual(execute(1, protection));
    for (const protection of [1, 0x10]) {
      const denied = (interp: number) => {
        h.ex.reset(base, 0); h.ex.protect(3, protection);
        expect(() => h.ex.run(interp), `${form} denied=${protection}`).toThrow(WebAssembly.RuntimeError);
        return h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size());
      };
      expect(denied(0), form).toEqual(denied(1));
    }
  }
  for (const form of ['488903', 'f20f1103', '660f2903', '48830301']) {
    const h = await harness(`48c7c300300000${form}c3`);
    const execute = (interp: number) => {
      h.ex.reset(base, 0); h.ex.protect(3, 2);
      h.view().setBigUint64(h.ex.ram() + 0x3000, 0x3ff000003f800000n, true);
      h.ex.set_xmm(0, 0x4010000040800000n, 0x4022000041100000n);
      expect(() => h.ex.run(interp), form).toThrow(WebAssembly.RuntimeError);
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
    };
    expect(execute(0), form).toEqual(execute(1));
  }
});

it('COMI/UCOMI memory forms read exact scalar widths and preserve fault state at page edges', async () => {
  for (const prefix of ['', '66']) for (const op of ['2e', '2f']) {
    const h = await harness(`${prefix}0f${op}03c3`), width = prefix ? 8 : 4;
    expect(h.stats.generic).toBe(0);
    for (const offset of [0, 1]) {
      const execute = (interp: number) => {
        h.ex.reset(base, 0); h.ex.set_reg(3, BigInt(0x3000 - width + offset));
        h.ex.set_xmm(0, prefix ? 0x3ff0000000000000n : 0x3f800000n, 0x123456789abcdefn);
        h.ex.set_flags(0xffff); h.ex.unmap(3);
        h.view().setBigUint64(h.ex.ram() + 0x3000 - width + offset,
          prefix ? 0x7ff8000000000000n : 0x7fc00000n, true);
        let faulted = false;
        try { h.ex.run(interp); } catch (e) { expect(e).toBeInstanceOf(WebAssembly.RuntimeError); faulted = true; }
        expect(faulted).toBe(!!offset);
        if (!offset) expect(h.ex.get_flags()).toBe((0xffff & ~0x8d5) | 0x45);
        return { faulted, cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()) };
      };
      expect(execute(0)).toEqual(execute(1));
    }
  }
});

it('REX.R/B scalar conversions track extended GPR and XMM operands, and MMX is not mislabeled SSE', async () => {
  const toFloat = await harness('f34d0f2ac1c3');
  toFloat.ex.reset(base, 0); toFloat.ex.set_reg(9, 16777217n); toFloat.ex.run(0);
  expect(toFloat.ex.get_xmm(8, 0)).toBe(0x4b800000n); expect(toFloat.stats.generic).toBe(0);
  const toInt = await harness('f2450f2cc1c3');
  toInt.ex.reset(base, 0); toInt.ex.set_reg(8, 0xffffffffffffffffn);
  toInt.ex.set_xmm(9, 0xbff8000000000000n, 0n); toInt.ex.run(0);
  expect(toInt.ex.get_reg(8)).toBe(0xffffffffn); expect(toInt.stats.generic).toBe(0);
  const mmx = await harness('0f2ac1c3');
  expect(mmx.stats.generic).toBe(1); mmx.ex.reset(base, 0);
  expect(() => mmx.ex.run(0)).toThrow(WebAssembly.RuntimeError);
});

it('rounding known answers are independent of the shared conversion implementation', async () => {
  const i2s = await harness('f3480f2ac1c3'), i2d = await harness('f2480f2ac1c3');
  for (const [h, value, expected] of [
    [i2s, 16777217n, [0x4b800000n, 0x4b800000n, 0x4b800001n, 0x4b800000n]],
    [i2s, -16777217n, [0xcb800000n, 0xcb800001n, 0xcb800000n, 0xcb800000n]],
    // This tie-plus-one must not double-round through binary64.
    [i2s, 0x4000004000000001n, [0x5e800001n, 0x5e800000n, 0x5e800001n, 0x5e800000n]],
    [i2d, 9007199254740993n, [0x4340000000000000n, 0x4340000000000000n, 0x4340000000000001n, 0x4340000000000000n]],
  ] as const) for (const rc of [0, 1, 2, 3]) {
    h.ex.reset(base, 0); h.ex.set_mxcsr(0x1f80 | rc << 13); h.ex.set_reg(1, BigInt.asUintN(64, value));
    h.ex.run(0); expect(h.ex.get_xmm(0, 0)).toBe(expected[rc]);
  }
  const d2s = await harness('f20f5ac1c3');
  for (const [bits, expected] of [
    [0x3ff0000010000000n, [0x3f800000n, 0x3f800000n, 0x3f800001n, 0x3f800000n]],
    [0xbff0000010000000n, [0xbf800000n, 0xbf800001n, 0xbf800000n, 0xbf800000n]],
    [0x3690000000000000n, [0n, 0n, 1n, 0n]],
    [0x47f0000000000000n, [0x7f800000n, 0x7f7fffffn, 0x7f800000n, 0x7f7fffffn]],
    [0x8000000000000000n, [0x80000000n, 0x80000000n, 0x80000000n, 0x80000000n]],
  ] as const) for (const rc of [0, 1, 2, 3]) {
    d2s.ex.reset(base, 0); d2s.ex.set_mxcsr(0x1f80 | rc << 13); d2s.ex.set_xmm(1, bits, 0n);
    d2s.ex.run(0); expect(d2s.ex.get_xmm(0, 0)).toBe(expected[rc]);
  }
  for (const [op, bits, expected] of [
    ['2d', 0x3ff8000000000000n, [2n, 1n, 2n, 1n]],
    ['2d', 0xbff8000000000000n, [0xfffffffen, 0xfffffffen, 0xffffffffn, 0xffffffffn]],
    ['2c', 0xc1e0000000100000n, [0x80000000n, 0x80000000n, 0x80000000n, 0x80000000n]],
    ['2d', 0x7ff8000000000000n, [0x80000000n, 0x80000000n, 0x80000000n, 0x80000000n]],
  ] as const) {
    const h = await harness(`f20f${op}c1c3`);
    for (const rc of [0, 1, 2, 3]) {
      h.ex.reset(base, 0); h.ex.set_mxcsr(0x1f80 | rc << 13); h.ex.set_xmm(1, bits, 0n);
      h.ex.run(0); expect(h.ex.get_reg(0)).toBe(expected[rc]);
    }
  }
});

it('scalar/packed compare predicates and square root stay native with NaN and upper-lane preservation', async () => {
  let code = '48c7c300200000';
  for (const prefix of ['', '66', 'f2', 'f3']) {
    // Store SQRT before MOVAPD prepares comparison operands; otherwise every result was dead.
    code += `${prefix}0f51c1` + '660f11034883c310';
    for (let predicate = 0; predicate < 8; predicate++)
      code += `660f28c1${prefix}0fc2c1${predicate.toString(16).padStart(2, '0')}660f11034883c310`;
  }
  const h = await harness(code + 'c3');
  expect(h.stats.generic).toBe(0);
  for (const bits of [0n, 0x3ff000003f800000n, 0x7ff800007fc00000n]) {
    const execute = (interp: number) => {
      h.ex.reset(base, 0); h.ex.set_xmm(1, bits, 0x7ff000007f800000n); h.ex.run(interp);
      return { cpu: h.memory().slice(h.ex.cpu(), h.ex.cpu() + h.ex.cpu_size()),
        ram: h.memory().slice(h.ex.ram(), h.ex.ram() + 65536) };
    };
    expect(execute(0)).toEqual(execute(1));
  }
});

it('SQRT scalar and packed known answers observe every result and retained upper lane', async () => {
  for (const [prefix, low, high, wantLow, wantHigh] of [
    ['', 0x4110000040800000n, 0x4180000041800000n, 0x4040000040000000n, 0x4080000040800000n],
    ['66', 0x4010000000000000n, 0x4022000000000000n, 0x4000000000000000n, 0x4008000000000000n],
    ['f3', 0x4110000040800000n, 0x4180000041800000n, 0x1234567840000000n, 0xfedcba9876543210n],
    ['f2', 0x4010000000000000n, 0x4022000000000000n, 0x4000000000000000n, 0xfedcba9876543210n],
  ] as const) {
    const h = await harness(`${prefix}0f51c1c3`);
    expect(h.stats.generic).toBe(0);
    h.ex.reset(base, 0); h.ex.set_xmm(0, 0x1234567887654321n, 0xfedcba9876543210n);
    h.ex.set_xmm(1, low, high); h.ex.run(0);
    expect(h.ex.get_xmm(0, 0), prefix).toBe(BigInt.asIntN(64, wantLow));
    expect(h.ex.get_xmm(0, 1), prefix).toBe(BigInt.asIntN(64, wantHigh));
  }
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
