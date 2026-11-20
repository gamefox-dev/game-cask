// Breakages caught: per-quantum clock inflation, worker feedback, frozen busy-wait
// clocks, wrong interval 0/2 cadence, slow-motion uncapped (interval 0) presents,
// cap starvation and nondeterministic boundaries.
// @bgt-examples: x64-time
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain ESM build tooling
import { buildGame } from '../../tools/build/build.mjs';
import { ROOT } from '../support/headless';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
// @ts-expect-error plain ESM build tooling
import { guestTimeModel } from '../../tools/build/pipeline.mjs';
import { testSuspensionModes } from '../support/suspension-modes';
const qpc=(line:string)=>Number(line.split('qpc=')[1].split(' ')[0]);
it('validates the deterministic cap before building', () => {
  expect(guestTimeModel()).toEqual({version:1,instructionCap:64000000,unitsPerUs:4000,frameUs:16667});
  for(const instructionCap of [2000000,64000001,256000000]) expect(guestTimeModel({instructionCap}).instructionCap).toBe(instructionCap);
  for(const instructionCap of [0,1999999,256000001,1.5,'64000000',NaN]) expect(()=>guestTimeModel({instructionCap})).toThrow(/instructionCap/);
});
it('configured low instruction cap reaches runtime and bounds a non-presenting update',async()=>{
  const root=join(ROOT,'node_modules/.cache/bgt/time-cap');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'case-'));
  try {
    const config=JSON.parse(readFileSync(join(ROOT,'examples/x64-time/game.json'),'utf8'));
    config.id='time-cap';config.pipeline.timeModel={instructionCap:2000000};
    copyFileSync(join(ROOT,'examples/x64-time/time.c'),join(dir,'time.c'));
    writeFileSync(join(dir,'game.json'),JSON.stringify(config));
    const out=join(dir,'out'),manifest=buildGame(dir,{outRoot:out,quiet:true});
    expect(manifest.pipeline.timeModel.instructionCap).toBe(2000000);
    for(const suspension of testSuspensionModes()) {
      const h=await loadHeadless('time-cap',{...glStream(),suspension,dir:join(out,'time-cap')});
      await h.stepAsync(1);
      const m=h.host.metrics() as any;
      expect(m.guest_time.instruction_cap).toBe(2000000);
      expect(m.guest_time.cap_hits).toBe('1');
      expect(m.execution_summary.guest_frames.count).toBe(0);
      expect(h.host.guestTimeUs()).toBe(16667);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
},120_000);
for(const suspension of testSuspensionModes()) it('guest-frame clock, WASAPI/Sleep workers, spin limiter and cap '+suspension, async () => {
  const runs: unknown[][]=[];
  for(let run=0;run<2;run++) {
    const h=await loadHeadless('x64-time',{...glStream(),suspension});
    const presents: {update:number;line:string;us:number;threads:any;accounting:any}[]=[];
    const uncapped: {update:number;qpc:number;us:number;caps:bigint;dropped:bigint}[]=[];
    const hashes: unknown[]=[];let seen=0,seenUncapped=0;
    for(let update=1;update<=200;update++) {
      await h.stepAsync(1);
      const m=h.host.metrics() as any;
      const lines=h.logs.filter(s=>s.includes('x64-time present=') || s.includes('x64-time interval='));
      for(;seen<lines.length;seen++) presents.push({update,line:lines[seen],us:h.host.guestTimeUs()!,
        threads:m.execution_accounting.threads,accounting:m.execution_accounting.frames});
      const free=h.logs.filter(s=>s.includes('x64-time uncapped='));
      for(;seenUncapped<free.length;seenUncapped++) uncapped.push({update,qpc:qpc(free[seenUncapped]),us:h.host.guestTimeUs()!,
        caps:BigInt(m.guest_time.cap_hits),dropped:BigInt(m.guest_time.dropped_presents)});
      hashes.push([h.host.stateHash(),h.host.guestTimeUs(),m.guest_time.cap_hits]);
      if(h.logs.some(s=>s.includes('x64-time PASS'))) break;
    }
    expect(h.logs.some(s=>s.includes('x64-time FAIL')),h.logs.join(' | ')).toBe(false);
    expect(h.logs.some(s=>s.includes('x64-time PASS')),h.logs.join(' | ')).toBe(true);
    expect(presents).toHaveLength(16);
    for(let i=1;i<10;i++) {
      expect(presents[i].update-presents[i-1].update).toBe(1);
      expect(presents[i].us-presents[i-1].us).toBe(16667);
      const count=(s:string)=>Number(s.split('wakes=')[1].split(' ')[0]);
      expect(count(presents[i].line)-count(presents[i-1].line)).toBeLessThanOrEqual(2);
    }
    for(let i=11;i<13;i++) expect(presents[i].us-presents[i-1].us).toBe(33334);
    // Coordinator ruling (K50 review): interval 0 no longer ends the host update per present.
    // The three tiny interval-0 presents share one update and advance guest time < 100 us each.
    for(let i=14;i<16;i++) {
      expect(presents[i].update).toBe(presents[13].update);
      expect(qpc(presents[i].line)-qpc(presents[i-1].line)).toBeLessThan(100);
    }
    // Uncapped ~1.1-ms frames: many presents per update, never a slow-motion update. Each full update
    // carries exactly one 16667-us period of guest time and ends at a present (no mid-frame cap hit).
    expect(uncapped).toHaveLength(48);
    const byUpdate=new Map<number,typeof uncapped>();
    for(const p of uncapped) byUpdate.set(p.update,[...(byUpdate.get(p.update)??[]),p]);
    const updates=[...byUpdate.keys()];
    expect(updates.length).toBeGreaterThanOrEqual(3);expect(updates.length).toBeLessThanOrEqual(5);
    for(let i=1;i<updates.length-1;i++) {
      expect(updates[i]-updates[i-1]).toBe(1);
      expect(byUpdate.get(updates[i])!.length).toBeGreaterThanOrEqual(12);
      expect(byUpdate.get(updates[i])![0].us-byUpdate.get(updates[i-1])![0].us).toBe(16667);
    }
    for(let i=1;i<uncapped.length;i++) {
      const dt=uncapped[i].qpc-uncapped[i-1].qpc;
      if(uncapped[i].update===uncapped[i-1].update) { expect(dt).toBeGreaterThan(900);expect(dt).toBeLessThan(1500); }
    }
    const lastFull=byUpdate.get(updates[updates.length-2])![0];
    expect(lastFull.caps).toBe(uncapped[0].caps);
    // Every present but the last of each full update is replaced before display.
    let replaced=0n;for(let i=1;i<updates.length-1;i++)replaced+=BigInt(byUpdate.get(updates[i])!.length-1);
    expect(lastFull.dropped-uncapped[0].dropped).toBe(replaced);
    const spinLine=h.logs.find(s=>s.includes('spin_us='))!;
    const spinUs=Number(spinLine.split('spin_us=')[1]);
    expect(spinUs).toBeGreaterThanOrEqual(1000);expect(spinUs).toBeLessThan(1010);
    const m=h.host.metrics() as any;
    expect(BigInt(m.guest_time.cap_hits)).toBeGreaterThan(0n);
    expect(m.interp_insns).toBe(0);expect(m.stubs).toEqual([]);
    const manifest=JSON.parse(readFileSync('web/public/games/x64-time/manifest.json','utf8'));
    expect(manifest.pipeline.timeModel).toEqual(guestTimeModel());
    if(process.env.K50_MEASURE && !run)writeFileSync(process.env.K50_MEASURE+'.'+suspension+'.json',JSON.stringify({presents,logs:h.logs,clock:m.guest_time},null,2));
    runs.push(hashes);
  }
  expect(runs[0]).toEqual(runs[1]);
},120_000);
