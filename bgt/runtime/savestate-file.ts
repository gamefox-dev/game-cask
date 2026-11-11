// Private test artifacts. v2 streams raw blobs; JSON is a size-capped debug aid only.
import type { Savestate } from './savestates';
import { encodeBytes, decodeBytes } from '../renderers/recording';
export const CHUNK_BYTES = 1024 * 1024;
const DEBUG_BYTES = 8 * CHUNK_BYTES, META_BYTES = 16 * CHUNK_BYTES;
const magic = new TextEncoder().encode('BGTSTATE');
export interface ExportOptions { compression?: 'deflate' }
export type SnapshotSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
type Tag = { $bgt:string; data?:unknown; id?:number; bytes?:number };
function special(v: unknown): unknown {
  if (typeof v === 'bigint') return {$bgt:'bigint',data:v.toString()};
  if (typeof v === 'number' && !Number.isFinite(v)) {
    const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,v,true);
    return {$bgt:'f64',data:encodeBytes(bytes)};
  }
  if (typeof v === 'number' && Object.is(v,-0)) return {$bgt:'negative-zero'};
  if (v instanceof Map) return {$bgt:'map',data:[...v]};
  if (v instanceof Set) return {$bgt:'set',data:[...v]};
  return v;
}
function revive(v: unknown): unknown {
  if (!v || typeof v !== 'object' || !('$bgt' in v)) return v;
  const t=v as Tag;
  switch(t.$bgt) {
    case 'f64': {const b=decodeBytes(t.data as string);if(b.length!==8)throw new Error('Invalid float bits');return new DataView(b.buffer).getFloat64(0,true);}
    case 'bigint':return BigInt(t.data as string);
    case 'negative-zero':return -0;
    case 'map':return new Map(t.data as [unknown,unknown][]);
    case 'set':return new Set(t.data as unknown[]);
    case 'u8':return decodeBytes(t.data as string);
    case 'u32':return new Uint32Array(t.data as number[]);
    default:throw new Error('Unsupported savestate value');
  }
}
export function exportSavestateDebugJson(state: Savestate): string {
  let estimated=0;
  const text=JSON.stringify(state,(_k,v:unknown)=>{
    // Check before expanding arrays/base64. Never attempt a game-scale debug stringify.
    estimated+=typeof v==='string'?v.length*2:16;
    if(v instanceof Uint8Array || v instanceof Uint32Array)estimated+=v.byteLength*8;
    if(estimated>DEBUG_BYTES)throw new Error('Savestate debug JSON exceeds 8 MiB; use streamed exportSnapshot');
    if(v instanceof Uint8Array)return {$bgt:'u8',data:encodeBytes(v)};
    if(v instanceof Uint32Array)return {$bgt:'u32',data:[...v]};
    return special(v);
  });
  if(text.length>DEBUG_BYTES)throw new Error('Savestate debug JSON exceeds 8 MiB; use streamed exportSnapshot');
  return text;
}
export function importSavestateDebugJson(file:string):Savestate {
  if(file.length>DEBUG_BYTES)throw new Error('Savestate debug JSON exceeds 8 MiB; use streamed importSnapshot');
  const state=JSON.parse(file,(_k,v:unknown)=>revive(v)) as Savestate;
  if(state.schema!=='bgt-savestate/1')throw new Error('Unsupported savestate file');return state;
}
function header(type:number,codec:number,id:number,offset:number,raw:number,stored:number):Uint8Array<ArrayBuffer> {
  const b=new Uint8Array(24),d=new DataView(b.buffer);
  [type,codec,id,offset,raw,stored].forEach((v,i)=>d.setUint32(i*4,v,true));return b;
}
async function transform(bytes:Uint8Array,compress:boolean):Promise<Uint8Array<ArrayBuffer>> {
  const stream=compress?new CompressionStream('deflate'):new DecompressionStream('deflate');
  const writer=stream.writable.getWriter();
  const write=writer.write(bytes as Uint8Array<ArrayBuffer>).then(()=>writer.close());
  const parts:Uint8Array[]=[],reader=stream.readable.getReader();let size=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;
    if(size>CHUNK_BYTES+65536)throw new Error('Invalid savestate compressed chunk size');parts.push(value);}
    await write;
  } catch(e){await reader.cancel(e);await write.catch(()=>{});throw e;}
  const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
/** No snapshot-sized stringify, base64, concatenation or Blob. Pull provides backpressure. */
export function exportSavestate(state:Savestate,options:ExportOptions={}):ReadableStream<Uint8Array> {
  async function* chunks() {
    const start=new Uint8Array(16);start.set(magic);new DataView(start.buffer).setUint32(8,2,true);yield start;
    let nextId=0;
    for(const [key,value] of Object.entries(state)) {
      const blobs:{id:number;view:Uint8Array}[]=[];
      const metadata=JSON.stringify([key,value],(_k,v:unknown)=>{
        if(v instanceof Uint8Array || v instanceof Uint32Array){
          const id=nextId++;blobs.push({id,view:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)});
          return {$bgt:v instanceof Uint8Array?'blob8':'blob32',id,bytes:v.byteLength};
        }return special(v);
      });
      if(metadata.length>META_BYTES)throw new Error('Savestate metadata section exceeds 16 MiB');
      const encoded=new TextEncoder().encode(metadata);
      if(encoded.length>META_BYTES)throw new Error('Savestate metadata section exceeds 16 MiB');
      // Metadata also travels in bounded records (type 1 continuation, type 2 final).
      for(let at=0;at<encoded.length;at+=CHUNK_BYTES){const part=encoded.subarray(at,at+CHUNK_BYTES);
        yield header(at+part.length===encoded.length?2:1,0,0,at,part.length,part.length);yield part;}
      for(const {id,view} of blobs)for(let at=0;at<view.length;at+=CHUNK_BYTES){
        let part=view.subarray(at,at+CHUNK_BYTES),codec=0;
        if(options.compression){const zipped=await transform(part,true);if(zipped.length<part.length){part=zipped;codec=1;}}
        yield header(3,codec,id,at,Math.min(CHUNK_BYTES,view.length-at),part.length);yield part;
      }
    }
    yield header(4,0,0,0,0,0);
  }
  const iterator=chunks();
  return new ReadableStream({async pull(controller){try{const p=await iterator.next();if(p.done)controller.close();else controller.enqueue(p.value);}catch(e){controller.error(e);}},
    async cancel(){await iterator.return();}});
}
async function* sourceChunks(source:SnapshotSource):AsyncGenerator<Uint8Array> {
  if('getReader' in source){const r=source.getReader();try{for(;;){const p=await r.read();if(p.done)return;yield p.value;}}finally{await r.cancel();r.releaseLock();}}
  else yield* source;
}
class Reader {
  private at=0;private current:Uint8Array=new Uint8Array();
  readonly iterator:AsyncGenerator<Uint8Array>;
  constructor(source:SnapshotSource){this.iterator=sourceChunks(source);}
  async read(n:number):Promise<Uint8Array<ArrayBuffer>> {
    let out:Uint8Array<ArrayBuffer>|undefined,at=0;
    while(at<n){if(this.at===this.current.length){const p=await this.iterator.next();if(p.done)throw new Error('Truncated savestate');this.current=p.value;this.at=0;if(!p.value.length)continue;}
      const count=Math.min(n-at,this.current.length-this.at),part=this.current.subarray(this.at,this.at+count);this.at+=count;
      if(at===0&&count===n)return part as Uint8Array<ArrayBuffer>;
      out??=new Uint8Array(n);out.set(part,at);at+=count;
    }return out??new Uint8Array();
  }
  async end(){if(this.at!==this.current.length || !(await this.iterator.next()).done)throw new Error('Trailing savestate bytes');}
}
export async function importSavestate(source:SnapshotSource):Promise<Savestate> {
  const r=new Reader(source),state:Record<string,unknown>={},blobs=new Map<number,{tag:Tag;data?:Uint8Array<ArrayBuffer>;at:number}>();
  let metadata:Uint8Array<ArrayBuffer>[]=[],metadataBytes=0,nextId=0;
  // References are replaced after their chunks arrive; bounded per-blob allocation, never a whole-file buffer.
  const resolve=(v:unknown):unknown=>{
    if(v&&typeof v==='object'){
      if('$bgt' in v){const t=v as Tag;if(t.$bgt==='blob8'||t.$bgt==='blob32'){
        const b=blobs.get(t.id!)!;if(b.at!==t.bytes)throw new Error('Missing savestate blob bytes');
        const data=b.data??new Uint8Array();return t.$bgt==='blob8'?data:new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
      }}
      if(v instanceof Map)return new Map([...v].map(([k,x])=>[resolve(k),resolve(x)]));
      if(v instanceof Set)return new Set([...v].map(resolve));
      if(Array.isArray(v))return v.map(resolve);
      for(const k of Object.keys(v))(v as Record<string,unknown>)[k]=resolve((v as Record<string,unknown>)[k]);
    }return v;
  };
  try {
    const start=await r.read(16),dv=new DataView(start.buffer,start.byteOffset,16);
    if(!magic.every((v,i)=>v===start[i])||dv.getUint32(8,true)!==2||dv.getUint32(12,true))throw new Error('Unsupported savestate binary version/header');
    for(;;){const h=await r.read(24),d=new DataView(h.buffer,h.byteOffset,24);
      const [type,codec,id,offset,raw,stored]=Array.from({length:6},(_,i)=>d.getUint32(i*4,true));
      if(type===4){if(codec||id||offset||raw||stored||metadataBytes)throw new Error('Invalid savestate end');break;}
      if(!raw||raw>CHUNK_BYTES||!stored||stored>CHUNK_BYTES||codec>1||type<1||type>3)throw new Error('Invalid savestate chunk');
      let body=await r.read(stored);if(codec)body=await transform(body,false);
      if(body.length!==raw)throw new Error('Invalid savestate decoded length');
      if(type<=2){
        if(codec||id||offset!==metadataBytes||metadataBytes+raw>META_BYTES)throw new Error('Invalid savestate metadata');
        metadata.push(body);metadataBytes+=raw;
        if(type===2){
          const bytes=metadata.length===1?metadata[0]:new Uint8Array(metadataBytes);if(metadata.length>1){let p=0;for(const b of metadata){bytes.set(b,p);p+=b.length;}}
          const pair=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),(_k,v:unknown)=>{
            if(v&&typeof v==='object'&&'$bgt' in v){const t=v as Tag;if(t.$bgt==='blob8'||t.$bgt==='blob32'){
              if(t.id!==nextId++||!Number.isSafeInteger(t.bytes)||t.bytes!<0||t.bytes!>0xffffffff||t.$bgt==='blob32'&&t.bytes!%4)throw new Error('Invalid savestate blob descriptor');
              blobs.set(t.id,{tag:t,at:0});return t;
            }}return revive(v);
          }) as [string,unknown];
          if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||Object.hasOwn(state,pair[0]))throw new Error('Invalid savestate section');
          Object.defineProperty(state,pair[0],{value:pair[1],enumerable:true,writable:true,configurable:true});metadata=[];metadataBytes=0;
        }
      }else{
        const b=blobs.get(id);if(!b||metadataBytes||offset!==b.at||offset+raw>b.tag.bytes!)throw new Error('Invalid savestate blob chunk');
        if(!b.data){
          // One-chunk blobs become views directly over transport chunks, including sparse pages.
          if(raw===b.tag.bytes && (b.tag.$bgt==='blob8'||body.byteOffset%4===0))b.data=body;
          else b.data=new Uint8Array(b.tag.bytes!);
        }
        if(b.data!==body)b.data.set(body,offset);b.at+=raw;
      }
    }
    await r.end();const result=resolve(state) as Savestate;
    if(result.schema!=='bgt-savestate/1')throw new Error('Unsupported savestate schema');return result;
  }finally{await r.iterator.return(undefined);}
}
