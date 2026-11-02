// Original CC0 buffered coverage regressions: collisions never discard entries, strict checks precede execution.
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';

it('buffers repeats/kind unions, flushes on pressure and preserves zero and collision addresses',async()=>{
  const events:[number,number][]=[];
  const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/coverage_buffer.c'),{bgt:{coverage_entry:(a:number,k:number)=>events.push([a,k])}});
  const ex=instance.exports as any;
  for(let i=0;i<100000;i++)ex.emit(0x1234,1);
  expect(events).toEqual([]);expect(ex.hits()).toBe(99999);
  ex.emit(0x1234,2);ex.emit(0,1);ex.flush();
  expect(events).toEqual([[0x1234,1],[0x1234,2],[0,1]]);
  ex.flush();expect(events).toHaveLength(3);
  const expected=new Map<number,number>(events.map(([a,k])=>[a,k]));
  expected.set(0x1234,3);
  // Exceed cache capacity: direct-map collisions and zero must still be reported accurately.
  for(let a=0;a<140000;a++){ex.emit(a,1);expected.set(a,(expected.get(a) ?? 0)|1);}
  ex.flush();
  const actual=new Map<number,number>();for(const [a,k] of events)actual.set(a,(actual.get(a) ?? 0)|k);
  expect(actual).toEqual(expected);expect(events.length).toBeGreaterThan(4096);
});
it('strict builds have no coverage import and enforce exact half-open membership locally',async()=>{
  const wasm=await compileC('tests/fixtures/c/coverage_buffer.c',['X86_COVERAGE_MODE=2','X86_FLAT_GUEST=1']);
  const module=await WebAssembly.compile(wasm);
  expect(WebAssembly.Module.imports(module).map(i=>i.name)).toEqual(['slice_missing']);
  const missing:number[]=[];
  const instance=await WebAssembly.instantiate(module,{bgt:{slice_missing:(_kind:number,a:number)=>{missing.push(a);throw new Error('slice stop');}}});
  const ex=instance.exports as any;ex.configure();
  for(const a of [100,109,200,209,500])ex.emit(a,2);
  for(const a of [0,99,110,199,210,501])expect(()=>ex.emit(a,2)).toThrow('slice stop');
  expect(missing).toEqual([0,99,110,199,210,501]);
  // Static lifted hooks are removed; dispatcher membership checking remains a separate responsibility.
  ex.lifted(999);expect(missing).toHaveLength(6);
  expect(ex.host_policy(1048577,0)).toBe(0);expect(ex.host_policy(256,0)).toBe(0); // allocation failure is truthful
  const ptr=ex.host_policy(1,0);expect(ptr).toBeGreaterThan(0);
  expect(ex.host_policy(0,0)).toBe(0); // one-shot
  const dv=new DataView(ex.memory.buffer),ep=dv.getUint32(ptr+12,true);dv.setUint32(ep,100,true);
  ex.emit(100,1);expect(()=>ex.emit(109,1)).toThrow('slice stop');
  // A wider host allowlist still cannot widen compiled membership.
  dv.setUint32(ep,999,true);expect(()=>ex.emit(999,1)).toThrow('slice stop');
});
