// Original CC0-1.0. JSPI compiler-source attribution of original executable operators.
import {readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {instrumentWat} from './k41-wasm-count.mjs';
const root=process.env.BGT_TRIAL_SCRATCH,revision=process.env.BGT_K41_REVISION??'base';
for(const kind of (process.argv[2]?[process.argv[2]]:['vm','flags','memory'])){
 const base=join(root,revision,kind),dir=join(root,'count-'+revision,kind);mkdirSync(dir,{recursive:true});
 execFileSync(process.execPath,['tools/bench/k41-attribution.mjs',base,join(root,'decode')],{stdio:'inherit'});
 const {wat,...metadata}=instrumentWat(readFileSync(join(base,'debug/attributed.wat'),'utf8'));
 writeFileSync(join(dir,'count.wat'),wat);writeFileSync(join(dir,'labels.json'),JSON.stringify(metadata));
 execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-as',join(dir,'count.wat'),'--enable-mutable-globals','--enable-nontrapping-float-to-int','--enable-bulk-memory','--enable-sign-ext','-o',join(dir,'count.wasm')]);
 cpSync(join(base,'game'),join(dir,'game'),{recursive:true});cpSync(join(dir,'count.wasm'),join(dir,'game/game.jspi.wasm'));
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');writeFileSync(join(dir,'counter-hashes.json'),JSON.stringify({wat:hash(join(dir,'count.wat')),wasm:hash(join(dir,'count.wasm'))}));
 rmSync(join(dir,'count.wat'));rmSync(join(dir,'count.wasm'));
}
