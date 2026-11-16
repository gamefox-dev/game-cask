// Breakages caught: per-quantum clock inflation, worker feedback, frozen busy-wait
// clocks, wrong interval 0/2 cadence, cap starvation and nondeterministic boundaries.
// @bgt-examples: x64-time
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadHeadless } from '../support/headless';
import { glStream } from '../support/x64-gl-stream';
// @ts-expect-error plain ESM build tooling
import { guestTimeModel } from '../../tools/build/pipeline.mjs';
import { testSuspensionModes } from '../support/suspension-modes';
it('validates the deterministic cap before building', () => {
  expect(guestTimeModel()).toEqual({version:1,instructionCap:64000000,unitsPerUs:4000,frameUs:16667});
  for(const instructionCap of [2000000,64000001,256000000]) expect(guestTimeModel({instructionCap}).instructionCap).toBe(instructionCap);
  for(const instructionCap of [0,1999999,256000001,1.5,'64000000',NaN]) expect(()=>guestTimeModel({instructionCap})).toThrow(/instructionCap/);
});
for(const suspension of testSuspensionModes()) it('guest-frame clock, WASAPI/Sleep workers, spin limiter and cap '+suspension, async () => {
  const runs: unknown[][]=[];
  for(let run=0;run<2;run++) {
    const h=await loadHeadless('x64-time',{...glStream(),suspension});
    const presents: {update:number;line:string;us:number;threads:any;accounting:any}[]=[];
    const hashes: unknown[]=[];let seen=0;
    for(let update=1;update<=100;update++) {
      await h.stepAsync(1);
      const m=h.host.metrics() as any;
      const lines=h.logs.filter(s=>s.includes('x64-time present=') || s.includes('x64-time interval='));
      for(;seen<lines.length;seen++) presents.push({update,line:lines[seen],us:h.host.guestTimeUs()!,
        threads:m.execution_accounting.threads,accounting:m.execution_accounting.frames});
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
    for(let i=14;i<16;i++) expect(presents[i].us-presents[i-1].us).toBeLessThan(100);
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
