#!/usr/bin/env node
// CC0 generated source fixture, not a game. Reproducible scale measurement; no network/system installs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';
import { buildGame } from '../build/build.mjs';
const count = Number(process.argv[2] ?? 256);
if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('function count must be 1..10000');
const dir = join(ROOT,'node_modules/.cache/bgt/scale-fixture'); mkdirSync(dir,{recursive:true});
let c='/* Original CC0 generated scale fixture. */\n#include <windows.h>\nint _tls_index;\n';
for (let i=0;i<count;i++) {
  c+=`__declspec(noinline) unsigned f${i}(unsigned v) {\n`;
  for (let j=0;j<16;j++) c+=` v += ${13*(i+1)+j}u; v ^= ${0x735a9b + i*37+j}u;\n`;
  c+='return v; }\n';
}
c+=`unsigned (*const fns[])(unsigned)={${Array.from({length:count},(_,i)=>'f'+i).join(',')}};\n`;
c+='void entry(void){unsigned v=1; for(unsigned i=0;i<sizeof(fns)/sizeof(fns[0]);i++)v=fns[i](v); char s[80]; wsprintfA(s,"scale checksum %08x",v); OutputDebugStringA(s); for(;;)Sleep(5);}\n';
writeFileSync(join(dir,'scale.c'),c);
const config={id:'scale-fixture',name:'CC0 generated scale fixture',private:false,pipeline:{platform:'win32',fixture:{sources:['scale.c'],out:'scale.exe',entry:'entry',libs:['kernel32','user32']},modules:[{from:'./build/scale.exe',main:true}]}};
const build=(flagLiveness,interpretOnly=false)=>{
  config.pipeline.flagLiveness=flagLiveness;
  writeFileSync(join(dir,'game.json'),JSON.stringify(config));
  return buildGame(dir,{quiet:true,interpretOnly});
};
const before=build(false),after=build(true),warm=build(true),interp=build(true,true);
const insns=after.pipeline.metrics.lifted_insns;
const report={schema:'game-cask/scale/1',fixture:{functions:count,sourceBytes:Buffer.byteLength(c),instructions:insns},
  before:before.pipeline.metrics,after:after.pipeline.metrics,warm:warm.pipeline.metrics,interpretOnly:interp.pipeline.metrics,
  marginal_bytes_per_insn:{before:(before.wasm.size-interp.wasm.size)/insns,after:(after.wasm.size-interp.wasm.size)/insns},
  caveats:['peak RSS is the largest compiler/linker child, not aggregate parallel memory or wasm-opt','no x64 or multi-million-instruction execution tested','no lazy wasm chunks; all code in one module']};
mkdirSync(join(ROOT,'reports'),{recursive:true}); writeFileSync(join(ROOT,'reports/scale.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
