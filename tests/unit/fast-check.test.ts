// @bgt-examples: none
// Original CC0-1.0. K78: the self-checking diagnostic build (liftFast.check "sync") and stress fixtures for the K72
// compact options (sync minimal, calls outlined, inline 16) on code shapes the kit's examples lack.
//  - raw AMD64 code through the production runtime: an ABI-breaking callee is reported (real call: kind 3, inlined:
//    kind 4) with caller, callee, register and guest PC; deliberately wrong minimal-sync decisions (testCorrupt "sync")
//    change the result without the check and are reported (kinds 1, 2) and repaired with it; clean code reports nothing;
//  - CC0 C/C++ stress fixtures (tests/fixtures/k78: hand-written multi-entry, mid-function jumps, conditional tail calls,
//    shrink-wrapped and MSVC home-area prologues, __chkstk-style RAX-preserving helpers, jmp-rax dispatch, RDX
//    returns, tail jumps through tables, deep recursion past the call-depth cap, stack slots and alloca across calls,
//    x87/SSE, setjmp/longjmp, profile callbacks, >4096-instruction functions, quanta and threads in inlined code;
//    C++ throws through fast frames, past the depth cap, virtual calls, rethrow, std::function): the fast-mode oracle
//    with the compact16 options (trace + guest state) and the check build (no violation, interpreter's output).
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
import { fastHarness } from '../support/fast-harness';
import { perTestTool } from '../support/per-test-tool';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { liftPolicy, liftPolicyArgs } from '../../tools/build/chunks.mjs';
// @ts-expect-error plain ESM
import { x86tool, refuseTestCorruptPort } from '../../tools/build/pipeline.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
const tool = perTestTool(x86tool);
const { lift, harness } = fastHarness(tool);
const modes = ['asyncify', ...(jspiApi() ? ['jspi'] : [])] as ('asyncify' | 'jspi')[];
const FAST = ['--lift-mode', 'fast'];
const COMPACT = ['--fast-sync', 'minimal', '--fast-calls', 'outlined'];
const CHECK = ['--fast-check', 'sync'];
const rax = (regs: Uint8Array) => new DataView(regs.buffer).getBigUint64(0, true);

// f: push rbx; mov ebx,5; call g; mov eax,ebx; pop rbx; ret.  g (0x40): mov ebx,9; ret  (g breaks the Win64 ABI)
const CLOBBER = Buffer.from('53bb05000000e83500000089d85bc3' + '90'.repeat(49) + 'bb09000000c3', 'hex');
// f: call g; test eax,eax; jz L; mov ecx,7; L: call h; ret.  g (0x40): mov ecx,5; mov eax,1; ret.  h (0x60): mov eax,ecx; ret
const JOINS = (() => {
  const code = Buffer.alloc(0x80, 0x90);
  Buffer.from('e83b000000' + '85c0' + '7405' + 'b907000000' + 'e84d000000' + 'c3', 'hex').copy(code);
  Buffer.from('b905000000' + 'b801000000' + 'c3', 'hex').copy(code, 0x40);
  Buffer.from('89c8c3', 'hex').copy(code, 0x60);
  return code;
})();
// f: mov eax,17; mov ecx,100; call g; add eax,1; ret.  g (0x40): push r12; mov r12,imm64; test ecx,ecx; jz L;
// sub rsp,0x20; dec ecx; call g; add rsp,0x20; inc eax; L: add rax,r12; sub rax,r12; pop r12; ret (R12 live across
// the recursive call, saved and restored).  h (0x80): sub rsp,0x28; call g; add rsp,0x28; ret
const RECURSIVE = Buffer.from('b811000000b964000000e83100000083c001c3' + '90'.repeat(45) +
  '415449bc887766554433221185c974114883ec20ffc9e8e5ffffff4883c420ffc04c01e04c29e0415cc3' + '90'.repeat(22) + '4883ec28e8b7ffffff4883c428c3', 'hex');

it('policy and emission: liftFast.check is opt-in, validated, and leaves the generated C unchanged when off', () => {
  expect(liftPolicyArgs(liftPolicy({ liftMode: 'fast', liftFast: { check: 'sync', sync: 'minimal' } }, {})).slice(-4)).toEqual(['--fast-check', 'sync', '--fast-sync', 'minimal']);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { check: 'all' } }, {})).toThrow(/liftFast.check/);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { testCorrupt: 'sync' } }, {})).toThrow(/test-only/);
  expect(() => refuseTestCorruptPort({ liftFast: { testCorrupt: 'sync' } }, join(ROOT, 'port/game'))).toThrow(/port builds/);
  for (const extra of [[], COMPACT]) {
    const plain = lift(JOINS, [0, 0x40, 0x60], [...FAST, ...extra]);
    expect(lift(JOINS, [0, 0x40, 0x60], [...FAST, ...extra, '--fast-check', 'off'])).toBe(plain);
    expect(plain).not.toMatch(/xf_sync_violation|x86_sync_check/);
    const checked = lift(CLOBBER, [0, 0x40], [...FAST, '--fast-inline', '0', ...extra, ...CHECK]);
    expect(checked).toMatch(/x86_sync_check\.live=1/);
    expect(checked).toContain('xf_sync_violation(3u<<8|3u,0x00002000u,0x00002000u,0x00002006u,(uint32_t)t,X.r[3],r[3])');
  }
});

for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): a real callee that changes RBX is reported as kind 3 with caller, callee, register and PC`, async () => {
  const h = await harness(CLOBBER, [0, 0x40], [...FAST, '--fast-inline', '0', ...extra, ...CHECK]);
  const fast = h.run(0, 0);
  expect(h.ex.interpretation()).toBe(0); expect(h.ex.sync_live()).toBe(1);
  expect(rax(fast.regs)).toBe(5n); // fast mode keeps the caller's RBX (the Win64 assumption) ...
  expect(rax(h.run(1, 0).regs)).toBe(9n); // ... the interpreter sees the clobber
  expect(h.ex.sync_by_kind(3)).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([3, 3, 0x2000, 0x2000, 0x2006, 0x2040]);
  expect(h.logs.map((l) => l.message)).toContain('x86 sync check: callee changed a callee-saved register: register rbx at guest pc 0x00002006 in guest function 0x00002000 (lifted N_00002000), callee 0x00002040, found 0x0000000000000009, full form 0x0000000000000005');
}, 120000);

for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): an inlined callee that changes RBX is reported as kind 4 (the result depends on the inline limit)`, async () => {
  const h = await harness(CLOBBER, [0, 0x40], [...FAST, '--fast-inline', '48', ...extra, ...CHECK]);
  expect(h.text).toContain('L_i1_00002040');
  const fast = h.run(0, 0);
  expect(rax(fast.regs)).toBe(9n); // the inlined copy exposes the clobber, like the interpreter
  expect(h.ex.sync_by_kind(4)).toBe(1); expect(h.ex.sync_violations()).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([4, 3, 0x2000, 0x2000, 0x2006, 0x2040]);
}, 120000);

// vK78 review (HIGH): an inlined callee that changes a callee-saved register through a generic (helper-emulated)
// instruction must be reported too: generic writes land in X and the locals reload from it, outside the specialized
// register model. f: push rbx; mov ebx,5; xor eax,eax; mov ecx,8; call g; mov eax,ebx; pop rbx; ret.
// g (0x40): CPUID (writes RBX) / BSF ebx,ecx (RBX = 3); ret.
const GENERIC_CLOBBER: [string, string][] = [['cpuid', '0fa2c3'], ['bsf', '0fbcd9c3']];
for (const [name, g] of GENERIC_CLOBBER) for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): an inlined ${name} that changes RBX is reported as kind 4`, async () => {
  const code = Buffer.from('53bb0500000031c0b908000000e82e00000089d85bc3' + '90'.repeat(42) + g, 'hex');
  const h = await harness(code, [0, 0x40], [...FAST, '--fast-inline', '48', ...extra, ...CHECK]);
  expect(h.text).toContain('L_i1_00002040');
  const fast = h.run(0, 0);
  expect(rax(fast.regs)).not.toBe(5n); // the inlined copy exposes the generic write
  expect(h.ex.sync_by_kind(4), h.logs.map((l) => l.message).join('\n')).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([4, 3, 0x2000, 0x2000, 0x200d, 0x2040]);
}, 120000);

// vK78 review (MEDIUM): a callee-saved register the caller only reads stays clobbered in X (no form stores it); the
// check must not then blame every later callee. f: sub rsp,0x28; call g; call h; mov eax,ebx; add rsp,0x28; ret.
// g (0x40): mov ebx,9; ret (breaks the ABI).  h (0x60): ret (preserves RBX).  Exactly one report, naming g.
const RESYNC = Buffer.from('4883ec28e837000000e85200000089d84883c428c3' + '90'.repeat(43) + 'bb09000000c3' + '90'.repeat(26) + 'c3', 'hex');
for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): after a reported clobber of a read-only register, a preserving callee is not blamed`, async () => {
  const h = await harness(RESYNC, [0, 0x40, 0x60], [...FAST, '--fast-inline', '0', ...extra, ...CHECK]);
  h.run(0, 0);
  expect(h.ex.sync_violations(), h.logs.map((l) => l.message).join('\n')).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([3, 3, 0x2000, 0x2000, 0x2004, 0x2040]);
}, 120000);

// vK78b review (HIGH): RBX read only by a generic instruction (BSF eax,ebx: no local, lives in X) and changed by an
// inlined CPUID. f: sub rsp,0x28; xor eax,eax; call g; bsf eax,ebx; add rsp,0x28; ret.  g (0x40): cpuid; ret
const GENERIC_READER = Buffer.from('4883ec2831c0e8350000000fbcc34883c428c3' + '90'.repeat(45) + '0fa2c3', 'hex');
for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): an inlined CPUID changing RBX that only generic instructions read is reported as kind 4`, async () => {
  const h = await harness(GENERIC_READER, [0, 0x40], [...FAST, '--fast-inline', '48', ...extra, ...CHECK]);
  expect(h.text).toContain('L_i1_00002040');
  const fast = h.run(0, 0);
  expect(fast).toEqual(h.run(1, 0)); // the inlined copy behaves like the interpreter
  h.ex.sync_reset(); h.run(0, 0);
  expect(h.ex.sync_violations(), h.logs.map((l) => l.message).join('\n')).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([4, 3, 0x2000, 0x2000, 0x2006, 0x2040]);
}, 120000);

// vK78b review (MEDIUM): after a real callee clobbered RBX (reported once, kind 3), an inlined flag-only generic (CLC)
// reloads the locals from X; that must not blame the inlined callee. f: sub rsp,0x28; call g; call h; mov eax,ebx;
// add rsp,0x28; ret.  g (0x40, padded past the inline limit): mov ebx,9; ret.  h (0x80, inlined): clc; ret
const FLAG_ONLY = Buffer.from('4883ec28e837000000e87200000089d84883c428c3' + '90'.repeat(43) + 'bb09000000c3' + '90'.repeat(58) + 'f8c3', 'hex');
for (const [shape, extra] of [['full sync', []], ['compact', COMPACT]] as [string, string[]][])
it(`check (${shape}): an inlined flag-only generic after an earlier clobber is not blamed`, async () => {
  const h = await harness(FLAG_ONLY, [0, 0x40, 0x80], [...FAST, '--fast-inline', '16', ...extra, ...CHECK]);
  expect(h.text).toContain('L_i1_00002080'); expect(h.text).not.toContain('L_i1_00002040');
  h.run(0, 0);
  expect(h.ex.sync_violations(), h.logs.map((l) => l.message).join('\n')).toBe(1);
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([3, 3, 0x2000, 0x2000, 0x2004, 0x2040]);
}, 120000);

// Deliberately wrong minimal-sync decisions: the test fails if the check misses them or does not repair them.
for (const extra of [COMPACT, ['--fast-sync', 'minimal']])
it(`check (${extra.join(' ')}): wrong minimal-sync decisions are reported (dirty miss, liveness miss) and repaired`, async () => {
  const corrupt = [...FAST, '--fast-inline', '0', ...extra, '--fast-test-corrupt', 'sync'];
  const reference = (await harness(JOINS, [0, 0x40, 0x60], [...FAST, '--fast-inline', '0'])).run(1, 0);
  expect(rax(reference.regs)).toBe(7n);
  const wrong = await harness(JOINS, [0, 0x40, 0x60], corrupt);
  expect(wrong.run(0, 0)).not.toEqual(reference); // the corruption is real
  const h = await harness(JOINS, [0, 0x40, 0x60], [...corrupt, ...CHECK]);
  const got = h.run(0, 0);
  expect(got).toEqual(reference); // the check build runs with the full form's values
  expect(h.ex.sync_by_kind(1)).toBeGreaterThan(0); expect(h.ex.sync_by_kind(2)).toBeGreaterThan(0);
  expect(h.ex.sync_by_kind(3) + h.ex.sync_by_kind(4) + h.ex.sync_by_kind(5)).toBe(0);
  // The first: g's RET does not store RCX (kind 1); then f's `test eax,eax` reads g's EAX that was not reloaded.
  expect([0, 1, 2, 3, 4, 5].map((i) => h.ex.sync_first(i))).toEqual([1, 1, 0x2040, 0x2040, 0x204a, 0]);
  expect(h.logs.some((l) => l.message.startsWith('x86 sync check: minimal-sync liveness miss: register rax at guest pc 0x00002005 in guest function 0x00002000'))).toBe(true);
  expect(h.logs.some((l) => l.message.startsWith('x86 sync check: minimal-sync dirty-set miss: register rcx at guest pc 0x0000200e'))).toBe(true);
}, 120000);

for (const extra of [[], COMPACT]) for (const inline of ['0', '16', '48']) for (const [name, code, cuts] of [['joins', JOINS, [0, 0x40, 0x60]], ['recursion', RECURSIVE, [0, 0x40, 0x80]]] as [string, Buffer, number[]][])
it(`check (${extra.length ? 'compact' : 'full sync'}, inline ${inline}, ${name}): ABI-clean code reports nothing and matches the interpreter`, async () => {
  const h = await harness(code, cuts, [...FAST, '--fast-inline', inline, ...extra, ...CHECK]);
  // A quantum boundary needs an entry or loop header to poll at (fully inlined straight-line code has none).
  for (const budget of name === 'recursion' ? [0, 1999990, 1999999, 2000000] : [0]) {
    const got = h.run(0, budget); expect(h.ex.interpretation()).toBe(0);
    expect(got).toEqual(h.run(1, budget));
  }
  expect(h.ex.sync_live()).toBe(1); expect(h.ex.sync_violations()).toBe(0);
}, 120000);

// K78 finding (k78-shapes, exact form: liftMode exact, and fast functions that keep the exact emitter): an address
// inside a lifted owner's registry range that is no analyzed instruction, here the target of a relative jump table
// the analyzer cannot recover (one entry leaves the function) in a function without .pdata (found as a call target,
// so no range sweep), must be interpreted. The exact form left through `exit` without progress and the dispatcher
// faulted ("lifted AMD64 entry made no progress"). w (.pdata): sub rsp,0x28; call f; add rsp,0x28; ret.
// f (0x10, no .pdata): cmp ecx,1; ja L; lea rdx,[rip+tbl]; movsxd rax,[rdx+rcx*4+4]; add rax,rdx; jmp rax;
// X: lea eax,[rcx+11]; ret; L: mov eax,99; ret; tbl: (xor eax,eax; ret: the LEA seeds it as a leaf), X-tbl, g-tbl.
// g (0x40): lea eax,[rcx+20]; ret
const LANDING = Buffer.from('4883ec28e8070000004883c428c3cccc83f9017715488d15140000004863448a044801d0ffe08d410bc3b863000000c331c0c390f6ffffff10000000cccccccc8d4114c3', 'hex');
for (const [mode, args] of [['exact', []], ['fast', FAST], ['compact16', [...FAST, ...COMPACT, '--fast-inline', '16']]] as [string, string[]][])
it(`dispatch (${mode}): an unanalyzed address inside a lifted owner (unrecovered jump-table target) is interpreted`, async () => {
  const h = await harness(LANDING, [[0, 0x0e], 0x40], args);
  for (const [rcx, want] of [[0n, 11n], [1n, 21n], [2n, 99n]]) {
    const setup = () => h.ex.set_reg(1, rcx);
    const got = h.run(0, 0, setup);
    expect(rax(got.regs), `rcx=${rcx}`).toBe(want);
    expect(got).toEqual(h.run(1, 0, setup));
  }
}, 120000);

// K78 bug (found by the check build on k78-unwind: a C++ landing pad that rejoins its loop): the AMD64 analyzer sweeps
// a function's whole .pdata range, so it also holds code no static edge from the start reaches (landing pads, catch
// continuations, case bodies behind jump tables it cannot recover). That code runs natively from the entries inside it
// (post-call sites, loop headers). Minimal sync propagated dirty registers only from the function start, so registers
// written there were not stored at the next call or exit of the code it jumps back into. f: sub rsp,0x28; test edx,edx;
// jz S; lea rax,[rip+P]; jmp rax; P: call k; mov ecx,7 (after the post-call entry); jmp S; S: call h; add rsp,0x28;
// ret.  k (0x40): ret.  h (0x60): lea eax,[rcx+rcx]; ret.  With edx=1, h must see ecx=7 (rax 14).
const ENTRY_ONLY = Buffer.from('4883ec2885d27415488d0502000000ffe0e82a000000b907000000eb00e83e0000004883c428c3' + 'cc'.repeat(25) + 'c3' + 'cc'.repeat(31) + '8d0409c3', 'hex');
for (const [shape, extra] of [['full sync', []], ['sync minimal', ['--fast-sync', 'minimal']], ['compact', COMPACT]] as [string, string[]][]) for (const inline of ['0', '16', '48'])
it(`execution (${shape}, inline ${inline}): registers written in code reached only through an entry are stored at the next call`, async () => {
  const h = await harness(ENTRY_ONLY, [0, 0x40, 0x60], [...FAST, '--fast-inline', inline, ...extra]);
  for (const [rdx, want] of [[1n, 14n], [0n, 10n]]) {
    const setup = () => { h.ex.set_reg(2, rdx); h.ex.set_reg(1, 5n); };
    const got = h.run(0, 0, setup);
    expect(rax(got.regs), `rdx=${rdx}`).toBe(want);
    expect(got).toEqual(h.run(1, 0, setup));
  }
  if (!extra.length) return;
  const c = await harness(ENTRY_ONLY, [0, 0x40, 0x60], [...FAST, '--fast-inline', inline, ...extra, ...CHECK]);
  c.run(0, 0, () => { c.ex.set_reg(2, 1n); c.ex.set_reg(1, 5n); });
  expect(c.ex.sync_violations(), c.logs.map((l) => l.message).join('\n')).toBe(0);
}, 120000);

// ---- stress fixtures (test-owned game directories; no new example) ----
const FIXTURES: Record<string, { source: string; cpp: boolean; frames: number }> = {
  'k78-shapes': { source: 'shapes.c', cpp: false, frames: 120 },
  'k78-unwind': { source: 'unwind.cpp', cpp: true, frames: 60 },
};
function fixture(name: string, variant: string, liftFast: Record<string, string>, extra: Record<string, unknown> = {}) {
  const f = FIXTURES[name], id = `${name}-${variant}`, dir = join(ROOT, 'node_modules/.cache/bgt/fast-check', id);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'tests/fixtures/k78', f.source), join(dir, f.source));
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: `CC0 K78 stress fixture ${name} (${variant})`, pipeline: {
    platform: 'win32', liftMode: 'fast', liftFast, suspensionBuild: 'dual', ...extra,
    fixture: { target: 'x86_64-windows-gnu', crt: true, cpp: f.cpp, sources: [f.source], out: `${name}.exe`, libs: ['kernel32', 'user32'] },
    modules: [{ from: `./build/${name}.exe`, main: true }] } }));
  return { id, dir };
}
async function output(id: string, suspension: 'asyncify' | 'jspi') {
  const h = await loadHeadless(id, { suspension });
  for (let f = 0; f < 400 && !h.logs.some((l) => l.includes('k78 done')); f++) await h.stepAsync(1);
  return { lines: h.logs.filter((l) => /^guest: k78 /.test(l)), faults: h.logs.filter((l) => /x86:|fault|FAIL|sync check/i.test(l)), metrics: h.host.metrics() as Record<string, unknown> };
}
const COMPACT16 = { sync: 'minimal', calls: 'outlined', inline: '16' };

for (const name of Object.keys(FIXTURES))
it(`stress fixture ${name}: compact16 fast build vs interpreter, API trace + guest state every frame`, async () => {
  const { id, dir } = fixture(name, 'compact16', COMPACT16);
  buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
  const r = await oracle(id, FIXTURES[name].frames);
  expect(r.errors).toEqual({ lifted: null, interpreted: null });
  expect(r.state?.available).toBe(true);
  expect(r.identical, JSON.stringify(r.state)).toBe(true);
}, 1800000);

for (const name of Object.keys(FIXTURES))
it(`stress fixture ${name}: the check build reports no violation and prints the interpreter's output (both suspension modes)`, async () => {
  const { id, dir } = fixture(name, 'check', { ...COMPACT16, check: 'sync' });
  buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, 'web/public/games', id, 'manifest.json'), 'utf8'));
  expect(manifest.pipeline.modules[0].lift.fastCheckModelMisses).toBe(0);
  const reference = await output(`${id}-interp`, 'asyncify');
  expect(reference.lines.length).toBe(name === 'k78-shapes' ? 10 : 5);
  expect(reference.metrics.sync_check).toBe(null);
  for (const suspension of modes) {
    const got = await output(id, suspension);
    expect(got.faults, suspension).toEqual([]);
    expect(got.lines, suspension).toEqual(reference.lines);
    expect(got.metrics.sync_check, suspension).toMatchObject({ violations: 0, first: null });
  }
}, 1800000);
