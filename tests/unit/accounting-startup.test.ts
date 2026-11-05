// @bgt-examples: none
// Original CC0-1.0: imports throwing from process TLS/DllMain must close the
// scheduler span before the main entry, in either width/dispatch/suspension.
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../support/headless';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
for(const wide of [false,true])for(const startup of ['tls','dll'])it('startup '+startup+' host exception freezes accounting '+(wide?'AMD64':'i386'),async()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/accounting-startup');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-')),target=wide?'x86_64-windows-gnu':'x86-windows-gnu';
 try {
  const callbacks=startup==='tls'?
   'char tls_raw[1]; void NTAPI callback(PVOID m,DWORD r,PVOID p){(void)m;(void)r;(void)p;OutputDebugStringA("startup-fault");}\n'+
   'PIMAGE_TLS_CALLBACK tls_callbacks[]={callback,0};\n'+
   'const IMAGE_TLS_DIRECTORY _tls_used __attribute__((used))={(ULONG_PTR)tls_raw,(ULONG_PTR)(tls_raw+1),(ULONG_PTR)&_tls_index,(ULONG_PTR)tls_callbacks,0,0};\n':'';
  writeFileSync(join(dir,'entry.c'),'/* CC0 */\n#include <windows.h>\nint _tls_index;\n'+callbacks+
   'void entry(void){OutputDebugStringA("entry-unreached");for(;;)Sleep(10);}\n');
  if(startup==='dll') {
   writeFileSync(join(dir,'startup.c'),'/* CC0 */\n#include <windows.h>\nBOOL WINAPI DllMain(HINSTANCE m,DWORD r,LPVOID p){(void)m;(void)r;(void)p;OutputDebugStringA("startup-fault");return TRUE;}\n');
   const zig=JSON.parse(execFileSync('zig',['env'],{encoding:'utf8'}));
   execFileSync('zig',['cc','-target',target,'-isystem',join(zig.lib_dir,'libc/include/any-windows-any'),'-O1','-fno-stack-protector','-shared','-nostdlib','-Wl,--entry,DllMain','-o',join(dir,'startup.dll'),join(dir,'startup.c'),'-lkernel32'],{stdio:'pipe'});
  }
  const id='accounting-startup-'+Number(wide)+'-'+startup;
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 startup accounting abort',
   cflags:['-DX86_ACCOUNTING_ENABLED=1','-DX86_PROFILE_ENABLED=1'],pipeline:{platform:'win32',suspensionBuild:'dual',streamModules:false,
    fixture:{out:'entry.exe',sources:['entry.c'],libs:['kernel32'],target},
    modules:[{from:'./build/entry.exe',main:true},...(startup==='dll'?[{from:'./startup.dll',name:'startup.dll'}]:[])]}}));
  for(const interpreted of [false,true]) {
   const out=join(dir,interpreted?'interp':'lift'),manifest=buildGame(dir,{outRoot:out,quiet:true,interpretOnly:interpreted}),game=join(out,manifest.id);
   for(const mode of ['asyncify','jspi'] as const) {
    const vfs=new Vfs();for(const a of manifest.assets)vfs.add(a.path,new Uint8Array(readFileSync(join(game,'assets',a.path))));
    let us=0,reached=0;const original=new Error('startup import exception'),logs:string[]=[];
    const wasm=mode==='jspi'?manifest.variants.jspi.url:manifest.wasm.url;
    const host=await GameHost.create(readFileSync(join(game,wasm.split('?')[0])),{vfs,now:()=>us/1000,log:(_n,s)=>{
     logs.push(s);if(s==='guest: startup-fault'){reached++;us=10;throw original;}
    }},{backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0,suspensionMode:mode});
    host.init();const error=await Promise.resolve().then(()=>host.update()).then(()=>null,e=>e);
    expect(reached).toBe(1);expect(error).toBe(original);expect(logs).not.toContain('guest: entry-unreached');
    const first=(host.metrics() as any).execution_accounting;
    expect(first.threads).toHaveLength(1);expect(first.threads[0].id).toBe(1);expect(first.threads[0].start_address).toBeGreaterThan(0);
    expect(BigInt(first.threads[0].wall_us.running)).toBe(10n);
    us+=1000000;host.profileReset();const last=(host.metrics() as any).execution_accounting;
    expect(last.retired).toEqual(first.retired);expect(last.threads[0].wall_us.running).toBe(first.threads[0].wall_us.running);
    expect(last.threads[0].state).toBe('ready');expect(last.frames).toEqual(first.frames);
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
