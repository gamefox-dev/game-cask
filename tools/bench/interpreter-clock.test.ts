// @bgt-examples: none
// Original CC0 measurement; never a speed threshold or a suite timing assertion.
import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {compileC} from '../../tests/support/compile';
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
it('measures imported monotonic clock and coarse transition cost',async()=>{
 const n=1000000,rows=[];
 for(const enabled of [0,1]){
  const bytes=await compileC('tests/fixtures/c/interpreter-spans.c',['X86_PROFILE_ENABLED='+enabled]);
  for(const clock of ['constant','monotonic']){
   let clocks=0;
   const {instance}=await WebAssembly.instantiate(bytes,{bgt:{time_us:()=>{clocks++;return clock==='constant'?0:performance.now()*1000;},log:()=>{},yield:()=>{}}});
   const e=instance.exports as unknown as {timer(n:number):number;no_timer(n:number):number;transitions(n:number):void};
   for(const op of ['timer','no_timer','transitions'] as const){
    const samples=[];e[op](100000);clocks=0;
    for(let i=0;i<9;i++){const t=performance.now();e[op](n);samples.push(performance.now()-t);}
    const count=clocks;expect(count).toBe(op==='timer'?n*9:op==='transitions'&&enabled?n*18:0);
    rows.push({enabled,clock,op,iterations:n,samplesMs:samples,medianMs:median(samples),clockCalls:count});
   }
  }
 }
 const file=join(process.env.BGT_TRIAL_SCRATCH!,'continue/clock.json');writeFileSync(file,JSON.stringify({node:process.version,rows},null,2)+String.fromCharCode(10));
 console.log(JSON.stringify(rows.map(({enabled,clock,op,medianMs})=>({enabled,clock,op,nsPerIteration:medianMs*1e6/n}))));
},600000);
