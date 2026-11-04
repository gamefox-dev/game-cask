// Original CC0 import benchmark. Same generated PE and oracle, no game input.
import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadHeadless, ROOT } from '../../tests/support/headless';
import { oracle } from '../../tests/oracle/oracle';
// @ts-expect-error plain ESM
import { importSource } from '../../examples/x64-imports/generate.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../build/build.mjs';
// @ts-expect-error plain ESM
import { resourceSnapshot } from '../probe/resources.mjs';
interface ImportMetrics {
  interp_insns: number; stubs: string[]; exited: number;
  thunk_dispatches?: number; direct_import_calls?: number; leaf_import_calls?: number;
  cpu_profile: { census_dropped: number; apis: { name: string; count: number }[]; exits: { reason: number; count: number; address: number }[] };
}
const names = ['strcmp', 'GetLastError', 'SetLastError', 'TlsGetValue', 'GetCurrentThreadId', 'malloc', 'free'];
it('measures guarded imports versus the unchanged baseline with exact per-import counts and 300-update oracles', async () => {
  const count = Number(process.env.BGT_IMPORT_COUNT ?? 100000);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error("BGT_IMPORT_COUNT must be 1..100000");
  const rows = [];
  const start = resourceSnapshot();
  for (const name of names) for (const form of name === 'strcmp' ? ['tail', 'iat', 'reg'] : ['tail']) {
    const id = 'import-bench-' + name.toLowerCase() + '-' + form;
    const dir = join(ROOT, 'node_modules/.cache/bgt', id);
    mkdirSync(dir, { recursive: true });
    try {
    importSource(dir);
    const args = name === 'strcmp' ? '(ULONG_PTR)"same",(ULONG_PTR)"same"' : name === 'free' ? '0,0' : name === 'TlsGetValue' ? 'tls,0' : name === 'malloc' ? '32,0' : name === 'SetLastError' ? '0x12345678,0' : '0,0';
    writeFileSync(join(dir, 'bench.c'), '/* Original CC0-1.0. */\n#include <windows.h>\n#include <stdlib.h>\nint _tls_index;\n' +
'extern void benchmark_loop(ULONG_PTR,ULONG_PTR,void **,unsigned);\n' +
'static void *values[' + count + '];\nstatic void *volatile relocation_anchor=(void *)&relocation_anchor;\nvoid entry(void){\n(void)relocation_anchor;\n' +
'DWORD tls=TlsAlloc();TlsSetValue(tls,(void *)0x12345678);SetLastError(0x12345678);\n' +
(name === 'free' ? 'for(unsigned i=0;i<' + count + ';i++)values[i]=malloc(32);\n' : '') +
'OutputDebugStringA("IMPORT begin");\nbenchmark_loop(' + args + ',values,' + count + ');\nOutputDebugStringA("IMPORT end");\n' +
'unsigned fail=0;\n' +
(name === 'malloc' ? 'for(unsigned i=0;i<' + count + ';i++){if(!values[i])fail++;free(values[i]);}\n' : '') +
(['strcmp','GetLastError','TlsGetValue','GetCurrentThreadId'].includes(name) ? 'for(unsigned i=0;i<' + count + ';i++)if((ULONG_PTR)values[i]!=' + (name === 'strcmp' ? '0' : name === 'GetCurrentThreadId' ? '1' : '0x12345678') + ')fail++;\n' : '') +
'if(GetLastError()!=' + (name === 'TlsGetValue' ? '0' : '0x12345678') + ')fail++;\n' +
'OutputDebugStringA(fail?"IMPORT FAIL":"IMPORT PASS");ExitProcess(fail?1:0); }\n');
    const call = form === 'tail' ? 'call veneer' : form === 'iat' ? 'call *__imp_' + name + '(%rip)' : 'call *%r13';
    writeFileSync(join(dir, 'loop.S'), '/* Original CC0-1.0. */\n.text\n.globl benchmark_loop\n.seh_proc benchmark_loop\nbenchmark_loop:\n' +
'pushq %rbx\n.seh_pushreg %rbx\npushq %rsi\n.seh_pushreg %rsi\npushq %rdi\n.seh_pushreg %rdi\npushq %r12\n.seh_pushreg %r12\npushq %r13\n.seh_pushreg %r13\nsubq $32,%rsp\n.seh_stackalloc 32\n.seh_endprologue\n' +
'movq %rcx,%rbx\nmovq %rdx,%rsi\nmovq %r8,%rdi\nmovl %r9d,%r12d\n' +
(form === 'reg' ? 'movq __imp_' + name + '(%rip),%r13\n' : '') +
'loop_start:\n' + (name === 'free' ? 'movq (%rdi),%rcx\n' : 'movq %rbx,%rcx\n') +
'movq %rsi,%rdx\n' + call + '\nmovq %rax,(%rdi)\naddq $8,%rdi\ndecl %r12d\njnz loop_start\naddq $32,%rsp\npopq %r13\npopq %r12\npopq %rdi\npopq %rsi\npopq %rbx\nret\n.seh_endproc\n' +
(form === 'tail' ? '.seh_proc veneer\nveneer:\n.seh_endprologue\njmp *__imp_' + name + '(%rip)\n.seh_endproc\n' : ''));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 guarded imports benchmark', pipeline: {
      platform: 'win32', fixture: { target: 'x86_64-windows-gnu', sources: ['bench.c','loop.S','crt-imports.S'], out: 'bench.exe', libs: ['kernel32'] },
      modules: [{ from: './build/bench.exe', main: true }],
    } }));
    buildGame(dir, { quiet: true });
    buildGame(dir, { quiet: true, interpretOnly: true });
    const comparison = await oracle(id, 300);
    expect(comparison.errors).toEqual({ lifted: null, interpreted: null });
    expect(comparison.identical, JSON.stringify(comparison)).toBe(true);
    const samples = [];
    for (let run=0;run<6;run++) {
      let begin=0,end=0;
      const h = await loadHeadless(id, { onLog: (message) => {
        if(message==='guest: IMPORT begin')begin=performance.now();
        if(message==='guest: IMPORT end')end=performance.now();
      } });
      await h.stepAsync(300);
      expect(h.logs).toContain('guest: IMPORT PASS');
      expect(end).toBeGreaterThan(begin);
      const metrics=h.host.metrics() as unknown as ImportMetrics;
      expect(metrics.interp_insns).toBe(0);
      expect(metrics.stubs).toEqual([]);
      expect(metrics.exited).toBe(1);
      expect(metrics.cpu_profile.census_dropped).toBe(0);
      // Extra calls are the setup SetLastError and the final GetLastError assertion.
      // malloc cleanup and free preparation call the OTHER allocator API.
      const apiCount = metrics.cpu_profile.apis.filter(a => a.name === name).reduce((sum,a) => sum+a.count,0);
      expect(apiCount).toBe(count + (["SetLastError", "GetLastError"].includes(name) ? 1 : 0));
      const exits=metrics.cpu_profile.exits.filter(e => e.reason===5);
      if (metrics.leaf_import_calls !== undefined) {
        expect(metrics.leaf_import_calls).toBeGreaterThanOrEqual(count);
        expect(exits).toEqual([]);
      }
      samples.push({ warmup: run===0, ms:end-begin, ns_per_call:(end-begin)*1e6/count, metrics, exits });
    }
    rows.push({ name,form,count,oracle:comparison,samples });
    } finally {
    // Delete only these owned fixture outputs, also on a failed assertion/build.
    rmSync(join(ROOT,'web/public/games',id),{recursive:true,force:true});
    rmSync(join(ROOT,'web/public/games',id+'-interp'),{recursive:true,force:true});
    rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id),{recursive:true,force:true});
    rmSync(join(ROOT,'node_modules/.cache/bgt/pipeline',id+'-interp'),{recursive:true,force:true});
    rmSync(dir,{recursive:true,force:true});
    }
  }
  const report={ at:new Date().toISOString(), base:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(), resources:{start,end:resourceSnapshot()},rows };
  const file=process.env.BGT_IMPORT_REPORT;
  if(file)writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  else console.log(JSON.stringify(report));
});
