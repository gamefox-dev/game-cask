// @bgt-examples: none
// Original CC0 counter/ring fixtures. Updates must never be mislabeled guest frames.
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
import {readGuestPresentations,readInterpreterCoverage,interpreterSummary} from '../../bgt/runtime/execution-metrics';
it('reports guest presents independently of 600 updates and handles ring wrap and zero/one-frame windows',()=>{
 const memory=new ArrayBuffer(100000),v=new DataView(memory),ptr=8,times=64;
 v.setUint32(ptr+24,times,true);
 const read=(n:number)=>{v.setBigUint64(ptr,BigInt(n),true);v.setBigUint64(ptr+8,BigInt(n),true);v.setUint32(ptr+28,Math.min(n,10000),true);v.setUint32(ptr+32,n%10000,true);return readGuestPresentations(memory,ptr,2000)!;};
 expect(read(0)).toMatchObject({count:0,per_second:0,frame_ms_avg:null,frame_ms_p95:null});
 expect(read(1).frame_ms_avg).toBeNull();
 for(let i=0;i<19;i++)v.setFloat64(times+i*8,(100+i*50)*1000,true);
 expect(read(19)).toMatchObject({count:19,swaps:19,per_second:9.5,frame_ms_avg:50,frame_ms_p95:50,intervals_measured:18});
 for(let i=0;i<10003;i++)v.setFloat64(times+(i%10000)*8,i*1000,true);
 const ring=read(10003);expect(ring.timestamps_ms[0]).toBe(3);expect(ring.timestamps_ms.at(-1)).toBe(10002);expect(ring.frame_ms_avg).toBe(1);
 expect(readGuestPresentations(memory,0,2000)).toBeNull();
});
it('records exact persistent entries with profiling disabled, exposes overflow, and excludes nested work from timing',async()=>{
 for(const enabled of [0,1]){
  let now=0;
  const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/interpreter-observation.c',['X86_PROFILE_ENABLED='+enabled]),{bgt:{time_us:()=>++now,log:()=>{},abort:()=>{throw new Error('unexpected observation fault');}}});
  const ex=instance.exports as unknown as {memory:WebAssembly.Memory;record:(a:number)=>void;snapshot:()=>number;reset:()=>void;exclusive:()=>number;inclusive:()=>number};
  ex.record(0x1010);ex.record(0x1010);ex.reset();ex.record(0x1020);
  expect(readInterpreterCoverage(ex.memory.buffer,ex.snapshot())).toMatchObject({dropped:0,entries:[{address:0x1010,owner:0x1000,count:2,instructions:2},{address:0x1020,owner:0x1000,count:1,instructions:1}]});
  for(let i=0;i<20;i++)ex.record(0x1100+i);
  const coverage=readInterpreterCoverage(ex.memory.buffer,ex.snapshot())!;expect(coverage.dropped).toBeGreaterThan(0);expect(coverage.entries).toHaveLength(8);
  expect(ex.inclusive()).toBe(1001);expect(ex.exclusive()).toBe(2);
 }
});
it('keeps owner/interior entries and exact counts separate from resettable sampled census',()=>{
 const memory=new ArrayBuffer(256),v=new DataView(memory),ptr=8,rows=64;
 v.setUint32(ptr,rows,true);v.setUint32(ptr+4,2,true);v.setUint32(ptr+8,1048576,true);v.setBigUint64(ptr+16,3n,true);
 for(let i=0;i<2;i++){const p=rows+i*24;v.setUint32(p,0x1020-i*16,true);v.setUint32(p+4,0x1000,true);v.setBigUint64(p+8,BigInt(i+1),true);v.setBigUint64(p+16,BigInt(20+i),true);}
 const coverage=readInterpreterCoverage(memory,ptr)!;
 expect(coverage.entries.map(e=>e.address)).toEqual([0x1010,0x1020]);
 expect(interpreterSummary({interp_insns:41,interpreter_timing_enabled:1,interpreter_samples:10,interpreter_exclusive_estimated_us:5000},coverage,10,20)).toMatchObject({instructions_per_update:4.1,estimated_ms_per_update:.5,estimated_share:.25,coverage_dropped:3,top_owners:[{owner:0x1000,entries:3,instructions:41}]});
 expect(interpreterSummary({interp_insns:41},coverage,10,20).estimated_share).toBeNull();
 expect(interpreterSummary({},null,10,20)).toMatchObject({instructions:null,instructions_per_update:null,estimated_share:null,analyzed_code_interpreted:null,top_owners:null});
 expect(interpreterSummary({interp_insns:10},{capacity:1048576,dropped:0,entries:[]},10,20).analyzed_code_interpreted).toBeNull(); // strict builds omit recording
 expect(interpreterSummary({interp_insns:0},{capacity:1048576,dropped:0,entries:[]},10,20).analyzed_code_interpreted).toBe(false);
 v.setUint32(rows+4,0xffffffff,true);expect(readInterpreterCoverage(memory,ptr)!.entries[1].owner).toBeNull();
 v.setUint32(ptr+4,1048577,true);expect(readInterpreterCoverage(memory,ptr)).toBeNull();
});
