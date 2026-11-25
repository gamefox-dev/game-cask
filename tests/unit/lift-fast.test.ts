// @bgt-examples: none
// Original CC0-1.0. K52 fast lifting mode: policy plumbing, emission shape, and execution through
// the production runtime against the interpreter (registers, RAM, RIP, retirement and, since K75, the instruction
// clock: X.tsc and the quantum's frame_insns). EFLAGS at a frame end are not compared (fast mode treats them as dead
// across calls/returns per the Win64 ABI); K75: the EFLAGS a profile call observes are (see the observed-flags test).
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error plain ESM
import { liftPolicy, liftPolicyArgs } from '../../tools/build/chunks.mjs';
import { fastHarness } from '../support/fast-harness';
import { perTestTool } from '../support/per-test-tool';
// @ts-expect-error plain ESM
import { x86tool, refuseTestCorruptPort } from '../../tools/build/pipeline.mjs';
const tool = perTestTool(x86tool);
const modes = ['asyncify', ...(jspiApi() ? ['jspi'] : [])] as ('asyncify' | 'jspi')[];

const { lift, harness } = fastHarness(tool);
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
  // K75: liftFast.flags (observed default, abi = the K52 rule for measurement); vK72b: testCorrupt only under vitest.
  expect(liftPolicyArgs(liftPolicy({ liftMode: 'fast', liftFast: { flags: 'abi' } }, {})).slice(-2)).toEqual(['--fast-flags', 'abi']);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { flags: 'lazy' } }, {})).toThrow(/liftFast.flags/);
  expect(() => liftPolicy({ liftMode: 'fast', liftFast: { testCorrupt: 'stack' } }, {})).toThrow(/test-only/);
  expect(liftPolicy({ liftMode: 'fast', liftFast: { testCorrupt: 'stack' } }, { VITEST: 'true' }).liftFast).toEqual({ testCorrupt: 'stack' });
  expect(liftPolicy({ liftMode: 'fast', liftFast: { testCorrupt: 'off' } }, {}).liftFast).toEqual({ testCorrupt: 'off' });
  // vK75: also refused under port/ by real path (a symlinked alias of port/ or of the game directory).
  const root = mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/lift-fast-port-')), corrupt = { liftFast: { testCorrupt: 'stack' } };
  try {
    mkdirSync(join(root, 'port/game'), { recursive: true }); mkdirSync(join(root, 'kit/game'), { recursive: true });
    symlinkSync(join(root, 'port'), join(root, 'alias')); symlinkSync(join(root, 'port/game'), join(root, 'kit/link'));
    symlinkSync(join(root, 'kit/game'), join(root, 'port/out')); // vK75b: inside port/, pointing out of it
    for (const dir of ['port/game', 'alias/game', 'kit/link', 'port/out']) expect(() => refuseTestCorruptPort(corrupt, join(root, dir), root), dir).toThrow(/port builds/);
    expect(() => refuseTestCorruptPort(corrupt, join(root, 'kit/game'), root)).not.toThrow();
    expect(() => refuseTestCorruptPort({ liftFast: { testCorrupt: 'off' } }, join(root, 'alias/game'), root)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
  // K75: other guest modules' DLL names reach the fast lifter (their imports are guest code, not profile calls).
  expect(liftPolicyArgs({ liftMode: 'fast', fastGuestDlls: ['engine.dll', 'game.exe'] })).toEqual(['--lift-mode', 'fast', '--fast-guest-dlls', 'engine.dll,game.exe']);
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

// K75: EFLAGS at a call into the platform profile are guest-visible (RtlCaptureContext, RaiseException, heap
// exceptions store them in a CONTEXT). f: sub rsp,0x28; mov eax,5; cmp eax,7; call h; call g; call SERVICE; add rsp,0x28;
// ret. h: call SERVICE; ret (observes its entry flags: the cmp's 0x91). g: mov eax,3; sub eax,3; ret (returns ZF|PF,
// observed by f's next profile call). Both captures equal the interpreter's, inlined or not; the K52 rule
// (--fast-flags abi) loses both (the test fails without the K75 analysis).
const OBSERVED = (() => {
  const code = Buffer.alloc(0xa0, 0x90);
  Buffer.from('4883ec28' + 'b805000000' + '83f807' + 'e84f000000' + 'e82a000000' + 'e8e54f0000' + '4883c428' + 'c3', 'hex').copy(code);
  Buffer.from('b803000000' + '83e803' + 'c3', 'hex').copy(code, 0x40);
  Buffer.from('e89b4f0000' + 'c3', 'hex').copy(code, 0x60);
  Buffer.from('b82a000000c3', 'hex').copy(code, 0x80);
  return code;
})();
// vK75: through pointers. f: sub rsp,0x28; mov eax,5; cmp eax,7; mov rcx,SERVICE; call rcx (an unknown callee sees
// the cmp's flags); mov rcx,g; call rcx (g, address-taken, returns ZF|PF); call SERVICE; add rsp,0x28; ret.
const INDIRECT = (() => {
  const code = Buffer.alloc(0xa0, 0x90);
  Buffer.from('4883ec28' + 'b805000000' + '83f807' + '48c7c100700000' + 'ffd1' + '48c7c140200000' + 'ffd1' + 'e8dd4f0000' + '4883c428' + 'c3', 'hex').copy(code);
  Buffer.from('b803000000' + '83e803' + 'c3', 'hex').copy(code, 0x40);
  Buffer.from('b82a000000c3', 'hex').copy(code, 0x80);
  return code;
})();
for (const [shape, extra] of SHAPES) for (const inline of ['0', '48']) for (const [name, code, cuts] of [['entry and returned flags', OBSERVED, [0, 0x40, 0x60, 0x80]], ['through pointers', INDIRECT, [0, 0x40, 0x80]]] as [string, Buffer, number[]][])
it(`execution (${shape}, inline ${inline}): EFLAGS observed by profile calls match the interpreter (${name})`, async () => {
  const h = await harness(code, cuts, [...FAST, '--fast-inline', inline, ...extra]);
  const captured = (interpreted: number) => {
    const got = h.run(interpreted, 0, () => h.ex.configure_service(0));
    expect(h.ex.service_count()).toBe(2);
    return { got, flags: [h.ex.service_flag(0), h.ex.service_flag(1)] };
  };
  const fast = captured(0); expect(h.ex.interpretation()).toBe(0);
  expect(fast.flags).toEqual([0x202 | 0x91, 0x202 | 0x44]);
  expect(fast).toEqual(captured(1));
  const abi = await harness(code, cuts, [...FAST, '--fast-inline', inline, '--fast-flags', 'abi', ...extra]);
  abi.run(0, 0, () => abi.ex.configure_service(0));
  expect([abi.ex.service_flag(0), abi.ex.service_flag(1)]).not.toEqual([0x202 | 0x91, 0x202 | 0x44]);
}, 120000);

// K75: the lifter makes EFLAGS exact only at calls to the APIs listed in tools/x86/lift64_eflags.h. The list must be
// exactly the profile APIs that read X.flags: w64_context_save is the only reader, called by RtlCaptureContext and by
// unwind_exception with no initial context (RaiseException, RtlUnwindEx outside a dispatch, w32_heap_no_memory via
// k_heap_oom in the heap APIs).
it('lift64_eflags.h lists exactly the profile APIs that store EFLAGS', () => {
  const dir = join(ROOT, 'platforms/win32');
  const sources = readdirSync(dir).filter((f) => /\.(c|h)$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
  const reads = sources.flatMap(([f, t]) => [...t.matchAll(/X\.flags(?!\s*=[^=])/g)].map(() => f));
  expect(reads).toEqual(['w32_x64.c']); // the CONTEXT store in w64_context_save
  const x64 = sources.find(([f]) => f === 'w32_x64.c')![1], kernel = sources.find(([f]) => f === 'w32_kernel.c')![1];
  const all = sources.map(([, t]) => t).join('\n');
  expect([...all.matchAll(/w64_context_save\(/g)].length).toBe(4); // declaration, definition, unwind_exception, rtl_capture
  const handlers = new Map([...x64.matchAll(/\{"(\w+)",(\w+)\}/g)].map((m) => [m[2], m[1]]));
  const unwindNoInitial = ['raise_exception', 'rtl_unwind'].filter((fn) => new RegExp(`static uint32_t ${fn}\\(void\\)\\{[^\\n]*unwind_exception\\(`).test(x64));
  // Each API handler's text runs to the next top-level `static` definition.
  const heap = [...kernel.matchAll(/static uint32_t (k_\w+)\(void\) ?\{([\s\S]*?)(?=\nstatic |\n#|$)/g)].filter((m) => m[2].includes('k_heap_oom(')).map((m) => m[1]);
  const heapNames = heap.map((fn) => new RegExp(`API\\("(\\w+)", \\d+, ${fn}\\)`).exec(kernel)?.[1]);
  const expected = [handlers.get('rtl_capture'), ...unwindNoInitial.map((fn) => handlers.get(fn)), ...heapNames].sort();
  const listed = JSON.parse('[' + /#define W32_EFLAGS_OBSERVERS (.*)/.exec(readFileSync(join(ROOT, 'tools/x86/lift64_eflags.h'), 'utf8'))![1] + ']').sort();
  expect(expected).toEqual(['HeapAlloc', 'HeapCreate', 'HeapReAlloc', 'RaiseException', 'RtlCaptureContext', 'RtlUnwindEx']);
  expect(listed).toEqual(expected);
});

// vK72b review: the guest-state memory part also sees a stray store into the host backing of an unmapped page
// inside the committed flat window (a fast build's masked wild pointer lands there); clean zero backing hashes as before.
it('guest-state hash: nonzero backing of an unmapped committed page changes the memory part', async () => {
  const h = await harness(recursive(), [0, 0x40, 0x80], FAST);
  h.run(0, 0);
  expect(h.ex.page_mapped(0x10)).toBe(0); expect(h.ex.page_mapped(0x1010)).toBe(1);
  const clean = h.ex.state_hash(4);
  h.ex.poke_backing(0x10, 0x5a); const stray = h.ex.state_hash(4);
  h.ex.poke_backing(0x10, 0); expect(h.ex.state_hash(4)).toBe(clean);
  expect(stray).not.toBe(clean);
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
