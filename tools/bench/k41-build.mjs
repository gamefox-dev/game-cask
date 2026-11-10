// Original CC0-1.0. Bench-only debug attribution; executable optimization flags unchanged.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../build/toolchain.mjs';
export async function attributedBuilder(){
 const dir=join(ROOT,'node_modules/.cache/bgt/k41');mkdirSync(dir,{recursive:true});
 let source=readFileSync(join(ROOT,'tools/build/build.mjs'),'utf8');
 const old='const objects = prepareObjects({ sources: allSources, flags: compileFlags, includes: includes.map((i) => join(ROOT, i)), compiler: zig, cache });';
 if(!source.includes(old))throw Error('audit changed build adapter');
 source=source.replace(old,
  "const lifted=s=>/(?:lifted_[^/]+|chunks_[^/]+[/][^/]+)[.]c$/.test(s);"+
  "const objects=[false,true].flatMap(l=>prepareObjects({sources:allSources.filter(s=>lifted(s)===l),flags:[...compileFlags,...(l?['-g','-gdwarf-4']:[])],includes:includes.map(i=>join(ROOT,i)),compiler:zig,cache})).sort((a,b)=>allSources.indexOf(join(ROOT,a.source.slice(2)))-allSources.indexOf(join(ROOT,b.source.slice(2))));");
 source=source.replace('if(pipe)writeFileSync(wasmPath,stripDwarf(readFileSync(wasmPath)));',
  "if(pipe){const dest=process.env.BGT_K41_DEBUG; if(dest){mkdirSync(dest,{recursive:true});cpSync(wasmPath,join(dest,'debug.wasm'));for(const s of sources.filter(s=>/lifted_.*[.]c$/.test(s)))cpSync(s,join(dest,'lifted.c'));}writeFileSync(wasmPath,stripDwarf(readFileSync(wasmPath)));}");
 source=source.replace(/from '([.][/][^']+)'/g,(_m,p)=>'from '+JSON.stringify(pathToFileURL(join(ROOT,'tools/build',p)).href));
 const file=join(dir,'build.mjs');writeFileSync(file,source);return import(pathToFileURL(file).href);
}
