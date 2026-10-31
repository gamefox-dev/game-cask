#!/usr/bin/env node
// Original, bounded build measurement. Usage: node tools/build/measure.mjs GAME [REPORT.json]
// Samples kit + configured Zig cache disk, retaining no copies of generated sources/objects.
import { spawn } from 'node:child_process';
import { setInterval, clearInterval } from 'node:timers';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './toolchain.mjs';

function bytes(path) {
  try {
    const s=statSync(path);
    return s.isDirectory() ? readdirSync(path).reduce((n,f)=>n+bytes(join(path,f)),0) : s.size;
  } catch(e) {if(e.code==='ENOENT')return 0;throw e;}
}
const game=process.argv[2];if(!game)throw new Error('usage: measure.mjs GAME [REPORT.json]');
const paths=[join(ROOT,'node_modules/.cache/bgt'),join(ROOT,'web/public/games'),
  ...new Set([process.env.ZIG_GLOBAL_CACHE_DIR,process.env.ZIG_LOCAL_CACHE_DIR].filter(Boolean))]
  .map((p)=>resolve(p)).filter((p,i,a)=>!a.some((other,j)=>i!==j && p.startsWith(other+'/')));
const initial=paths.reduce((n,p)=>n+bytes(p),0);let peak=initial,samples=0;
const sample=()=>{peak=Math.max(peak,paths.reduce((n,p)=>n+bytes(p),0));samples++;};
const timer=setInterval(sample,250),start=performance.now();
const child=spawn(process.execPath,[join(ROOT,'tools/build/build.mjs'),game],{stdio:'inherit'});
child.on('error',(e)=>{clearInterval(timer);throw e;});
child.on('exit',(code,signal)=>{
  clearInterval(timer);sample();
  const cfg=JSON.parse(readFileSync(join(ROOT,game,'game.json'),'utf8'));
  const path=join(ROOT,'web/public/games',cfg.id,'manifest.json');
  const report={wall_ms:performance.now()-start,exit:code,signal,disk:{initial_bytes:initial,peak_bytes:peak,
    peak_growth_bytes:peak-initial,final_bytes:paths.reduce((n,p)=>n+bytes(p),0),sample_ms:250,samples,paths,
    scope:'logical file bytes in kit build/output + explicitly configured Zig caches; includes unrelated retained fixtures, not filesystem allocation/RSS; sub-250ms temporaries may be missed'},
    manifest:code===0&&existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null};
  writeFileSync(resolve(process.argv[3] ?? 'reports/build-scale.json'),JSON.stringify(report,null,2)+'\n');
  process.exitCode=code ?? 1;
});
