// @bgt-examples: win32-conformance
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,openSync,closeSync,ftruncateSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {RangeFiles,type StreamedFile} from '../../bgt/runtime/range-files';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
import {ROOT,loadHeadless} from '../support/headless';
// @ts-expect-error plain ESM
import {compactPe} from '../../tools/build/files.mjs';
// @ts-expect-error plain ESM
import {peMetadata} from '../../tools/inspect/pe.mjs';

it('range reads fetch only overlapping verified chunks, reuse/cache/evict, and do not preload',async()=>{
 const calls:string[]=[],size=4096,data=Array.from({length:3},(_,i)=>new Uint8Array(size).fill(i+1));
 const chunks=data.map((b,i)=>({offset:i*size,size,url:`chunk-${i}`,sha256:createHash('sha256').update(b).digest('hex')}));
 const file:StreamedFile={path:'data.dat',size:3*size,chunkSize:size,chunks};
 const store=new RangeFiles('',async(url)=>{calls.push(String(url));return new Response(data[Number(String(url).slice(-1))]);},size*2);
 store.add(file);expect(calls).toEqual([]);
 expect([...await store.read('data.dat',size-2,4)]).toEqual([1,1,2,2]);expect(calls).toEqual(['chunk-0','chunk-1']);
 await store.read('data.dat',size,3);expect(calls.length).toBe(2);
 await store.read('data.dat',size*2,1);expect(store.cacheBytes).toBe(size*2);
 await store.read('data.dat',0,1);expect(calls.length).toBe(4);
 expect((await store.read('data.dat',size*3,10)).length).toBe(0);
 const bad=new RangeFiles('',async()=>new Response(new Uint8Array(size).fill(99)));bad.add(file);
 await expect(bad.read('data.dat',0,1)).rejects.toThrow(/integrity/);
 const oversized=new RangeFiles('',async()=>new Response(new Uint8Array(size+1)));oversized.add(file);
 await expect(oversized.read('data.dat',0,1)).rejects.toThrow(/oversized/);
 expect(store.coverage()).toHaveLength(3);
});

it('compact loader PE omits huge raw overlays, preserving headers/imports/virtual section bytes',()=>{
 const src=join(ROOT,'node_modules/.cache/bgt/pipeline/win32-conformance/fixture/conformance.exe');
 const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/compact-')),file=join(dir,'source.exe'),out=join(dir,'loader.exe');
 const bytes=readFileSync(src);writeFileSync(file,bytes);
 const fd=openSync(file,'r+');ftruncateSync(fd,65*1024*1024);closeSync(fd);
 const stats=compactPe(file,out);expect(stats.sourceBytes).toBe(65*1024*1024);expect(stats.loaderBytes).toBeLessThan(bytes.length);
 const b=readFileSync(out),meta=peMetadata((o:number,n:number)=>b.subarray(o,o+n),b.length);
 expect(meta.importErrors).toEqual([]);expect(meta.imports).toContain('KERNEL32.dll');
});

it('streamed ReadFile stays differential-oracle identical with asynchronous requests',async()=>{
 buildGame('examples/win32-conformance',{interpretOnly:true,quiet:true});
 const r=await oracle('win32-conformance',70,[{frame:20,key:['KeyF',true]},{frame:21,key:['KeyF',false]}]);
 expect(r.identical).toBe(true);expect(r.errors).toEqual({lifted:null,interpreted:null});
},120_000);

it('headless streamed Win32 file contract uses asynchronous frame settling',async()=>{
 const h=await loadHeadless('win32-conformance');h.step(20);h.key('KeyF',true);await h.stepAsync(1);h.key('KeyF',false);
 for(let i=0;i<40 && !h.logs.some((s)=>s.includes('files checks='));i++)await h.stepAsync(1);
 expect(h.logs.find((s)=>s.includes('files checks='))).toContain('0000007f');
});
