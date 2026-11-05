// @bgt-examples: none
// Original CC0-1.0. Hand-counted straight-line guest code calls real Win32 imports,
// blocks on Sleep/events, yields, returns a worker, and polls a real range ReadFile.
// C/native scaffolding must not retire; context restores must not lose process work.
import {it,expect} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../support/headless';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
function program(wide:boolean) {
 const text:string[]=['.text',...(!wide?['.def @feat.00; .scl 3; .type 0; .endef','.set @feat.00, 1']:[])],counts=[0,0];let owner=0;
 const ins=(s:string)=>{text.push('  '+s);counts[owner]++;};
 const label=(s:string)=>text.push(s+':');
 const address=(s:string)=>'&'+s;
 const call=(name:string,args:(number|string)[])=>{
  const arg=(v:number|string,reg:string)=>{
   if(typeof v==='number')ins('movl $'+v+', '+({ '%rcx':'%ecx','%rdx':'%edx','%r8':'%r8d','%r9':'%r9d','%rax':'%eax' } as Record<string,string>)[reg]);
   else if(v.startsWith('&'))ins('leaq '+v.slice(1)+'(%rip), '+reg);
   else ins('movq '+v+'(%rip), '+reg);
  };
  if(wide){
   const regs=['%rcx','%rdx','%r8','%r9'];
   for(let i=0;i<args.length;i++){
    if(i<4)arg(args[i],regs[i]);
    else if(typeof args[i]==='number')ins('movq $'+args[i]+', '+(32+8*(i-4))+'(%rsp)');
    else {arg(args[i],'%rax');ins('movq %rax, '+(32+8*(i-4))+'(%rsp)');}
   }
   ins('call *__imp_'+name+'(%rip)');
  }else{
   for(const a of [...args].reverse())ins('pushl '+(typeof a==='number'?'$'+a:a.startsWith('&')?'$'+a.slice(1):a));
   ins('call *"__imp__'+name+'@'+args.length*4+'"');
  }
 };
 const entry=wide?'entry':'_entry',worker=wide?'worker':'_worker';
 text.push('.globl '+entry);label(entry);if(wide)ins('subq $56, %rsp');
 call('CreateEventA',[0,1,0,0]);ins(wide?'movq %rax, event(%rip)':'movl %eax, event');
 call('CreateThread',[0,0,address(worker),0,0,0]);ins(wide?'movq %rax, thread(%rip)':'movl %eax, thread');
 call('CreateFileA',[address('filename'),0x80000000,1,0,3,0,0]);ins(wide?'movq %rax, file(%rip)':'movl %eax, file');
 call('ReadFile',['file',address('buffer'),4,address('got'),0]);
 call('CloseHandle',['file']);call('Sleep',[10]);call('SetEvent',['event']);call('SwitchToThread',[]);
 call('WaitForSingleObject',['thread',0xffffffff]);call('CloseHandle',['thread']);call('CloseHandle',['event']);call('ExitProcess',[0]);
 owner=1;text.push('.globl '+worker);label(worker);if(wide)ins('subq $56, %rsp');
 call('WaitForSingleObject',['event',0xffffffff]);call('Sleep',[5]);ins('movl $7, %eax');
 if(wide){ins('addq $56, %rsp');ins('ret');}else ins('ret $4');
 text.push('.data','.p2align 3','event: .quad 0','thread: .quad 0','file: .quad 0','got: .long 0','buffer: .long 0','filename: .asciz "known.bin"',wide?'.quad '+worker:'.long '+worker);
 // Explicit hand answers independent of assembler/disassembler/runtime counters.
 expect(counts).toEqual(wide?[46,9]:[45,7]);
 return {source:text.join('\n')+'\n',counts};
}
for(const wide of [false,true])it('guest-import exact multithread retirement, Sleep/event/yield and pending ReadFile '+(wide?'AMD64':'i386'),async()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/guest-accounting');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-')),id='guest-accounting-'+Number(wide),p=program(wide);
 try {
  writeFileSync(join(dir,'counts.S'),p.source);writeFileSync(join(dir,'anchor.c'),'/* CC0 */ int _tls_index;');
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 exact guest import accounting',
   cflags:['-DX86_ACCOUNTING_ENABLED=1','-DX86_PROFILE_ENABLED=1'],pipeline:{platform:'win32',streamModules:false,suspensionBuild:'dual',
    fixture:{out:'counts.exe',sources:['counts.S','anchor.c'],libs:['kernel32'],target:wide?'x86_64-windows-gnu':'x86-windows-gnu'},modules:[{from:'./build/counts.exe',main:true}]}}));
  for(const interpreted of [false,true]) {
   const out=join(dir,interpreted?'interpreted':'lifted'),manifest=buildGame(dir,{outRoot:out,interpretOnly:interpreted,quiet:true}),game=join(out,manifest.id);
   for(const mode of ['asyncify','jspi'] as const){
    const vfs=new Vfs();for(const a of manifest.assets)vfs.add(a.path,new Uint8Array(readFileSync(join(game,'assets',a.path))));vfs.addStream('known.bin',4);
    let us=0,release!:(b:Uint8Array<ArrayBuffer>)=>void;const logs:string[]=[],reads:unknown[]=[];
    const pending=new Promise<Uint8Array<ArrayBuffer>>(r=>{release=r;});
    const wasm=mode==='jspi'?manifest.variants.jspi.url:manifest.wasm.url;
    const host=await GameHost.create(readFileSync(join(game,wasm.split('?')[0])),{vfs,now:()=>us/1000,log:(_n,s)=>logs.push(s),
     rangeRead:(path,offset,length)=>{reads.push({path,offset,length});return pending;}},
     {backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});host.init();
    await host.update();await Promise.resolve();expect(host.ioPending).toBe(true);expect(host.suspended).toBe(true);
    const before=(host.metrics() as any).execution_accounting;
    expect(before.threads.map((t:any)=>t.state)).toEqual(['io','wait_objects']);
    us=1000;await host.update();const parked=(host.metrics() as any).execution_accounting;
    expect(parked.retired).toEqual(before.retired);expect(parked.threads[0].wall_us.running).toBe('0');
    expect(parked.threads[0].wall_us.io).toBe('1000');expect(parked.threads[1].wall_us.wait_objects).toBe('1000');
    release(new Uint8Array([1,2,3,4]));await host.settleRequests();
    for(let i=0;i<30&&!logs.some(s=>s.includes('ExitProcess'));i++){us+=100;await host.update();}
    expect(logs).toContain('win32 profile: ExitProcess');expect(reads).toEqual([{path:'known.bin',offset:0,length:4}]);
    const m=host.metrics() as any,a=m.execution_accounting;
    expect(a.retired.total).toBe(String(p.counts[0]+p.counts[1]));
    expect(a.threads.map((t:any)=>t.retired.total)).toEqual(p.counts.map(String));
    expect(a.threads.map((t:any)=>t.state)).toEqual(['exited','exited']);
    expect(a.threads.map((t:any)=>t.sleep_requested_ms)).toEqual(['10','5']);expect(a.threads[1].infinite_waits).toBe('1');
    expect(BigInt(a.threads[0].switches_in)>0n).toBe(true);expect(BigInt(a.threads[1].switches_in)>0n).toBe(true);
    expect(a.threads[0].wall_us.io).toBe('1100');expect(a.threads[1].wall_us.wait_objects).toBe('1100');
    expect(m.apis_hit).toEqual(expect.arrayContaining(['CreateThread','Sleep','WaitForSingleObject','SwitchToThread','ReadFile']));
    if(interpreted)expect(a.retired.interpreted).toBe(a.retired.total);else{expect(a.retired.interpreted).toBe('0');expect(m.interp_insns).toBe(0);}
    us+=1000000;host.profileReset();expect((host.metrics() as any).execution_accounting.threads).toEqual(a.threads);
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
