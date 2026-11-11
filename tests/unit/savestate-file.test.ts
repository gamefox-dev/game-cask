// CC0 synthetic state. Catch giant strings/copies, broken chunk boundaries and lossy transfer.
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdtemp,rm,stat,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {exportSavestate,importSavestate,exportSavestateDebugJson,importSavestateDebugJson,CHUNK_BYTES} from '../../bgt/runtime/savestate-file';
import type {Savestate} from '../../bgt/runtime/savestates';
import {snapshotChunks,fileChunks} from '../support/savestate-file';
function state(extra:object={}):Savestate{return {schema:'bgt-savestate/1',...extra} as Savestate;}
async function* fragmented(parts:Uint8Array[]){for(const p of parts)for(let at=0;at<p.length;at+=7)yield p.slice(at,at+7);}
it('binary transfer preserves nested tagged values, empty blobs and arbitrary transport splits',async()=>{
  const bytes=new Uint8Array(120003);for(let i=0;i<bytes.length;i++)bytes[i]=i*17;
  const s=state({extra:{nested:new Map([[17,new Set([bytes.subarray(3),new Uint8Array(),new Uint32Array([0xffffffff])])]]),values:[Infinity,-Infinity,NaN,-0,9907199254740993n]}});
  for(const compression of [undefined,'deflate'] as const){const chunks=await snapshotChunks(exportSavestate(s,{compression}));expect(Math.max(...chunks.map(c=>c.length))).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(await importSavestate(fragmented(chunks))).toEqual(s);}
  expect(importSavestateDebugJson(exportSavestateDebugJson(s))).toEqual(s);
  expect(()=>exportSavestateDebugJson(state({data:new Uint8Array(2*CHUNK_BYTES)}))).toThrow(/debug JSON.*streamed/);
});
it('binary transfer fails closed on versions, lengths, truncation, trailing data and missing blobs',async()=>{
  const chunks=await snapshotChunks(exportSavestate(state({data:new Uint8Array([1,2,3])})));
  const copy=()=>chunks.map(b=>b.slice());
  const version=copy();new DataView(version[0].buffer).setUint32(8,99,true);
  await expect(importSavestate(fileChunks(version))).rejects.toThrow(/version/);
  const length=copy();new DataView(length[1].buffer).setUint32(16,0xffffffff,true);
  await expect(importSavestate(fileChunks(length))).rejects.toThrow(/chunk/);
  await expect(importSavestate(fileChunks(chunks.slice(0,-1)))).rejects.toThrow(/Truncated/);
  await expect(importSavestate(fileChunks([...chunks,new Uint8Array([1])]))).rejects.toThrow(/Trailing/);
  const missing=copy();const i=missing.findIndex(b=>b.length===24&&new DataView(b.buffer).getUint32(0,true)===3);missing.splice(i,2);
  await expect(importSavestate(fileChunks(missing))).rejects.toThrow(/Missing/);
});
it('streams >1 GiB populated sparse pages plus 400 MiB raw GPU state through disk, byte-exact',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'bgt-state-scale-')),file=join(dir,'cc0.bgtstate');
  const pages=new Map<number,Uint8Array<ArrayBuffer>>();
  for(let i=0;i<16385;i++){const page=new Uint8Array(65536);for(let j=0;j<page.length;j++)page[j]=(i*31+j*17+(j>>>8))&255;pages.set(i*65536,page);}
  const gpu=Array.from({length:100},(_,i)=>{const b=new Uint8Array(4*CHUNK_BYTES);for(let j=0;j<b.length;j++)b[j]=(i+j*13+(j>>>12))&255;return b;});
  const original=state({host:{wasm:{memory:{byteLength:16385*65536,pages},globals:[-0,9007199254740993n],tables:[[0,null,17]]}},gpu});
  const hash=(s:Savestate)=>{const h=createHash('sha256');for(const [at,b] of s.host.wasm.memory.pages){h.update(String(at));h.update(b);}for(const b of (s as unknown as {gpu:Uint8Array[]}).gpu)h.update(b);return h.digest('hex');};
  const expected=hash(original),start=performance.now();
  try{
    const output=createWriteStream(file),reader=exportSavestate(original).getReader();let chunks=0;
    for(;;){const p=await reader.read();if(p.done)break;expect(p.value.length).toBeLessThanOrEqual(CHUNK_BYTES);chunks++;if(!output.write(p.value))await once(output,'drain');}
    output.end();await once(output,'finish');const exportMs=performance.now()-start;
    const bytes=(await stat(file)).size;expect(bytes).toBeGreaterThan(1024**3);
    const importing=performance.now(),imported=await importSavestate(createReadStream(file,{highWaterMark:CHUNK_BYTES}));
    const importMs=performance.now()-importing;expect(hash(imported)).toBe(expected);
    expect(imported.host.wasm.memory.pages.size).toBe(16385);expect(imported.host.wasm.globals).toEqual([-0,9007199254740993n]);
    const measurement={bytes,chunks,exportMs,importMs,sha256:expected};
    await mkdir('reports',{recursive:true});await writeFile('reports/k43-binary-scale.json',JSON.stringify(measurement,null,2));
    console.log('K43 binary scale',JSON.stringify(measurement));
  }finally{await rm(dir,{recursive:true,force:true});}
},180000);
