// Original CC0-1.0. Opt-in immutable compiler-artifact pairs, not a perf gate.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless } from '../../tests/support/headless';
it('compares compiler levels in both actual modes', async () => {
  const root = process.env.BGT_K36_MATRIX!;
  const variants = (process.env.BGT_K36_VARIANTS ?? 'o1,o3,i50,i500,speed2,speed3').split(',');
  const fixtures = [['vm','k34-workload','88bf80fb'],['flags','k35-flags','OK'],['memory','k35-memory','OK']];
  const median = (a: number[]) => [...a].sort((x,y)=>x-y)[4];
  const rows = [];
  for (const [kind,id,checksum] of fixtures) for (const variant of variants) {
    const paths = ['o2',variant].map(v=>join(root,v+'-'+kind,'game'));
    const artifacts = paths.map(p=>JSON.parse(readFileSync(join(p,'manifest.json'),'utf8')));
    for (const mode of ['asyncify','jspi'] as const) {
      const hashes = [];
      for (const dir of paths) {
        const h = await loadHeadless(id,{dir,suspension:mode});const frameHashes=[];
        for (let n=0;n<300;n++) {await h.stepAsync(1);frameHashes.push(h.host.stateHash());}
        hashes.push(frameHashes);expect(h.logs.some(x=>x.includes(checksum))).toBe(true);
        const m=h.host.metrics() as {interp_insns:number;stubs:unknown[]};
        expect(m.interp_insns).toBe(0);expect(m.stubs).toEqual([]);
      }
      expect(hashes[1]).toEqual(hashes[0]);
      const samples: number[][]=[[],[]];
      for (let pair=-1;pair<9;pair++) for (const i of pair&1?[1,0]:[0,1]) {
        const h=await loadHeadless(id,{dir:paths[i],suspension:mode});
        await h.stepAsync(30);const t=performance.now();await h.stepAsync(300);const ms=performance.now()-t;
        expect(h.logs.some(x=>x.includes(checksum))).toBe(true);
        if(pair>=0)samples[i].push(ms);await new Promise(resolve=>setTimeout(resolve,0));
      }
      const delta=samples[1].map((x,i)=>x-samples[0][i]);
      const row={kind,variant,mode,paths,artifacts,samples,baseMedian:median(samples[0]),candidateMedian:median(samples[1]),
        deltaMedian:median(delta),min:Math.min(...delta),max:Math.max(...delta)};
      rows.push(row);console.log(JSON.stringify({kind,variant,mode,base:row.baseMedian,candidate:row.candidateMedian,delta:row.deltaMedian}));
      writeFileSync(process.env.BGT_K36_REPORT!,JSON.stringify(rows,null,2));
    }
  }
});
