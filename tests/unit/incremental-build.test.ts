// @bgt-examples: none
import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-expect-error ESM build helper transport
import { execFileSync as helperExec } from '../../tools/build/exec.mjs';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
// @ts-expect-error ESM build orchestration
import { analyzeCached } from '../../tools/build/chunks.mjs';
// @ts-expect-error ESM build orchestration
import { prepareObjects } from '../../tools/build/objects.mjs';

it('analysis cache verifies payload and keys binary, tool, identity and base', () => {
 const d=mkdtempSync(join(tmpdir(),'bgt-analysis-exact-'));
 try { const f=join(d,'input'),t=join(d,'tool'); writeFileSync(f,'A'); writeFileSync(t,'#!/usr/bin/env python3\nimport json\nprint(json.dumps({"functions":[],"totals":{}}))\n'); chmodSync(t,0o755);
  const run=(base=1,id='m')=>analyzeCached(t,f,id,base,d,'identity'); const a=run(); expect(a.analysis_cached).toBe(false); expect(run().analysis_cached).toBe(true);
  writeFileSync(f,'B'); expect(run().analysis_cached).toBe(false); writeFileSync(t,readFileSync(t,'utf8')+'#tool\n'); expect(run().analysis_cached).toBe(false);
  expect(run(2).analysis_cached).toBe(false); expect(run(2,'other').analysis_cached).toBe(false);
  writeFileSync(join(d,'analysis_m.json'),'corrupt'); expect(run().analysis_cached).toBe(false);
 } finally {rmSync(d,{recursive:true,force:true});}
});

it('lift cache verifies source and stats and invalidates option keys',()=>{
 const d=mkdtempSync(join(tmpdir(),'bgt-lift-exact-'));
 try { const o=join(d,'chunk.c'),t=join(d,'emit.py'); writeFileSync(t,'import sys\nout=sys.argv[sys.argv.index("--out")+1]\nopen(out,"w").write("int guest(void){return 42;}\\n")\nopen(out+".stats.json","w").write("{}")\n');
  const run=(key='A')=>JSON.parse(helperExec('python3',['-I',join(ROOT,'tools/build/lift.py')],{input:JSON.stringify({tasks:[{out:o,key,args:['python3','-I',t]}],jobs:1}),encoding:'utf8'}));
  expect(run().chunks_lifted).toBe(1); expect(run().chunks_cached).toBe(1); writeFileSync(o,'stale'); expect(run().chunks_lifted).toBe(1); rmSync(o); expect(run()).toMatchObject({chunks_lifted:1}); expect(run('B').chunks_lifted).toBe(1); expect(run('B').chunks_cached).toBe(1);
 } finally {rmSync(d,{recursive:true,force:true});}
});

it('parallelism clamps from physical-memory readings and fails closed',()=>{
 const code='import runpy\nfrom unittest.mock import patch\nm=runpy.run_path("tools/build/parallel.py")\nwith patch("runpy.run_path",return_value={"available":lambda:5*1024*1024*1024}),patch("os.cpu_count",return_value=16):\n assert m["parallelism"](8)[0]==4 and m["parallelism"](8,"lift")[0]==5\nwith patch("runpy.run_path",side_effect=OSError("unknown")):\n assert m["parallelism"](8)[0]==1\nprint("ok")'; expect(execFileSync('python3',['-I','-c',code],{cwd:ROOT,encoding:'utf8'}).trim()).toBe('ok');
});


it('real guest and native emitter depend on architecture, not runtime GPU/profile headers',()=>{
 const d=mkdtempSync(join(tmpdir(),'bgt-include-boundary-'));
 try {
  for(const p of ['platforms/x86','tools/x86','bgt/include']) cpSync(join(ROOT,p),join(d,p),{recursive:true});
  mkdirSync(join(d,'src'));
  const g=join(d,'src/guest.c'),r=join(d,'src/runtime.c');
  writeFileSync(g,'#include "x86_lift64.h"\nint guest(void){return (int)X.r[EAX];}\n');
  writeFileSync(r,'#include "x86.h"\n#include "bgt.h"\nint runtime(void){return X86_CENSUS_CAP;}\n');
  const includes=[join(d,'platforms/x86'),join(d,'bgt/include')];
  const cfg={sources:[g,r,join(d,'tools/x86/x86tool.c')],flags:includes.flatMap(p=>['-I',p]),includes,
   compiler:{path:'cc',prefix:[],version:'test'},cache:join(d,'objects'),root:d};
  const first=prepareObjects(cfg);
  for(const name of ['bgt/include/bgt_gpu.h','platforms/x86/x86_profile.h']) {
   const p=join(d,name);writeFileSync(p,readFileSync(p,'utf8')+'\n/* runtime only */\n'); const next=prepareObjects(cfg);
   expect(next[0].out).toBe(first[0].out); expect(next[1].out).not.toBe(first[1].out); expect(next[2].out).toBe(first[2].out);
  }
  const p=join(d,'platforms/x86/x86_arch.h');writeFileSync(p,readFileSync(p,'utf8')+'\n/* lifted ABI input */\n'); const next=prepareObjects(cfg);
  expect(next[0].out).not.toBe(first[0].out); expect(next[1].out).not.toBe(first[1].out); expect(next[2].out).not.toBe(first[2].out);
 } finally {rmSync(d,{recursive:true,force:true});}
},30_000);
