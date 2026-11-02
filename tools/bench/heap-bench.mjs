// Original CC0-1.0. Native measurement of the real guest allocator (not host malloc).
// Usage: node tools/bench/heap-bench.mjs [git-revision|working] [output.json]
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, freemem, totalmem, loadavg, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const [revision='working',output='reports/heap-bench.json']=process.argv.slice(2);
const source=(path)=>revision==='working'?readFileSync(join(root,path),'utf8'):execFileSync('git',['show',`${revision}:${path}`],{cwd:root,encoding:'utf8'});
const core=source('platforms/win32/w32_core.c');
let heap=core.slice(core.indexOf('static uint32_t heap_end'),core.indexOf('/* ------------------------------------------------------------------ modules + resources */'));
if(core.includes('#include "w32_heap.h"'))heap=heap.slice(0,heap.indexOf('#include "w32_heap.h"'))+source('platforms/win32/w32_heap.h');
// Only mapping is simulated; allocator, including actual guest-header access, is unchanged.
const prelude=`#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#define W32_64 1
#define H_HEAP 0x80000u
#define W32_HEAP_LO 0x04000000u
#define W32_HEAP_HI 0x10000000u
static unsigned char memory[W32_HEAP_HI];
static unsigned char *x86_pages[1<<20];
static unsigned char x86_protection[1<<20];
static unsigned w32_nmods;
static struct {unsigned base,size;} w32_mods[1];
static unsigned char *x86_map(unsigned p,unsigned n){if(p>W32_HEAP_HI||n>W32_HEAP_HI-p)return 0;for(unsigned i=p>>12;i<(p+n+4095)>>12;i++)x86_pages[i]=memory+(i<<12);return memory+p;}
static unsigned char *x86_host(unsigned p){return memory+p;}
static unsigned x86_rd32(unsigned p){unsigned v;memcpy(&v,memory+p,4);return v;}
static void x86_wr32(unsigned p,unsigned v){memcpy(memory+p,&v,4);}
static unsigned x86_rd8(unsigned p){return memory[p];}
static void x86_wr8(unsigned p,unsigned v){memory[p]=(unsigned char)v;}
`;
const snapshot=()=>({at:new Date().toISOString(),cpu:cpus()[0]?.model,cpus:cpus().length,platform:platform(),totalmem:totalmem(),freemem:freemem(),loadavg:loadavg(),disk:execFileSync('df',['-k',root],{encoding:'utf8'}).trim()});
const dir=mkdtempSync(join(tmpdir(),'bgt-heap-bench-'));
try {
  const c=join(dir,'bench.c'),bin=join(dir,'bench');
  const workload=readFileSync(join(root,'tests/fixtures/c/heap_bench.c'),'utf8');
  const sha256=(s)=>createHash('sha256').update(s).digest('hex');
  writeFileSync(c,prelude+heap+'\n'+workload);
  const compiler=execFileSync('cc',['--version'],{encoding:'utf8'}).split('\n')[0];
  execFileSync('cc',['-std=c11','-O2',c,'-o',bin]);
  const before=snapshot(),start=performance.now();
  const timed=platform()==='darwin';
  const run=spawnSync(timed?'/usr/bin/time':bin,timed?['-l',bin]:[],{encoding:'utf8',timeout:600000});
  if(run.error||run.status!==0)throw new Error(`benchmark failed: ${run.error??run.status}\n${run.stderr}`);
  const rows=run.stdout.trim().split('\n').map(s=>JSON.parse(s));
  const commit=execFileSync('git',['rev-parse',revision==='working'?'HEAD':revision],{cwd:root,encoding:'utf8'}).trim();
  const result={revision,commit,allocator_sha256:sha256(heap),workload_sha256:sha256(workload),compiler,childResources:run.stderr.trim(),mode:'native -O2, real guest allocator, simulated always-successful mapping; not browser or target timing',before,after:snapshot(),wall_ms:performance.now()-start,rows};
  writeFileSync(resolve(root,output),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {rmSync(dir,{recursive:true,force:true});}
