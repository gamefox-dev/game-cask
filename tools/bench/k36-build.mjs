// Original CC0-1.0. Private measured copy; production build settings are untouched.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../build/toolchain.mjs';
export async function experimentalBuilder() {
  const dir=join(ROOT,'node_modules/.cache/bgt/k36');mkdirSync(dir,{recursive:true});
  let source=readFileSync(join(ROOT,'tools/build/build.mjs'),'utf8');
  const old='const objects = prepareObjects({ sources: allSources, flags: compileFlags, includes: includes.map((i) => join(ROOT, i)), compiler: zig, cache });';
  if(!source.includes(old))throw new Error('build implementation changed; audit experiment adapter');
  source = source.replace('export function buildGame(gameDirArg, options = {}) {',
    'const restored=[]; export function buildGame(gameDirArg, options={}){try{return buildGameOriginal(gameDirArg,options);}finally{for(const [p,b] of restored)writeFileSync(p,b);restored.length=0;}} function buildGameOriginal(gameDirArg, options = {}) {');
  source=source.replace(old, 
    "const lifted = s => /(?:lifted_[^/]+|chunks_[^/]+[/][^/]+)[.]c$/.test(s);" +
    "if(process.env.BGT_K36_NO_MINSIZE==='1')for(const p of allSources.filter(lifted)){const b=readFileSync(p);restored.push([p,b]);writeFileSync(p,b.toString().replaceAll('minsize,noinline','noinline'));}" +
    "const extra = JSON.parse(process.env.BGT_K36_CLANG_FLAGS ?? '[]');" +
    "const objects = [false,true].flatMap(isLifted => prepareObjects({ sources: allSources.filter(s => lifted(s)===isLifted), flags: [...compileFlags,...(isLifted?extra:[])], includes: includes.map(i=>join(ROOT,i)), compiler:zig, cache })).sort((a,b)=>allSources.indexOf(join(ROOT,a.source.slice(2)))-allSources.indexOf(join(ROOT,b.source.slice(2))));");
  source=source.replace(/from '(\.\/[^']+)'/g,(_m,p)=>'from '+JSON.stringify(pathToFileURL(join(ROOT,'tools/build',p)).href));
  const file=join(dir,'build-experiment.mjs'); writeFileSync(file,source);
  return import(pathToFileURL(file).href);
}
