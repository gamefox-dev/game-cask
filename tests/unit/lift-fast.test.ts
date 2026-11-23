// @bgt-examples: none
// Original CC0-1.0. K52 fast lifting mode: policy plumbing, emission shape, and execution through
// the production runtime against the interpreter (registers, RAM, RIP and retirement; EFLAGS are
// not compared: fast mode treats them as dead across calls/returns per the Win64 ABI).
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM
import { liftPolicy, liftPolicyArgs } from '../../tools/build/chunks.mjs';
// @ts-expect-error plain ESM
import { CFLAGS, LDFLAGS, WASM_OPT_FEATURES } from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import { requireZig } from '../../tools/build/toolchain.mjs';
// @ts-expect-error plain ESM
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error plain ESM
import { functionNames } from '../../tools/build/wasm-names.mjs';
import { instantiateFixture } from '../support/wasm-fixture';
import { perTestTool } from '../support/per-test-tool';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
const tool = perTestTool(x86tool);
const modes = ['asyncify', ...(jspiApi() ? ['jspi'] : [])] as ('asyncify' | 'jspi')[];

function pe(code: Buffer, cuts: number[]) {
  const b = Buffer.alloc(0x400 + Math.ceil(code.length / 512) * 512);
  b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80); b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(2, 0x86); b.writeUInt16LE(240, 0x94); b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt32LE(0x1000, 0xa8); b.writeBigUInt64LE(0x1000n, 0xb0); b.writeUInt32LE(0x10000, 0xd0); b.writeUInt32LE(0x200, 0xd4); b.writeUInt32LE(0x200, 0x98 + 112 + 24); b.writeUInt32LE(cuts.length * 12, 0x98 + 116 + 24);
  for (const [i, name, rva, size, raw] of [[0, '.text', 0x1000, code.length, 0x400], [1, '.pdata', 0x200, cuts.length * 12, 0x200]] as const) {
    const s = 0x188 + i * 40; b.write(name, s); b.writeUInt32LE(size, s + 8); b.writeUInt32LE(rva, s + 12); b.writeUInt32LE(size, s + 16); b.writeUInt32LE(raw, s + 20); b.writeUInt32LE(i ? 0x40000040 : 0x60000020, s + 36);
  }
  cuts.forEach((off, i) => { b.writeUInt32LE(0x1000 + off, 0x200 + i * 12); b.writeUInt32LE(0x1000 + (cuts[i + 1] ?? code.length), 0x204 + i * 12); });
  code.copy(b, 0x400); return b;
}
function lift(code: Buffer, cuts: number[], args: string[]) {
  const root = join(ROOT, 'node_modules/.cache/bgt/lift-fast'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-'));
  try {
    writeFileSync(join(dir, 'test.exe'), pe(code, cuts));
    execFileSync(tool(), ['lift', join(dir, 'test.exe'), '--base', '1000', '--name', 'probe', '--out', join(dir, 'lifted.c'), ...args], { stdio: 'pipe' });
    return readFileSync(join(dir, 'lifted.c'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function harness(code: Buffer, cuts: number[], args: string[], suspension?: 'asyncify' | 'jspi') {
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
    const { exports, host } = await instantiateFixture(raw, suspension ? { suspensionMode: suspension } : {});
    const ex = exports as unknown as { memory: WebAssembly.Memory; prepare(i: number, pc: number, b: number): void; execute(): void; resume(): void; cpu(): number; ram(): number;
      interpretation(): number; generic(): number; set_reg(i: number, v: bigint): void; configure_service(n: number): void; service_count(): number; service_complete(): number; retired(): bigint };
    const view = () => new DataView(ex.memory.buffer);
    const eip = () => view().getUint32(ex.cpu() + 128, true);
    /* Run to the sentinel return, resuming after every scheduler transfer. */
    const run = (interpreted: number, budget: number, setup?: () => void) => {
      ex.prepare(interpreted, 0x2000, budget); setup?.(); ex.execute();
      for (let n = 0; n < 64 && eip() !== 0xfffffff4; n++) ex.resume();
      expect(eip()).toBe(0xfffffff4);
      return { regs: new Uint8Array(ex.memory.buffer).slice(ex.cpu(), ex.cpu() + 128), ram: new Uint8Array(ex.memory.buffer).slice(ex.ram() + 0x1000, ex.ram() + 0xa000), retired: ex.retired() };
    };
    return { ex, host, text, run };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
// Caller makes two tiny calls; callee clobbers r12 and recurses 100 deep with RET $16-style cleanup.
function recursive() {
  const code = Buffer.alloc(0x90, 0x90);
  Buffer.from('b811000000b964000000e83100000083c001c3', 'hex').copy(code);
  Buffer.from('49bc887766554433221185c9740f4883ec28ffc9e8270000004883c428ffc0c3', 'hex').copy(code, 0x40);
  Buffer.from('4883ec28e8b7ffffff4883c428c3', 'hex').copy(code, 0x80);
  return code;
}
const FAST = ['--lift-mode', 'fast'];
// K72 size options: minimal register sync at calls/exits and the outlined call protocol (liftFast.sync / .calls).
const COMPACT = ['--fast-sync', 'minimal', '--fast-calls', 'outlined'];
const SHAPES: [string, string[]][] = [['inline form', []], ['compact', COMPACT]];

it('policy: exact stays byte-for-byte default; fast mode, knobs and BGT_LIFT_MODE are validated', () => {
  expect(Object.keys(liftPolicy({}, {}))).toEqual(['liftInlineMemory', 'liftInlineAlu', 'liftAffineCounting', 'liftOptimizeSmall']);
  expect(liftPolicy({ liftMode: 'exact' }, {})).toEqual(liftPolicy({}, {}));
  expect(liftPolicy({}, { BGT_LIFT_MODE: 'exact' })).toEqual(liftPolicy({}, {}));
  expect(liftPolicyArgs(liftPolicy({ liftMode: 'fast', liftFast: { memory: 'range', inline: '0' } }, {})).slice(-6)).toEqual(['--lift-mode', 'fast', '--fast-inline', '0', '--fast-memory', 'range']);
  expect(liftPolicy({}, { BGT_LIFT_MODE: 'fast' }).liftMode).toBe('fast');
  expect(liftPolicy({ liftMode: 'exact' }, { BGT_LIFT_MODE: 'fast' }).liftMode).toBeUndefined();
  expect(() => liftPolicy({ liftMode: 'turbo' }, {})).toThrow(/liftMode/);
  expect(() => liftPolicy({}, { BGT_LIFT_MODE: 'turbo' })).toThrow(/BGT_LIFT_MODE/);
  expect(() => liftPolicy({ liftFast: { memory: 'mask' } }, {})).toThrow(/requires liftMode/);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { memory: 'none' } }, {})).toThrow(/liftFast.memory/);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { warp: 'on' } }, {})).toThrow(/unknown knob/);
  // K72 size knobs (opt-in; absent = the K52 form, unchanged cache keys)
  expect(liftPolicyArgs(liftPolicy({ liftMode: 'fast', liftFast: { sync: 'minimal', calls: 'outlined' } }, {})).slice(-4)).toEqual(['--fast-calls', 'outlined', '--fast-sync', 'minimal']);
  expect(liftPolicy({ liftMode: 'fast' }, {})).toEqual({ ...liftPolicy({}, {}), liftMode: 'fast' });
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { sync: 'lazy' } }, {})).toThrow(/liftFast.sync/);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { calls: 'shared' } }, {})).toThrow(/liftFast.calls/);
});

it('emission: exact output is unchanged by the option; fast entries are only start, loop header and return sites', () => {
  // f: mov ecx,3; L: call g; dec ecx; jnz L; ret.  g: xor eax,eax; ret
  const code = Buffer.alloc(0x50, 0x90);
  Buffer.from('b903000000e836000000ffc975f7c3', 'hex').copy(code); Buffer.from('31c0c3', 'hex').copy(code, 0x40);
  expect(lift(code, [0, 0x40], ['--lift-mode', 'exact'])).toBe(lift(code, [0, 0x40], []));
  const text = lift(code, [0, 0x40], [...FAST, '--fast-inline', '0']);
  const f = text.slice(text.indexOf('void N_00002000(uint32_t pc){'), text.indexOf('void F_00002000'));
  expect([...f.matchAll(/case (0x[0-9a-f]+)u:/g)].map((m) => m[1])).toEqual(['0x00002000', '0x00002005', '0x0000200a']);
  expect(f).toContain('N_00002040(0x00002040u)'); // direct C call, no admission helpers
  expect(f).not.toMatch(/x86_native_enter|x86_native_resume|x86_coverage_lifted\(pc/);
  expect(f).toMatch(/xf_cond\(5,ca,cb,cr,4,5\)\)goto L_00002005/); // fused dec/jnz
  const inlined = lift(code, [0, 0x40], FAST);
  const g = inlined.slice(inlined.indexOf('void N_00002000(uint32_t pc){'), inlined.indexOf('void F_00002000'));
  expect(g).toContain('L_i1_00002040'); expect(g).not.toContain('N_00002040(0x00002040u)');
  expect(g).toMatch(/if\(t==0x0000200aull\)goto Q_0000200a/);
});

it('emission (K72): compact call sites spill only dirty registers, reload live volatiles, use the outlined protocol', () => {
  // f: mov ecx,3; L: call g; dec ecx; jnz L; ret.  g: xor eax,eax; ret
  const code = Buffer.alloc(0x50, 0x90);
  Buffer.from('b903000000e836000000ffc975f7c3', 'hex').copy(code); Buffer.from('31c0c3', 'hex').copy(code, 0x40);
  const plain = lift(code, [0, 0x40], [...FAST, '--fast-inline', '0']);
  expect(lift(code, [0, 0x40], [...FAST, '--fast-inline', '0', '--fast-sync', 'full', '--fast-calls', 'inline'])).toBe(plain);
  // The size marker is comments only: removing them gives the unmarked text, line for line.
  const marked = lift(code, [0, 0x40], [...FAST, '--fast-inline', '0', '--fast-mark', 'on']);
  expect(marked).toMatch(/\/\*@F 00002000 54\*\//); expect(marked).toMatch(/\/\*@call\*\//);
  expect(marked.replace(/\/\*@[^*]*\*\//g, '')).toBe(plain);
  const text = lift(code, [0, 0x40], [...FAST, '--fast-inline', '0', ...COMPACT]);
  const f = text.slice(text.indexOf('void N_00002000(uint32_t pc){'), text.indexOf('void F_00002000'));
  // rcx (mov/dec) and rsp (the pushed return address) are the only dirty registers at the call.
  expect(f).toContain('X.r[1]=r[1];X.r[4]=r[4];XR_LIFT(clock-retire_clock);retire_clock=clock;if(xf_enter(0x00002040u,flags,clock,qbase))return;N_00002040(0x00002040u);if(xf_leave(0x0000200au))return;r[1]=X.r[1];r[4]=X.r[4];XF_RELOAD_CLOCK');
  expect(f).not.toMatch(/XF_SPILL;|x86_fast_depth\+\+|xf_busy/);
  // the RET exit after the loop spills rcx and rsp only (both written since the last call returned)
  expect(f).toMatch(/r\[4\]\+=8;X\.r\[1\]=r\[1\];X\.r\[4\]=r\[4\];XF_SYNC;X\.eip=x86_address\(t\);return;/);
});

it('emission: relative jump tables become guarded internal switches (hints, not authority)', () => {
  // lea r13,[rip+table]; cmp ecx,2; ja out; movsxd rcx,[r13+rcx*4]; add rcx,r13; jmp rcx; 3 cases; out: ret
  const code = Buffer.alloc(0x80, 0x90);
  Buffer.from('4c8d2d39000000' + '83f902' + '7713' + '49634c8d00' + '4c01e9' + 'ffe1', 'hex').copy(code);
  Buffer.from('b801000000c3', 'hex').copy(code, 0x20); Buffer.from('b802000000c3', 'hex').copy(code, 0x28); Buffer.from('b803000000c3', 'hex').copy(code, 0x30);
  Buffer.from('31c0c3', 'hex').copy(code, 0x18);
  for (const [i, off] of [0x20, 0x28, 0x30].entries()) code.writeInt32LE(off - 0x40, 0x40 + 4 * i);
  const text = lift(code, [0], FAST);
  expect(text).toMatch(/switch\(t\)\{case 0x00002020u:goto L_00002020;case 0x00002028u:goto L_00002028;case 0x00002030u:goto L_00002030;default:break;\}/);
});

for (const [shape, extra] of SHAPES) for (const memory of ['mask', 'range']) for (const inline of ['0', '48'])
it(`execution (${shape}, ${memory}, inline ${inline}): deep recursion, quantum transfers and RET cleanup match the interpreter`, async () => {
  const h = await harness(recursive(), [0, 0x40, 0x80], [...FAST, '--fast-memory', memory, '--fast-inline', inline, ...extra]);
  for (const budget of [0, 1999990, 1999999, 2000000]) {
    const got = h.run(0, budget); expect(h.ex.interpretation()).toBe(0);
    expect(got).toEqual(h.run(1, budget));
  }
}, 120000);

for (const [shape, extra] of SHAPES)
it(`execution (${shape}): indirect calls, cold generic CPUID and a patched qword table match the interpreter`, async () => {
  // mov rax,callee; call rax; inc eax; ret; callee: CPUID; mov eax,7; ret
  const code = Buffer.alloc(0x50, 0x90); Buffer.from('48c7c040200000ffd0ffc0c3', 'hex').copy(code); Buffer.from('0fa2b807000000c3', 'hex').copy(code, 0x40);
  const h = await harness(code, [0, 0x40], [...FAST, ...extra]);
  const got = h.run(0, 0); expect(h.ex.interpretation()).toBe(0); expect(h.ex.generic()).toBe(1); expect(got.retired).toBe(7n);
  expect(got).toEqual(h.run(1, 0));
  const table = Buffer.alloc(0x100, 0x90);
  Buffer.from('4c8d05b900000041ff10ffc0c3', 'hex').copy(table); Buffer.from('b807000000c3', 'hex').copy(table, 0x40); Buffer.from('b809000000c3', 'hex').copy(table, 0x80);
  table.writeBigUInt64LE(0x2040n, 0xc0);
  const t = await harness(table, [0, 0x40, 0x80], [...FAST, ...extra]);
  for (const target of [0x2040n, 0x2080n, 0x2040n]) {
    const patch = () => new DataView(t.ex.memory.buffer).setBigUint64(t.ex.ram() + 0x20c0, target, true);
    const fast = t.run(0, 0, patch);
    expect(new DataView(fast.regs.buffer).getBigUint64(0, true)).toBe(target === 0x2040n ? 8n : 10n);
    expect(fast).toEqual(t.run(1, 0, patch));
  }
}, 120000);

for (const [shape, extra] of SHAPES) for (const suspension of modes)
it(`execution (${shape}, ${suspension}): fast frames unwind before callbacks, park/rewind and nonlocal transfer`, async () => {
  const code = Buffer.alloc(0xa0, 0x90);
  Buffer.from('4883ec28e8370000004883c42883c001c3', 'hex').copy(code);
  Buffer.from('4883ec28e8b74f00004883c42883c002c3', 'hex').copy(code, 0x40);
  Buffer.from('b82a000000c3b863000000c3', 'hex').copy(code, 0x80);
  for (const mode of [0, 1, 2]) {
    const snapshots = [];
    for (const interpreted of [0, 1]) {
      const h = await harness(code, [0, 0x40, 0x80], [...FAST, ...extra], suspension);
      h.host.init(); h.ex.prepare(interpreted, 0x2000, 0); h.ex.configure_service(mode);
      await h.host.update();
      if (mode === 1) { expect(h.host.suspended).toBe(true); expect(h.ex.service_complete()).toBe(0); await h.host.update(); }
      expect(h.host.suspended).toBe(false); expect(h.ex.service_count()).toBe(1); expect(h.ex.service_complete()).toBe(1);
      if (!interpreted) expect(h.ex.interpretation()).toBe(0);
      expect(h.ex.retired()).toBe(mode === 2 ? 8n : 12n);
      snapshots.push({ regs: new Uint8Array(h.ex.memory.buffer).slice(h.ex.cpu(), h.ex.cpu() + 128), eip: new DataView(h.ex.memory.buffer).getUint32(h.ex.cpu() + 128, true),
        ram: new Uint8Array(h.ex.memory.buffer).slice(h.ex.ram() + 0x1000, h.ex.ram() + 0xa000) });
    }
    expect(snapshots[0]).toEqual(snapshots[1]);
  }
}, 120000);

// K72: a register spilled at a later call without an intervening write must be reloaded after the earlier
// call (spills are reads in the liveness). f: call g; test eax,eax; jz L; mov ecx,7; L: call h; ret.
// g: mov ecx,5; mov eax,{0|1}; ret.  h: mov eax,ecx; ret.  Path B (eax 0) passes g's rcx to h.
for (const [shape, extra] of SHAPES) for (const inline of ['0', '48']) for (const taken of [0, 1])
it(`execution (${shape}, inline ${inline}, path ${taken ? 'A' : 'B'}): dirty joins keep values the callee left in volatile registers`, async () => {
  const code = Buffer.alloc(0x80, 0x90);
  Buffer.from('e83b000000' + '85c0' + '7405' + 'b907000000' + 'e84d000000' + 'c3', 'hex').copy(code);
  Buffer.from('b905000000' + 'b8' + (taken ? '01' : '00') + '000000' + 'c3', 'hex').copy(code, 0x40);
  Buffer.from('89c8c3', 'hex').copy(code, 0x60);
  const h = await harness(code, [0, 0x40, 0x60], [...FAST, '--fast-inline', inline, ...extra]);
  const got = h.run(0, 0); expect(h.ex.interpretation()).toBe(0);
  expect(new DataView(got.regs.buffer).getBigUint64(0, true)).toBe(taken ? 7n : 5n);
  expect(got).toEqual(h.run(1, 0));
}, 120000);

// vK52 must-fix: an inlined alloca-style callee (pop r11; sub rsp,rax; push r11; ret, as in mingw
// ___chkstk/__alloca) moves RSP. The caller's [rsp] stores after the call must use the moved RSP, which
// fails if the static stack base is not re-derived at the inlined return.
it.each([['48', ''], ['0', ''], ['48', 'compact'], ['0', 'compact']])('execution: alloca-style callee that moves RSP keeps caller stack slots correct (inline %s %s)', async (inline, shape) => {
  // f: sub rsp,0x28; mov eax,0x40; call g; mov qword [rsp],0x77; mov qword [rsp+8],0x99; mov rax,rsp;
  //    add rsp,0x68; ret.   g: pop r11; sub rsp,rax; push r11; ret
  const code = Buffer.alloc(0x50, 0x90);
  Buffer.from('4883ec28' + 'b840000000' + 'e832000000' + '48c7042477000000' + '48c744240899000000' + '4889e0' + '4883c468' + 'c3', 'hex').copy(code);
  Buffer.from('415b' + '4829c4' + '4153' + 'c3', 'hex').copy(code, 0x40);
  const h = await harness(code, [0, 0x40], [...FAST, '--fast-inline', inline, ...(shape ? COMPACT : [])]);
  if (inline !== '0') expect(h.text).toContain('L_i1_00002040');
  const got = h.run(0, 0); expect(h.ex.interpretation()).toBe(0);
  const rsp = 0x9000 - 8 - 0x28 - 0x40;
  expect(new DataView(got.regs.buffer).getBigUint64(0, true)).toBe(BigInt(rsp));
  const at = (a: number) => new DataView(got.ram.buffer).getBigUint64(a - 0x1000, true);
  expect(at(rsp)).toBe(0x77n); expect(at(rsp + 8)).toBe(0x99n);
  expect(got).toEqual(h.run(1, 0));
}, 120000);

// AMD64 CMOVcc r32 zero-extends the destination even when the condition is false (interpreter, exact
// emitter and fast emitter). mov rax,-1; mov ecx,5; cmp eax,eax; cmovne eax,ecx; cmove edx,ecx; ret
it.each([[['--lift-preset', 'size']], [['--lift-preset', 'fast']], [FAST]])('32-bit CMOVcc zero-extends with a false condition (%s)', async (args) => {
  const code = Buffer.from('48c7c0ffffffff' + '48c7c2ffffffff' + 'b905000000' + '39c0' + '0f45c1' + '0f44d1' + 'c3', 'hex');
  const h = await harness(code, [0], args);
  for (const interpreted of [0, 1]) {
    const got = h.run(interpreted, 0), r = new DataView(got.regs.buffer);
    expect(r.getBigUint64(0, true), 'rax: false cmovne').toBe(0xffffffffn);
    expect(r.getBigUint64(16, true), 'rdx: true cmove').toBe(5n);
  }
}, 120000);
