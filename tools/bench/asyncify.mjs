#!/usr/bin/env node
// Same linked input, same -O2; inspect native lifted bodies for Asyncify state references.
import {buildGame,WASM_OPT_FEATURES} from '../build/build.mjs';
import {ROOT} from '../build/toolchain.mjs';
import {functionNames} from '../build/wasm-names.mjs';
import {resourceSnapshot} from '../probe/resources.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import binaryen from 'binaryen';
const scratch=mkdtempSync(join(tmpdir(),'bgt-asyncify-bench-'));
const rows=[];
try {
 for(const id of process.argv.slice(3).length?process.argv.slice(3):['x64-crt','x64-cpp']) {
  const input=join(scratch,`${id}-linked.wasm`);
  buildGame(`examples/${id}`,{quiet:true,outRoot:scratch,onLinkedWasm:p=>copyFileSync(p,input)});
  const nativeNames=functionNames(readFileSync(input)).map(f=>f.name).filter(n=>/^N_[a-f0-9]{8}$/i.test(n));
  for(const mode of ['conservative','native-boundaries']) {
   const out=join(scratch,`${id}-${mode}.wasm`),resources={start:resourceSnapshot()};
   const start=performance.now();
   execFileSync(process.execPath,[join(ROOT,'node_modules/binaryen/bin/wasm-opt'),input,...WASM_OPT_FEATURES,
    '-O2','--asyncify','--pass-arg=asyncify-imports@bgt.yield','-g',
    ...(mode==='native-boundaries' && nativeNames.length?[`--pass-arg=asyncify-removelist@${nativeNames.join(',')}`]:[]),'-o',out],{stdio:['ignore','ignore','inherit']});
   const elapsedMs=performance.now()-start;resources.end=resourceSnapshot();
   const bytes=readFileSync(out),m=binaryen.readBinary(bytes);
   const stateExport=binaryen.getExportInfo(m.getExport('asyncify_get_state'));
   const stateFunction=binaryen.getFunctionInfo(m.getFunction(stateExport.value));
   const stateText=binaryen.emitText(stateFunction.body);
   const stateGlobal=/\(global.get \$([^\s)]+)/.exec(stateText)?.[1];
   if(!stateGlobal)throw new Error(`cannot identify Asyncify state: ${stateText}`);
   const native=[];
   for(let i=0;i<m.getNumFunctions();i++) {
    const f=binaryen.getFunctionInfo(m.getFunctionByIndex(i));
    if(!f.body || !/^[NR]_[a-f0-9]{8}/i.test(f.name))continue;
    const text=binaryen.emitText(f.body);
    native.push({name:f.name,asyncifyStateReferences:text.split(`(global.get $${stateGlobal})`).length-1});
   }
   const globals=[];for(let i=0;i<m.getNumGlobals();i++)globals.push(binaryen.getGlobalInfo(m.getGlobalByIndex(i)).name);
   m.dispose();
   if(!native.length)throw new Error('named Asyncify inspection failed');
   rows.push({id,mode,resources,elapsedMs,inputBytes:readFileSync(input).length,outputBytes:bytes.length,
    stateGlobal,nativeFunctions:native.length,nativeWithAsyncifyState:native.filter(n=>n.asyncifyStateReferences>0),globals});
   console.log(JSON.stringify(rows.at(-1)));
  }
 }
 writeFileSync(process.argv[2] ?? 'reports/asyncify.json',JSON.stringify({schema:'game-cask/asyncify-benchmark/1',node:process.version,
  method:'Uncached two wasm-opt invocations on exactly the same linked, DWARF-stripped named wasm; -O2 + Asyncify, output names retained for inspection. Times include parse/optimize/emit, not just instrumentation. No native removal of dispatcher or callback paths.',rows},null,2)+'\n');
} finally {rmSync(scratch,{recursive:true,force:true});}
