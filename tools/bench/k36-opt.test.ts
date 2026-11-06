// Original CC0-1.0. Opt-in compiler/postprocess experiment, not a performance gate.
import { it, expect } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadavg, freemem } from 'node:os';
import { loadHeadless, ROOT } from '../../tests/support/headless';
// @ts-expect-error plain ESM
import { execFileSync } from '../build/exec.mjs';
// @ts-expect-error plain ESM
import { WASM_OPT_FEATURES } from '../build/build.mjs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const median = (a: number[]) => { const b = [...a].sort((x,y)=>x-y); return b[Math.floor(b.length/2)]; };
const presets: Record<string,string[]> = {
  o2: ['-O2'], o3: ['-O3'], o4: ['-O4'],
  converge: ['-O3','--converge'], inline: ['-O3','--inlining-optimizing'],
  local: ['--optimize-instructions','--precompute','--simplify-locals','--merge-blocks','--vacuum'],
  o3local: ['-O3','--precompute','--simplify-locals','--merge-blocks'],
};
it('measures immutable linked-code postprocess variants with exact update traces', async () => {
  const out = process.env.BGT_K36_OUT!; mkdirSync(out,{recursive:true});
  const source = process.env.BGT_K36_SOURCE!;
  const id = JSON.parse(readFileSync(join(source,'manifest.json'),'utf8')).id;
  const modes = (process.env.BGT_K36_MODES ?? 'jspi').split(',') as ('asyncify'|'jspi')[];
  const names = (process.env.BGT_K36_PRESETS ?? Object.keys(presets).join(',')).split(',');
  const rows: unknown[] = [];
  async function snapshot(dir: string, mode: 'asyncify'|'jspi') {
    const h = await loadHeadless(id,{dir,suspension:mode}); const hashes = [];
    for(let i=0;i<300;i++){ await h.stepAsync(1); hashes.push(h.host.stateHash()); }
    const metrics = h.host.metrics() as {interp_insns:number;stubs:unknown[];execution_accounting:unknown};
    expect(metrics.interp_insns).toBe(0); expect(metrics.stubs).toEqual([]);
    return {hashes,accounting:metrics.execution_accounting};
  }
  for (const mode of modes) {
    const base = await snapshot(source,mode);
    for(const name of names) {
      const args = presets[name]; expect(args).toBeDefined();
      const dest = join(out,mode+'-'+name); mkdirSync(dest,{recursive:true});
      cpSync(source,dest,{recursive:true});
      const file = mode==='jspi'?'game.jspi.wasm':'game.wasm';
      const timeFile = join(out,mode+'-'+name+'.time');
      const start=performance.now(); let error: string|null = null;
      try { execFileSync('/usr/bin/time',['-l','-o',timeFile,process.execPath,join(ROOT,'tools/build/binaryen-runner.mjs'),join(source,file),...WASM_OPT_FEATURES,...args,'-o',join(dest,file)],{timeout:1200000,stdio:'inherit'}); }
      catch(e){error=String(e);}
      const buildMs=performance.now()-start;
      if(error){ rows.push({mode,name,args,buildMs,error}); writeFileSync(join(out,'results.json'),JSON.stringify(rows,null,2));continue; }
      const bytes=readFileSync(join(dest,file)); const manifest=JSON.parse(readFileSync(join(dest,'manifest.json'),'utf8'));
      const artifact={url:file+'?h='+sha(bytes).slice(0,16),size:bytes.length,sha256:sha(bytes)};
      if(mode==='jspi')manifest.variants.jspi=artifact;else manifest.wasm=artifact;
      writeFileSync(join(dest,'manifest.json'),JSON.stringify(manifest));
      const actual=await snapshot(dest,mode); expect(actual).toEqual(base);
      const samples: number[][]=[[],[]]; const resources=[];
      for(let pair=-1;pair<9;pair++){
        resources.push({pair,load:loadavg(),free:freemem()});
        for(const i of (pair&1?[1,0]:[0,1])){
          const h=await loadHeadless(id,{dir:i?dest:source,suspension:mode});
          await h.stepAsync(30); const t=performance.now();await h.stepAsync(300);const ms=performance.now()-t;
          if(pair>=0)samples[i].push(ms);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      const deltas=samples[1].map((x,i)=>x-samples[0][i]);
      const row={mode,name,args,buildMs,inputBytes:readFileSync(join(source,file)).length,outputBytes:bytes.length,sha256:sha(bytes),time:existsSync(timeFile)?readFileSync(timeFile,'utf8'):null,
        trace:sha(Buffer.from(JSON.stringify(base))),samples,medians:samples.map(median),delta:{median:median(deltas),min:Math.min(...deltas),max:Math.max(...deltas),values:deltas},resources};
      rows.push(row);writeFileSync(join(out,'results.json'),JSON.stringify(rows,null,2)); console.log(JSON.stringify({mode,name,buildMs,bytes:bytes.length,median:row.medians,delta:row.delta.median}));
    }
  }
});
