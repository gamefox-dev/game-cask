// @bgt-examples: none
import {it,expect} from 'vitest';
import {instructionSummary} from '../../bgt/runtime/instruction-accounting';
const retired=(n:bigint)=>({total:String(n),lifted:String(n-2n),generic:'2',interpreted:'0'});
const row=(id:number,n:bigint,active:number)=>({id,start_address:0x1000+id,state:'running',retired:retired(n),wall_us:{running:active,sleep_timer:20,wait_objects:3,io:4,ready:5},virtual_ms:{sleep_timer:8,wait_objects:6},switches_in:2,parked_host_us:8,sleep_requested_ms:8,object_requested_ms:10,infinite_waits:1});
it('subtracts native-present snapshots before numeric conversion; never uses update/TSC boundaries',()=>{
 const huge=1n<<54n,first=row(1,huge,100),last=row(1,huge+30n,110),worker=row(2,12n,3);
 const a={enabled:1,timing_enabled:1,retired:retired(huge+42n),threads:[last,worker],frames:{capacity:64,dropped:7,snapshots:[
  {present:8,wall_us:1000,retired:retired(huge),threads:[first],lifted_calls:100,generic_insn_execs:20},
  {present:9,wall_us:1400,retired:retired(huge+42n),threads:[last,worker],lifted_calls:107,generic_insn_execs:21}]}};
 const s=instructionSummary({execution_accounting:a,guest_instruction_clock:-900});
 expect(s.instructions).toBeNull();expect(s.status).toBe('integer-range-exceeded');
 expect(s.instructions_per_guest_frame).toBe(42);expect(s.frames?.intervals_measured).toBe(1);
 expect(s.frames?.intervals[0]).toMatchObject({from_present:8,to_present:9,instructions:42,wall_us:400,active_wall_us:13,lifted_calls:7,generic_insn_execs:1,executing_instructions_per_second:42e6/13});
 expect(s.frames?.intervals[0].threads?.map(t=>t.instructions)).toEqual([30,12]);
 expect(s.cpu_time_us).toBeNull();expect(s.frames?.dropped).toBe(7);
});
it('disabled and legacy counters are unavailable, not guessed zero; a lone present is no whole interval',()=>{
 expect(instructionSummary({guest_instruction_clock:123,interp_insns:3}).status).toBe('unavailable');
 expect(instructionSummary({execution_accounting:{enabled:0,retired:retired(0n)}}).instructions).toBeNull();
 const s=instructionSummary({execution_accounting:{enabled:1,timing_enabled:0,retired:retired(12n),threads:[row(1,12n,3)],frames:null}});
 expect(s.instructions).toBe(12);expect(s.executing_instructions_per_second).toBeNull();expect(s.instructions_per_guest_frame).toBeNull();
});
it('never bridges a dropped/nonconsecutive interval or fabricates negative retirement',()=>{
 const s=instructionSummary({execution_accounting:{enabled:1,timing_enabled:1,retired:retired(4n),threads:[],frames:{capacity:64,dropped:1,snapshots:[
  {present:1,retired:retired(9n),threads:[]},{present:3,retired:retired(10n),threads:[]},{present:4,retired:retired(4n),threads:[]}]}}});
 expect(s.frames?.intervals).toHaveLength(1);expect(s.frames?.intervals[0].instructions).toBeNull();expect(s.instructions_per_guest_frame).toBeNull();
});
it('does not silently replace a missing thread timing budget with zero active time',()=>{
 const before=row(1,10n,100),after=row(1,20n,110),missing={...row(2,12n,3),wall_us:null};
 const s=instructionSummary({execution_accounting:{enabled:1,timing_enabled:1,retired:retired(32n),threads:[after,missing],
  frames:{capacity:64,dropped:0,snapshots:[{present:1,retired:retired(10n),threads:[before]},
   {present:2,retired:retired(32n),threads:[after,missing]}]}}});
 expect(s.instructions_per_guest_frame).toBe(22);expect(s.active_wall_us).toBeNull();
 expect(s.executing_instructions_per_second).toBeNull();expect(s.frames?.intervals[0].active_wall_us).toBeNull();
 expect(s.frames?.intervals[0].executing_instructions_per_second).toBeNull();
});

it('excludes work after the last native present from exact frame intervals',()=>{
 const first=row(1,10n,100),last=row(1,13n,110),tail=row(1,100n,120);
 const s=instructionSummary({execution_accounting:{enabled:1,timing_enabled:1,retired:tail.retired,threads:[tail],
  frames:{capacity:64,dropped:0,snapshots:[
   {present:1,wall_us:1000,retired:first.retired,threads:[first]},
   {present:2,wall_us:2000,retired:last.retired,threads:[last]}]}}});
 expect(s.instructions).toBe(100);expect(s.instructions_per_guest_frame).toBe(3);
 expect(s.frames?.intervals[0]).toMatchObject({instructions:3,active_wall_us:10,executing_instructions_per_second:300000});
});
