// @bgt-examples: none
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
import {instructionSummary} from '../../bgt/runtime/instruction-accounting';
it('serializes all 4096 maximum-length printable import names without truncation and reports pathological overflow truthfully',async()=>{
 const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/metrics_capacity.c',[],false,['platforms/x86','platforms/win32']),{bgt:{time_us:()=>0}});
 const ex=instance.exports as unknown as {memory:WebAssembly.Memory;prepare:(mode:number)=>void;metrics:()=>number};
 const metrics=()=>{const ptr=ex.metrics(),bytes=new Uint8Array(ex.memory.buffer,ptr);const n=bytes.indexOf(0);
  expect(n).toBeGreaterThan(524288);return JSON.parse(new TextDecoder().decode(bytes.subarray(0,n)));};
 ex.prepare(0);const m=metrics();expect(m.imports_bound).toBe(4096);expect(m.apis_hit).toHaveLength(4096);
 expect(m.gl_objects).toEqual({});
 for(const key of ['reused','resized','grew','shrank'])expect(m['gl_buffer_respec_'+key]).toBe(0);
 expect(m.execution_accounting.enabled).toBe(0); // standalone header ships default OFF
 expect(instructionSummary(m).status).toBe('unavailable');
 expect(m.interpreter_exclusive_us).toBe(123);
 expect(m.interpreter_exclusive_sample_us).toBe(25);
 expect(m.interpreter_exclusive_estimated_us).toBe(0); // no sampled dispatches in this serializer-only fixture
 expect(m.cpu_profile.apis).toHaveLength(4096);expect(m.cpu_profile.apis[4095]).toMatchObject({count:4096,samples:1,estimated_us:4100*4096});
 ex.prepare(2);const escaped=metrics();expect(escaped.cpu_profile.apis).toHaveLength(4096);
 expect(escaped.cpu_profile.apis[0].name.slice(3,7)).toBe('"\\"\\');
 expect(escaped.cpu_profile.apis[0].dll.slice(3,7)).toBe('\\"\\"');
 ex.prepare(1);const ptr=ex.metrics(),bytes=new Uint8Array(ex.memory.buffer,ptr),n=bytes.indexOf(0);
 const overflow=JSON.parse(new TextDecoder().decode(bytes.subarray(0,n)));
 expect(overflow).toMatchObject({imports_bound:4096,metrics_serialization_overflow:1,cpu_profile:null});
});
it('compiled-out accounting serializes unavailable, while profiling-off retains retirement without timing clocks',async()=>{
 for(const enabled of [0,1]) {
  let clocks=0;
  const raw=await compileC('tests/fixtures/c/metrics_capacity.c',['X86_ACCOUNTING_ENABLED='+enabled,'X86_PROFILE_ENABLED=0'],false,['platforms/x86','platforms/win32']);
  const {instance}=await WebAssembly.instantiate(raw,{bgt:{time_us:()=>{clocks++;return 0;}}});
  const ex=instance.exports as unknown as {memory:WebAssembly.Memory;metrics():number};
  const bytes=new Uint8Array(ex.memory.buffer,ex.metrics()),m=JSON.parse(new TextDecoder().decode(bytes.subarray(0,bytes.indexOf(0))));
  expect(m.execution_accounting).toMatchObject({enabled,timing_enabled:0,cpu_time_us:null,frames:null});
  expect(clocks).toBe(0);
  const s=instructionSummary(m);
  if(enabled){expect(s.instructions).toBe(0);expect(s.timing).toBe('unavailable');expect(m.execution_accounting.retired.total).toBe('0');}
  else {expect(s.status).toBe('unavailable');expect(s.instructions).toBeNull();expect(m.execution_accounting.retired).toBeNull();expect(m.execution_accounting.threads).toBeNull();}
 }
});
