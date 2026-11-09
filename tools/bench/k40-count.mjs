// Original CC0-1.0. K39 operator counter applied to immutable exact K40 artifacts.
import {readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {instrumentWat} from './k40-wasm-count.mjs';
const root=process.env.BGT_TRIAL_SCRATCH;
for(const kind of ['calls','vm','memory']){
 const dir=join(root,'count',kind);mkdirSync(dir,{recursive:true});
 const input=join(root,'base',kind,'game','game.jspi.wasm');
 execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-dis',input,'-o',join(dir,'input.wat')]);
 const {wat,...metadata}=instrumentWat(readFileSync(join(dir,'input.wat'),'utf8'));
 writeFileSync(join(dir,'count.wat'),wat);writeFileSync(join(dir,'labels.json'),JSON.stringify(metadata));
 execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-as',join(dir,'count.wat'),'--enable-mutable-globals','--enable-nontrapping-float-to-int','--enable-bulk-memory','--enable-sign-ext','-o',join(dir,'count.wasm')]);
 cpSync(join(root,'base',kind,'game'),join(dir,'game'),{recursive:true});cpSync(join(dir,'count.wasm'),join(dir,'game','game.jspi.wasm'));
 rmSync(join(dir,'input.wat'));rmSync(join(dir,'count.wat'));rmSync(join(dir,'count.wasm'));
}
