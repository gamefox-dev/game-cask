// @bgt-examples: none
// Original CC0-1.0. Counts are not a substitute for exact CPU/trace comparisons.
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
import {instantiateFixture} from '../support/wasm-fixture';
it('exact known driver/admission/registry counts leave identical CPU state when compiled out',async()=>{
 const states=[];
 for(const enabled of [0,1]){
  const {exports}=await instantiateFixture(await compileC('tests/fixtures/c/dispatch_counters.c',['X86_NATIVE_STATS='+enabled]));
  const ex=exports as unknown as {memory:WebAssembly.Memory;counted():number;answer():number;dispatch_cpu():number;dispatch_cpu_size():number};
  expect(ex.counted()).toBe(0);expect(ex.answer()).toBe(7);
  states.push(new Uint8Array(ex.memory.buffer).slice(ex.dispatch_cpu(),ex.dispatch_cpu()+ex.dispatch_cpu_size()));
 }
 expect(states[0]).toEqual(states[1]);
});
it.each([0,1])('diagnostics retain exact u64 strings, bounded native-present ring and explicit OFF unavailability (%s)',async(enabled)=>{
 const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/dispatch_precision.c',['X86_NATIVE_STATS='+enabled,'X86_PROFILE_ENABLED=0'],false,['platforms/x86','platforms/win32']),{bgt:{time_us:()=>0}});
 const ex=instance.exports as unknown as {memory:WebAssembly.Memory;dispatch_precision():number};
 const bytes=new Uint8Array(ex.memory.buffer,ex.dispatch_precision());
 const m=JSON.parse(new TextDecoder().decode(bytes.subarray(0,bytes.indexOf(0)))).native_dispatch;
 expect(m.enabled).toBe(enabled);
 if(!enabled){expect(m).toEqual({enabled:0,counters:null,frames:null});return;}
 const huge=(1n<<53n)+1n;
 expect(m.counters.driver_steps).toBe(String(huge+65n));
 expect(m.counters.exits.quantum).toBe(String((1n<<64n)-1n));
 expect(m.frames.capacity).toBe(64);expect(m.frames.dropped).toBe('2');
 expect(m.frames.snapshots).toHaveLength(64);
 m.frames.snapshots.forEach((s:{present:string;counters:{driver_steps:string}},n:number)=>{
  expect(s.present).toBe(String(huge+BigInt(n)+2n));
  expect(s.counters.driver_steps).toBe(s.present);
 });
});
