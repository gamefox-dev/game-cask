// Original CC0 minimal PE and full-state oracle for native AMD64 forms.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compileC } from './compile';
import { ROOT } from './headless';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
export const BASE = 0x01001000;
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
interface Exports {
  memory: WebAssembly.Memory;
  reset(pc: number, budget: number): void;
  run(interpreted: number): number;
  generic(): number;
  cpu(): number; cpu_size(): number; ram(): number;
  get_reg(index: number): bigint; set_reg(index: number, value: bigint): void;
  set_xmm(index: number, low: bigint, high: bigint): void; get_xmm(index: number, lane: number): bigint;
  set_flags(value: number): void; get_flags(): number; set_segments(fs: bigint, gs: bigint): void;
  protect(page: number, mode: number): void; unmap(page: number): void;
  fault_address(): number; fault_hash(): number; yields(): number; clock(): bigint;
  stop_at_quantum(enabled: number): void; resume(): void;
  tasks_init(): void; task_clone(index: number): void; task_next(): number;
  decode_valid(address: number, length: number): number;
}
export async function nativeHarness(hex: string, preset: string, tool = process.env.BGT_FORMS_TOOL ?? x86tool()) {
  const root = join(ROOT, 'node_modules/.cache/bgt/native-form-tests'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'case-')), code = Buffer.from(hex, 'hex');
  try {
    writeFileSync(join(dir, 'input.exe'), pe(code));
    execFileSync(tool, ['lift', join(dir, 'input.exe'), '--name', 'probe', '--out', join(dir, 'lifted.c'), '--lift-preset', preset]);
    const text = readFileSync(join(dir, 'lifted.c'), 'utf8');
    const source = `static const unsigned char test_code[]={` + [...code].join(',') + `};
#include "` + ROOT + `/tests/fixtures/c/codegen_harness.h"
` + text.replace('#include "x86_lift64.h"', '#include "' + ROOT + '/platforms/x86/x86_lift64.h"') + `
static unsigned generic_execs;
#include "` + ROOT + `/platforms/x86/x86_sched.c"
BGT_EXPORT(resume) void resume(void) { X.transfer=0;stop_at_quantum=0; }
BGT_EXPORT(set_segments) void set_segments(uint64_t fs,uint64_t gs) { X.fs_base=fs;X.gs_base=gs; }
BGT_EXPORT(tasks_init) void tasks_init(void) { __builtin_memset(x86_tasks,0,sizeof x86_tasks);x86_sched_init(); }
BGT_EXPORT(task_clone) void task_clone(unsigned index) { if(index<X86_THREADS){x86_tasks[index].cpu=X;x86_tasks[index].live=x86_tasks[index].ready=1;} }
BGT_EXPORT(task_next) unsigned task_next(void) { x86_sched_save();return x86_sched_next()?x86_current:UINT32_MAX; }
BGT_EXPORT(decode_valid) unsigned decode_valid(unsigned address,unsigned length) { x86_insn_t in;return x86_decode_mode(ram+address,length,0,1,&in)&&in.op!=XO_UNSUPPORTED; }
BGT_EXPORT(generic) unsigned generic(void) { return generic_execs; }
BGT_EXPORT(run) unsigned run(unsigned interpreted) {
    unsigned blocks=0;generic_execs=0;
    for(unsigned guard=0;!X.transfer && X.eip>=` + BASE + `u && X.eip<` + (BASE + code.length) + `u;guard++) {
        if(guard>5000000u)__builtin_trap();
        if(interpreted){reference();continue;}
        F_01001000();
        if(x86_lift_pending){const x86_insn_t *p=x86_lift_pending;x86_lift_pending=0;generic_execs++;x86_exec_one(p);}
        else if(x86_lift_count){unsigned n=x86_lift_count;x86_lift_count=0;blocks++;generic_execs+=n;x86_lift_block(n);}
    }
    return blocks;
}
`;
    writeFileSync(join(dir, 'probe.c'), source);
    const wasm = await compileC(relative(ROOT, join(dir, 'probe.c')));
    const { instance } = await WebAssembly.instantiate(wasm, { bgt: { coverage_entry: () => {}, slice_missing: () => { throw new Error('strict slice'); } } });
    const ex = instance.exports as unknown as Exports;
    const memory = () => new Uint8Array(ex.memory.buffer);
    const view = () => new DataView(ex.memory.buffer);
    const snapshot = () => ({ cpu: memory().slice(ex.cpu(), ex.cpu() + ex.cpu_size()),
      ram: memory().slice(ex.ram(), ex.ram() + 65536), address: ex.fault_address(), diagnostic: ex.fault_hash(), yields: ex.yields() });
    return { ex, memory, view, snapshot, text, bytes: wasm.length,
      stats: JSON.parse(readFileSync(join(dir, 'lifted.c.stats.json'), 'utf8')) as { generic: number; specialized: number } };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Conditional edges retain every case as a real analyzed native block. Tests enter at
// its exact target; a RET ends it without running the next case. Compile once per matrix.
export async function nativeCases(codes: string[], preset: string) {
  let offset = codes.length * 6 + 1;
  const pcs: number[] = [], branches: Buffer[] = [];
  codes.forEach((code, i) => {
    pcs.push(BASE + offset);
    const branch = Buffer.from('0f8400000000', 'hex'); branch.writeInt32LE(offset - (i + 1) * 6, 2); branches.push(branch);
    offset += code.length / 2 + 1;
  });
  const h = await nativeHarness(Buffer.concat([...branches, Buffer.from('c3' + codes.map(c => c + 'c3').join(''), 'hex')]).toString('hex'), preset);
  return { ...h, pcs };
}
