import { it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/headless';
// @ts-expect-error ESM tool
import { buildLock } from '../../tools/build/lock.mjs';
// @ts-expect-error ESM tool
import { buildFixture } from '../../tools/build/pipeline.mjs';

it('interrupted chunk publication never leaves a previous key validating new code',()=>{
  const script=String.raw`
import io,json,os,runpy,tempfile
from unittest.mock import patch
m=runpy.run_path('tools/build/lift.py')
with tempfile.TemporaryDirectory() as d:
 out=d+'/chunk.c'
 for ext,text in [('', 'OLD'),('.stats.json','{}'),('.key','A')]:open(out+ext,'w').write(text)
 def command(args,**kw):
  target=args[args.index('--out')+1]
  open(target,'w').write('NEW');open(target+'.stats.json','w').write('{}')
 real=os.replace
 def replace(src,dst):
  if src.endswith('.stats.json'):raise OSError('injected interruption')
  return real(src,dst)
 cfg={'tasks':[{'out':out,'key':'B','args':['fake']}],'jobs':1}
 with patch('sys.stdin',io.StringIO(json.dumps(cfg))),patch('subprocess.run',command),patch('os.replace',replace):
  try:m['main']()
  except OSError:pass
  else:raise AssertionError('injection did not fire')
 assert not os.path.exists(out+'.key'),'stale A key still validates B code'
 cfg['tasks'][0]['key']='A'
 with patch('sys.stdin',io.StringIO(json.dumps(cfg))),patch('subprocess.run',command):m['main']()
 assert open(out+'.key').read()=='A'
`;
  const out=execFileSync('python3',['-I','-c',script],{cwd:ROOT,encoding:'utf8'});
  expect(JSON.parse(out).chunks_lifted).toBe(1);
});
it('generated header changes invalidate fixture objects without source changes',()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/header-test-'));
  try {
    writeFileSync(join(dir,'value.txt'),'1');
    writeFileSync(join(dir,'generate.mjs'),`import{mkdirSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';const out=process.argv[2];mkdirSync(out,{recursive:true});writeFileSync(join(out,'value.h'),'#define VALUE '+readFileSync('value.txt','utf8')+'\\n');writeFileSync(join(out,'main.c'),'#include "value.h"\\n__declspec(dllimport) void __stdcall ExitProcess(unsigned); int _tls_index; void entry(void){ExitProcess(VALUE);}\\n');console.log(JSON.stringify(['main.c']));`);
    const fx={generator:'generate.mjs',target:'x86_64-windows-gnu',out:'header.exe',libs:['kernel32']},out=join(dir,'out');
    const exe=buildFixture(dir,fx,out),first=readFileSync(exe);
    buildFixture(dir,fx,out);expect(JSON.parse(readFileSync(join(out,'fixture-metrics.json'),'utf8')).objects_compiled).toBe(0);
    writeFileSync(join(dir,'value.txt'),'2');buildFixture(dir,fx,out);
    expect(JSON.parse(readFileSync(join(out,'fixture-metrics.json'),'utf8')).objects_compiled).toBe(1);
    expect(readFileSync(exe)).not.toEqual(first);
  } finally {rmSync(dir,{recursive:true,force:true});}
},30_000);
it('kernel locks serialize competing processes and survive a killed owner and legacy orphan markers',async()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/lock-test-'));
  const module=new URL('../../tools/build/lock.mjs',import.meta.url).href;
  try {
    mkdirSync(join(dir,'same.lock')); // old implementation's crash-before-PID state
    const source=`import{buildLock}from ${JSON.stringify(module)};import{appendFileSync}from'node:fs';const release=buildLock(${JSON.stringify(dir)},'same',5);appendFileSync(${JSON.stringify(join(dir,'events'))},${JSON.stringify('start\n')});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);appendFileSync(${JSON.stringify(join(dir,'events'))},${JSON.stringify('end\n')});release();`;
    const children=Array.from({length:4},()=>spawn(process.execPath,['--input-type=module','-e',source],{stdio:'pipe'}));
    const codes=await Promise.all(children.map(async(c)=>(await once(c,'exit'))[0]));
    expect(codes).toEqual([0,0,0,0]);
    expect(readFileSync(join(dir,'events'),'utf8').trim().split('\n')).toEqual(Array.from({length:4},()=>['start','end']).flat());
    const owner=spawn(process.execPath,['--input-type=module','-e',`import{buildLock}from ${JSON.stringify(module)};buildLock(${JSON.stringify(dir)},'same');console.log('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100000);`],{stdio:'pipe'});
    await once(owner.stdout,'data');const dead=once(owner,'exit');owner.kill('SIGKILL');await dead;
    const release=buildLock(dir,'same',2);release();
    expect(existsSync(join(dir,'same.flock'))).toBe(true);
  } finally {rmSync(dir,{recursive:true,force:true});}
},10_000);

it('owner exit drains surviving subprocess writers before the next build publishes',async()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/writer-test-'));
  const lock=new URL('../../tools/build/lock.mjs',import.meta.url).href;
  const commands=new URL('../../tools/build/exec.mjs',import.meta.url).href;
  const marker=join(dir,'worker-ready'),gate=join(dir,'go'),output=join(dir,'output'),next=join(dir,'next');
  const writer=`import os,time\nopen(${JSON.stringify(marker)},'w').write('ready')\nwhile not os.path.exists(${JSON.stringify(gate)}):time.sleep(.01)\nopen(${JSON.stringify(output)},'w').write('OLD')`;
  let owner:ReturnType<typeof spawn>|undefined,contender:ReturnType<typeof spawn>|undefined;
  try {
    owner=spawn(process.execPath,['--input-type=module','-e',`import{buildLock}from ${JSON.stringify(lock)};import{execFileSync,withBuildWriters}from ${JSON.stringify(commands)};const r=buildLock(${JSON.stringify(dir)},'build');withBuildWriters(r.token,()=>execFileSync('python3',['-I','-c',${JSON.stringify(writer)}]));r();`],{stdio:'pipe'});
    for(let n=0;!existsSync(marker);n++){if(n>200)throw new Error('worker did not start');await new Promise((r)=>setTimeout(r,10));}
    const dead=once(owner,'exit');owner.kill('SIGKILL');await dead;
    contender=spawn(process.execPath,['--input-type=module','-e',`import{buildLock}from ${JSON.stringify(lock)};import{writeFileSync}from'node:fs';const r=buildLock(${JSON.stringify(dir)},'build',5);writeFileSync(${JSON.stringify(next)},'ready');writeFileSync(${JSON.stringify(output)},'NEW');r();`],{stdio:'pipe'});
    const exited=once(contender,'exit');await new Promise((r)=>setTimeout(r,100));expect(existsSync(next)).toBe(false);
    writeFileSync(gate,'go');expect((await exited)[0]).toBe(0);expect(readFileSync(output,'utf8')).toBe('NEW');
  } finally {writeFileSync(gate,'go');owner?.kill('SIGKILL');contender?.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
},10_000);

it('kernel exit notification recovers a dead-but-unreaped owner',()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/zombie-test-'));
  const module=new URL('../../tools/build/lock.mjs',import.meta.url).href;
  try {
    const acquire=`import{buildLock}from ${JSON.stringify(module)};const r=buildLock(${JSON.stringify(dir)},'same',2);console.log('acquired');r();`;
    const owner=`import{buildLock}from ${JSON.stringify(module)};buildLock(${JSON.stringify(dir)},'same');console.log('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100000);`;
    const script=`import os,signal,subprocess\np=subprocess.Popen([${JSON.stringify(process.execPath)},'--input-type=module','-e',${JSON.stringify(owner)}],stdout=subprocess.PIPE)\nassert p.stdout.readline().strip()==b'locked'\nos.kill(p.pid,signal.SIGKILL)\nos.waitid(os.P_PID,p.pid,os.WEXITED|os.WNOWAIT)\ntry:subprocess.run([${JSON.stringify(process.execPath)},'--input-type=module','-e',${JSON.stringify(acquire)}],check=True)\nfinally:p.wait()`;
    expect(execFileSync('python3',['-I','-c',script],{encoding:'utf8'})).toContain('acquired');
  } finally {rmSync(dir,{recursive:true,force:true});}
},10_000);

it('caller process-group signals cannot kill its detached lock guardian',async()=>{
  const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/group-test-'));
  const module=new URL('../../tools/build/lock.mjs',import.meta.url).href;
  const owner=spawn(process.execPath,['--input-type=module','-e',`import{buildLock}from ${JSON.stringify(module)};process.on('SIGTERM',()=>{});buildLock(${JSON.stringify(dir)},'same');console.log('ready');setInterval(()=>{},1000);`],{detached:true,stdio:'pipe'});
  try {
    await once(owner.stdout!,'data');process.kill(-owner.pid!,'SIGTERM');await new Promise((r)=>setTimeout(r,50));
    expect(()=>buildLock(dir,'same',0.1)).toThrow();
  } finally {const dead=once(owner,'exit');owner.kill('SIGKILL');await dead;const release=buildLock(dir,'same',2);release();rmSync(dir,{recursive:true,force:true});}
},10_000);
