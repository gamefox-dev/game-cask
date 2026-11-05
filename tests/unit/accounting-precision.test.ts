// @bgt-examples: none
// Original CC0-1.0. Exact u64 scheduler serialization and BigInt-before-Number
// frame deltas; precision must not depend on the lifetime of a guest process.
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
import {instructionSummary} from '../../bgt/runtime/instruction-accounting';
it('serializes scheduler u64 counters and every native-present snapshot without JSON rounding',async()=>{
 const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/accounting-precision.c',['X86_ACCOUNTING_ENABLED=1','X86_PROFILE_ENABLED=1'],false,['platforms/x86','platforms/win32']),{bgt:{time_us:()=>0}});
 const ex=instance.exports as unknown as {memory:WebAssembly.Memory;precision():number};
 const bytes=new Uint8Array(ex.memory.buffer,ex.precision()),m=JSON.parse(new TextDecoder().decode(bytes.subarray(0,bytes.indexOf(0))));
 const a=m.execution_accounting,row=a.threads[0],first=a.frames.snapshots[0],last=a.frames.snapshots[1];
 const huge=(1n<<53n)+1n,maximum=(1n<<64n)-1n;
 expect(row).toMatchObject({switches_in:String(maximum),sleep_requested_ms:String(maximum),object_requested_ms:String(maximum),infinite_waits:String(maximum)});
 expect(row.virtual_ms.sleep_timer).toBe(String(maximum));expect(a.frames.dropped).toBe(String(maximum));
 expect(row.wall_us.running).toBe('110');expect(row.parked_host_us).toBe('0');expect(first.wall_us).toBe('1000');
 expect(first).toMatchObject({present:String(huge),lifted_calls:String(huge),generic_insn_execs:String(huge)});
 expect(last).toMatchObject({present:String(huge+1n),lifted_calls:String(huge+7n),generic_insn_execs:String(huge+1n)});
 expect(first.threads[0].switches_in).toBe(String(huge));expect(last.threads[0].switches_in).toBe(String(huge+3n));
 const s=instructionSummary(m),delta=s.frames?.intervals[0];
 expect(s.threads?.[0].switches_in).toBeNull();expect(s.threads?.[0].sleep_requested_ms).toBeNull();
 expect(delta).toMatchObject({instructions:42,wall_us:400,active_wall_us:10,lifted_calls:7,generic_insn_execs:1});
 expect(delta?.threads?.[0]).toMatchObject({switches_in:3,sleep_requested_ms:5,object_requested_ms:7,infinite_waits:1,virtual_ms:{sleep_timer:2}});
 expect(s.instructions_per_guest_frame).toBe(42);expect(s.frames?.dropped).toBe(String(maximum));
});
it('unsafe legacy numeric scheduler inputs are unavailable, never rounded counts',()=>{
 const r={total:'1',lifted:'1',generic:'0',interpreted:'0'};
 const s=instructionSummary({execution_accounting:{enabled:1,timing_enabled:1,retired:r,threads:[{id:1,retired:r,switches_in:2**54+1,wall_us:{running:2**54+1}}],frames:null}});
 expect(s.threads?.[0].switches_in).toBeNull();expect(s.active_wall_us).toBeNull();expect(s.executing_instructions_per_second).toBeNull();
});
