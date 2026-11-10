// @bgt-examples: none
// Original CC0-1.0. Preserve event order/counts, not merely the final evidence union.
import {it,expect} from 'vitest';
import {compileC} from '../support/compile';
it('hot-hit outlining retains byte-exact pressure/collision/kind transport and all counters',async()=>{
 const actual:number[][]=[],expected:number[][]=[],keys=new Uint32Array(65536),kinds=new Uint8Array(65536);
 let pending:number[][]=[],events=0n,hits=0;
 const {instance}=await WebAssembly.instantiate(await compileC('tests/fixtures/c/coverage_buffer.c'),{bgt:{coverage_entry:(a:number,k:number)=>actual.push([a>>>0,k])}});
 const ex=instance.exports as unknown as {emit(a:number,k:number):void;flush():void;hits():number;events():bigint;crossings():bigint};
 const flush=()=>{expected.push(...pending);pending=[];ex.flush();};
 const emit=(address:number,kind:number)=>{
  ex.emit(address,kind);if(kind!==1&&kind!==2)return;events++;
  const h=Math.imul(address^(address>>>16),2654435761)>>>16;
  const old=keys[h]===address?kinds[h]:0,add=kind&~old;
  if(!add){hits++;return;}
  if(pending.length===4096){expected.push(...pending);pending=[];}
  keys[h]=address;kinds[h]=old|kind;pending.push([address,add]);
 };
 for(let i=0;i<10000;i++){emit(0,1);emit(0x1234,1);emit(0x1234,2);}
 let seed=123456789;
 for(let i=0;i<18000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;emit(seed,i%5);if(i%1001===0)flush();}
 // A long no-explicit-flush interval fills the queue and collides with old slots.
 for(let i=0;i<9000;i++)emit(i,1);
 flush();flush();
 expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
 expect(ex.events()).toBe(events);expect(ex.hits()).toBe(hits);expect(ex.crossings()).toBe(BigInt(expected.length));
});
