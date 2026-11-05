// @bgt-examples: none
// vK33: compiler descendants, dep discovery and macro tokenization are OS boundaries too.
import {it, expect} from 'vitest';
import {spawnSync, execFileSync} from 'node:child_process';
import {chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from '../support/headless';
// @ts-expect-error plain ESM tool
import {findGcc} from '../../tools/build/check-host-gcc.mjs';

// @ts-expect-error plain ESM build plan flags
import {CFLAGS,LDFLAGS} from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM object plan flags
import {hermeticTimeFlags,portableFlags} from '../../tools/build/objects.mjs';

const gcc=findGcc();
const compilers=[...new Set(['cc',gcc].filter(Boolean))] as string[];
const command=join(ROOT,'tools/build/command.py');
const padding=(n:number)=>Array.from({length:n},(_,i)=>'-DBGT_PADDING_'+i+'='+i);
const driver=[
 'import json,os,runpy,stat,sys',
 'assert stat.S_ISREG(os.fstat(0).st_mode), "compiler probe requires finite-file stdin"',
 "run=runpy.run_path(sys.argv[1])['run']",
 'try:',
 ' r=run(json.load(sys.stdin),stdout=-1,stderr=-1)',
 ' sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);sys.exit(r.returncode)',
 'except ValueError as e:',
 ' print(str(e),file=sys.stderr);sys.exit(90)',
].join('\n');
// K23: synchronous Node pipe EOF can stall json.load even after all bytes arrive.
// Exercise compiler transport, not that unrelated pipe race; keep the same deadline.
function pythonPlan(script:string,input:unknown,cwd?:string,timeout=8000){
 const dir=mkdtempSync(join(tmpdir(),'bgt-compiler-plan-')),path=join(dir,'stdin');
 let fd:number|undefined;
 try {
  writeFileSync(path,JSON.stringify(input),{mode:0o600});fd=openSync(path,'r');unlinkSync(path);
  return spawnSync('python3',['-I','-c',script,command],{cwd,stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout});
 } finally {if(fd!==undefined)closeSync(fd);rmSync(dir,{recursive:true,force:true});}
}
function transported(args:string[],cwd:string){return pythonPlan(driver,args,cwd);}

it.each(compilers)('sanitizes supported dependency destinations for %s and rejects opaque or implicit forms',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-dependency-forms-'));
 try {
  const nested=join(dir,'inputs');mkdirSync(nested);
  writeFileSync(join(nested,'real.h'),'#define VALUE 23\n');
  for(const n of ['first','second'])writeFileSync(join(nested,n+'.c'),'#include "real.h"\nint '+n+'(void){return VALUE;}\n');
  const common=[...padding(14000),join(nested,'first.c')];
  const clean=(text:string)=>{expect(text).toContain('real.h');expect(text).not.toMatch(/\/dev\/fd\/|bgt-macros-/);};
  for(const flags of [['-M','-MF','-'],['-MM','-MF-','-MP','-MQ','target with spaces'],['-MD','-MF','-','-c','-o',join(dir,'stdout.o')]]){
   const r=transported([cc,...flags,...common],dir);expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);clean(r.stdout);
  }
  for(const mode of ['-MD','-MMD']){
   const path=join(dir,'wp'+mode+'.d');
   const r=transported([cc,'-Wp,'+mode+','+path,'-c','-o',join(dir,'wp.o'),...common],dir);
   expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(90);
   expect(r.stderr).toMatch(/option unsupported under macro transport.*direct -MD\/-MF/);
   expect(readdirSync(dir)).not.toContain('wp'+mode+'.d');
  }
  const multi=transported([cc,'-MD','-MP','-c',...common,join(nested,'second.c')],dir);
  expect(multi.error).toBeUndefined();expect(multi.status,multi.stderr).toBe(90);
  expect(multi.stderr).toMatch(/implicit \.d.*supply explicit -MF/);
  expect(readdirSync(dir)).not.toContain('first.d');expect(readdirSync(dir)).not.toContain('second.d');
  const explicit=join(dir,'named.d');
  const r=transported([cc,'-MMD','-MF'+explicit,'-MQ','custom target','-c','-o',join(dir,'custom.o'),...common],dir);
  expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);clean(readFileSync(explicit,'utf8'));
  for(const unsupportedOption of ['--dependencies','--user-dependencies','--write-dependencies','--write-user-dependencies','-H','-v','-funknown-bgt-option','-Wunknown-warning','-object-file-name=unexpected','-opt-record-file=unexpected']){
   const r=transported([cc,unsupportedOption,...common],dir);
   expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(90);
   expect(r.stderr).toMatch(/option unsupported under macro transport.*supported kit options/);
   expect(r.stderr).not.toMatch(/bgt-macros-/);
  }
  const unsupported=transported([cc,'-Xpreprocessor','-MD',...common],dir);
  expect(unsupported.status,unsupported.stderr).toBe(90);expect(unsupported.stderr).toMatch(/dependency output.*unsupported.*direct -MD\/-MF/);
  for(const key of ['DEPENDENCIES_OUTPUT','SUNPRO_DEPENDENCIES']){
   const path=join(dir,key+'.d');
   const envScript=driver.replace('try:', 'os.environ['+JSON.stringify(key)+']='+JSON.stringify(path)+'\ntry:');
   const env=pythonPlan(envScript,[cc,'-c','-o',join(dir,'env.o'),...common],dir);
   expect(env.status,env.stderr).toBe(90);expect(env.stderr).toMatch(/dependency output through environment.*use direct/);
   expect(readdirSync(dir)).not.toContain(key+'.d');
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});


it.each(compilers)('sanitizes dependency outputs even when %s fails with check=True',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-dependency-error-'));
 try {
  writeFileSync(join(dir,'real.h'),'#define VALUE 23\n');
  writeFileSync(join(dir,'bad.c'),'#include "real.h"\nint value(void){return VALUE + ;}\n');
  const script=[
   'import json,runpy,subprocess,sys',
   "run=runpy.run_path(sys.argv[1])['run']",
   'try:',
   ' run(json.load(sys.stdin),check=True,capture_output=True)',
   'except subprocess.CalledProcessError as e:',
   ' sys.stdout.buffer.write(e.output);sys.stderr.buffer.write(e.stderr);sys.exit(e.returncode)',
  ].join('\n');
  for(const destination of ['-',join(dir,'errors.d')]){
   const r=pythonPlan(script,[cc,'-MD','-MF',destination,'-c','-o',join(dir,'bad.o'),...padding(14000),join(dir,'bad.c')],dir);
   expect(r.error).toBeUndefined();expect(r.status).toBe(1);
   const deps=destination==='-'?r.stdout:readFileSync(destination,'utf8');
   expect(deps).toContain('real.h');expect(deps).not.toMatch(/\/dev\/fd\/|bgt-macros-/);
   expect(r.stderr).toMatch(/error:/);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});


it.each(compilers)('replaces private header paths in captured, inherited and redirected %s diagnostics',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-diagnostic-output-'));
 try {
  const script=[
   'import json,os,runpy,subprocess,sys',
   "m=runpy.run_path(sys.argv[1]);cc,root=json.load(sys.stdin)",
   "header=os.path.join(root,'private-command-line.h');source=os.path.join(root,'source.c')",
   "open(header,'w').write('#error transport diagnostic canary\\n')",
   "open(source,'w').write('int value(void){return 0;}\\n')",
   "original=[cc,'-c','-o',os.path.join(root,'out.o'),source]",
   "args=[cc,'-imacros',header,*original[1:]]",
   'for mode in (0,1,2):',
   " kwargs={'stdout':subprocess.PIPE,'stderr':subprocess.PIPE} if mode==0 else {}",
   " sink=open(os.path.join(root,'diagnostics.log'),'wb') if mode==2 else None",
   " if sink is not None:kwargs['stderr']=sink",
   ' try:',
   "  r=m['run_compiler'](args,original,header,{**kwargs,'check':True})",
   "  raise AssertionError('real compiler must fail')",
   ' except subprocess.CalledProcessError as e:',
   '  if mode==0:',
   "   assert b'<command-line.h>' in e.stderr and os.fsencode(header) not in e.stderr,e.stderr",
   "  if sink is not None:sink.close()",
   "  if mode==2:",
   "   data=open(os.path.join(root,'diagnostics.log'),'rb').read()",
   "   assert b'<command-line.h>' in data and os.fsencode(header) not in data,data",
   "print('diagnostic capture/forwarding clean')",
  ].join('\n');
  const r=pythonPlan(script,[cc,dir],dir);
  expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);
  expect(r.stdout).toContain('diagnostic capture/forwarding clean');
  expect(r.stderr).toContain('<command-line.h>');expect(r.stderr).not.toContain('private-command-line.h');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('admits every kit example option inventory and a port-sized 4096-object compiler plan',()=>{
 const plans=readdirSync(join(ROOT,'examples')).filter(n=>{try{return !!JSON.parse(readFileSync(join(ROOT,'examples',n,'game.json'),'utf8'));}catch{return false;}}).map(n=>{
  const cfg=JSON.parse(readFileSync(join(ROOT,'examples',n,'game.json'),'utf8'));
  return ['zig','cc',...portableFlags([...CFLAGS,...(cfg.cflags??[]),...hermeticTimeFlags()],ROOT),...LDFLAGS,...(cfg.ldflags??[]),...(cfg.pipeline?.fixture?.libs??[]).map((l:string)=>'-l'+l),'-o','example.wasm','source.c'];
 });
 expect(plans).toHaveLength(38);
 // Enumerate pipeline-generated compile/probe variants and source fixture plans,
 // not just top-level game.json flags (which do not contain these options).
 for(const target of ['wasm32-wasi','wasm32-freestanding'])for(const mode of [0,1,2]){
  const flags=portableFlags([...CFLAGS.filter((f:string)=>!f.startsWith('--target=')),'--target='+target,
   '-DX86_COVERAGE_MODE='+mode,'-DX86_PROFILE_ENABLED=0','-DX86_FLAT_GUEST=1','-DX86_FLAT_BYTES=256ull*1048576ull','-DX86_HOST_ARENA_BYTES=64u*1048576u',
   '-D_GNU_SOURCE','-fno-math-errno','-Wno-unused-label','-Wno-unused-but-set-variable','-Wno-unused-variable',...hermeticTimeFlags()],ROOT);
  for(const tail of [['-c','-o','game.o'],['-E','-MD','-MF','probe.d','-MT','bgt','-o','/dev/null','-Wsystem-headers','-Werror=date-time'],['-M','-MT','bgt'],['-mexec-model=reactor',...LDFLAGS.filter((f:string)=>f!=='-nostdlib'),'-o','game.wasm']])plans.push(['zig','cc',...flags,'-I',ROOT+'/bgt/include','source.c',...tail]);
 }
 for(const n of readdirSync(join(ROOT,'examples'))){
  let fx;try{fx=JSON.parse(readFileSync(join(ROOT,'examples',n,'game.json'),'utf8')).pipeline?.fixture;}catch{continue;}
  if(!fx)continue;
  const target=fx.target??'x86-windows-gnu';
  plans.push(['zig',fx.cpp?'c++':'cc','-target',target,...(target==='x86-windows-gnu'?['-mcpu=i686']:['-funwind-tables','-fno-lto','-fno-emulated-tls']),
   fx.crt?'-O2':'-O1','-fno-stack-protector',...(fx.crt?['-s','-Wl,--gc-sections']:['-nostdlib','-Wl,--entry,'+(fx.entry??'entry')]),
   '-isystem','/sandbox/toolchain/include','-Wl,--subsystem,windows',...(target==='x86_64-windows-gnu'?['-Wl,--image-base,0x140000000']:[]),
   ...hermeticTimeFlags(),...((fx.libs??[]) as string[]).map(l=>'-l'+l),'-o','fixture.exe','source.c']);
 }
 plans.push(['gcc','-o','port.wasm',...padding(6000),...Array.from({length:4096},(_,i)=>'/sandbox/cache/objects/'+String(i).padStart(64,'0')+'.o')]);
 const script=[
  'import json,os,runpy,sys',
  'm=runpy.run_path(sys.argv[1])',
  'for args in json.load(sys.stdin):',
  " rest,macros=m['compiler_macro_transport'](args,2 if args[0]=='zig' else 1)",
  " m['validate_transport_options'](args)",
  " m['check_compiler_budget']([args[0],*rest],os.environ)",
  "print('kit and port plans accepted')",
 ].join('\n');
 const r=pythonPlan(script,plans,undefined,5000);
 expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('kit and port plans accepted');
});

it.skipIf(!gcc)('bounds real GCC cc1/as/collect2 argv AND COLLECT_GCC_OPTIONS with 6000 short definitions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-gcc-descendants-'));
 try{
  const source=join(dir,'main.c'),wrapper=join(dir,'wrapper'),report=join(dir,'children.jsonl');
  writeFileSync(source,'#if BGT_PADDING_5999 != 5999\n#error definitions were lost\n#endif\nint main(void){return 0;}\n');
  // Observe, enforce and EXECUTE real descendants; never replace compiler success.
  writeFileSync(wrapper,[
   '#!/usr/bin/env python3',
   'import json,os,sys',
   "args=sys.argv[1:];env=[k+'='+v for k,v in os.environ.items()]",
   'size=lambda a:len(os.fsencode(a))+1',
   "row={'tool':args[0],'max':max(map(size,args+env)),'total':sum(size(a)+8 for a in args+env),'collect':len(os.environ.get('COLLECT_GCC_OPTIONS',''))}",
   'with open('+JSON.stringify(report)+",'a') as f:f.write(json.dumps(row)+'\\n')",
   "if row['max']>131072 or row['total']>1048576:sys.exit(91)",
   'os.execvp(args[0],args)',
  ].join('\n')+'\n');
  chmodSync(wrapper,0o700);
  const r=transported([gcc,'-wrapper',wrapper,'-std=c11',...padding(6000),source,'-o',join(dir,'main')],dir);
  expect(r.error).toBeUndefined();expect(r.stderr).not.toContain('Argument list too long');expect(r.status,r.stderr).toBe(0);
  // Driver @files expand before cc1/environment construction too.
  const rsp=join(dir,'options.rsp');writeFileSync(rsp,padding(6000).join('\n'));
  const viaRsp=transported([gcc,'-wrapper',wrapper,'-std=c11','@'+rsp,source,'-o',join(dir,'main-rsp')],dir);
  expect(viaRsp.status,viaRsp.stderr).toBe(0);
  const rows=readFileSync(report,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  expect(rows.some(r=>r.tool.includes('cc1'))).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for(const row of rows){expect(row.max).toBeLessThanOrEqual(131072);expect(row.total).toBeLessThanOrEqual(1048576);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it.each(compilers)('preserves trailing backslash, newline truncation and -U/-D order in %s',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-macro-tokens-'));
 try{
  const source=join(dir,'tokens.c');writeFileSync(source,'FOO\nBAR\nORDER\n');
  writeFileSync(join(dir,'user.h'),'#if BAR != 7\n#error command line macros must precede -imacros\n#endif\n');
  const flags=['-imacros',join(dir,'user.h'),'-DFOO=hello'+String.fromCharCode(92),'-DBAR=7','-UORDER','-DORDER=23\nignored tail'];
  const direct=execFileSync(cc,['-E','-P',...flags,source],{encoding:'utf8'}).trim();
  const r=transported([cc,'-E','-P',...padding(14000),...flags,source],dir);
  expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);expect(r.stdout.trim()).toBe(direct);
  // A single huge definition with ignored newline tail must not reach cc1 or COLLECT_GCC_OPTIONS.
  const huge=transported([cc,'-E','-P','-DFOO=23\n'+'x'.repeat(140000),source],dir);
  expect(huge.status,huge.stderr).toBe(0);expect(huge.stdout.trim()).toBe('23\nBAR\nORDER');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it.each(compilers)('rejects untransportable oversized compiler options before %s can spawn a child',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-compiler-budget-'));
 try{
  const r=transported([cc,'-E','-x','c','/dev/null','-fdebug-prefix-map='+'x'.repeat(140000)+'=.'],dir);
  expect(r.error).toBeUndefined();expect(r.status).toBe(90);expect(r.stderr).toMatch(/compiler descendant.*budget.*no file transport/);
  const rsp=join(dir,'options.rsp');writeFileSync(rsp,'-fdebug-prefix-map='+'x'.repeat(140000)+'=.');
  const viaRsp=transported([cc,'-E','-x','c','/dev/null','@'+rsp],dir);
  expect(viaRsp.status,viaRsp.stderr).toBe(90);expect(viaRsp.stderr).toMatch(/compiler descendant.*budget.*no file transport/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it.each(compilers)('keeps 14000-definition transport headers out of %s dependency discovery and keys',cc=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-macro-cache-'));
 try{
  const source=[
   'import {prepareObjects} from '+JSON.stringify(new URL('../../tools/build/objects.mjs',import.meta.url).href)+';',
   'import {execFileSync} from '+JSON.stringify(new URL('../../tools/build/exec.mjs',import.meta.url).href)+';',
   "import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';",
   "const root=process.argv[1],cc=process.argv[2],file=join(root,'value.c'),header=join(root,'value.h');",
   'writeFileSync(file,'+JSON.stringify('#include "value.h"\nint value(void){return VALUE;}\n')+');writeFileSync(header,'+JSON.stringify('#define VALUE 23\n')+');',
   "const cfg={root,sources:[file],flags:Array.from({length:14000},(_,i)=>'-DBGT_PADDING_'+i+'='+i),includes:[],compiler:{path:cc,prefix:[],version:'real compiler'},cache:join(root,'objects')};",
   'const a=prepareObjects(cfg),b=prepareObjects(cfg);',
   "const compile=objects=>JSON.parse(execFileSync('python3',['-I',"+JSON.stringify(join(ROOT,'tools/build/compile.py'))+"],{cwd:root,input:JSON.stringify({objects,jobs:1}),encoding:'utf8'}));",
   'const first=compile(a),second=compile(b);writeFileSync(header,'+JSON.stringify('#define VALUE 24\n')+');const c=prepareObjects(cfg);',
   "console.log(JSON.stringify({first,second,keys:[a[0].out,b[0].out,c[0].out],manifests:readdirSync(join(root,'node_modules/.cache/bgt/dependencies')).filter(n=>n.endsWith('.json')).map(n=>readFileSync(join(root,'node_modules/.cache/bgt/dependencies',n),'utf8'))}));",
  ].join('\n');
  const r=spawnSync(process.execPath,['--input-type=module','-e',source,dir,cc],{encoding:'utf8',timeout:12000});
  expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);
  const d=JSON.parse(r.stdout);expect(d.first.objects_compiled).toBe(1);expect(d.second.objects_cached).toBe(1);
  expect(d.keys[0]).toBe(d.keys[1]);expect(d.keys[2]).not.toBe(d.keys[1]);
  expect(d.manifests.join('')).not.toMatch(/\/dev\/fd\/|bgt-macros-/);
  const deps=transported([cc,'-M','-MP','-MT','bgt',...padding(14000),join(dir,'value.c')],dir);
  expect(deps.error).toBeUndefined();expect(deps.status,deps.stderr).toBe(0);expect(deps.stdout).toContain('value.h');expect(deps.stdout).not.toContain('/dev/fd/');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
