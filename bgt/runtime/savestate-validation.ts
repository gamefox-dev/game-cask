// Test-only structural validation. Run before allocating/replaying a replacement or touching live state.
import type {Savestate} from './savestates';
function requireState(ok:unknown):asserts ok {if(!ok)throw new Error('Invalid savestate structure');}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
function fields(value:unknown,types:Record<string,(v:unknown)=>boolean>) {
 requireState(object(value));
 // Reject unknown keys too: commit uses plain own-data assignments, never caller-controlled setters.
 requireState(Object.keys(value).length===Object.keys(types).length);
 for(const [key,test] of Object.entries(types))requireState(Object.hasOwn(value,key)&&test(value[key]));
}
const map=(v:unknown)=>v instanceof Map, set=(v:unknown)=>v instanceof Set, array=Array.isArray;
const words=(v:unknown)=>v instanceof Uint32Array&&v.length===8;
function letterbox(v:unknown){return object(v)&&['x','y','w','h','scale'].every(k=>finite(v[k]))&&Number(v.w)>0&&Number(v.h)>0&&Number(v.scale)>0;}
export function validateSavestate(s:Savestate):void {
 requireState(object(s));
 fields(s.services,{ticks:integer,rng:v=>integer(v)&&Number(v)<=0xffffffff,audioQueued:v=>finite(v)&&Number(v)>=0,storage:map});
 for(const [k,v] of s.services.storage)requireState(typeof k==='string'&&v instanceof Uint8Array);
 fields(s.vfs,{open:map,nextHandle:integer,missing:set,ranges:map,consumedBytes:integer,observedBytes:integer,readAheadBytes:integer,readAheadRequests:integer,aheadRanges:map});
 for(const [h,f] of s.vfs.open)requireState(integer(h)&&object(f)&&typeof f.path==='string'&&(f.data===null||f.data instanceof Uint8Array)&&integer(f.size)&&integer(f.pos)&&f.pos<=f.size);
 for(const ranges of [s.vfs.ranges,s.vfs.aheadRanges])for(const [k,r] of ranges)requireState(typeof k==='string'&&object(r)&&typeof r.path==='string'&&integer(r.offset)&&integer(r.length));
 for(const path of s.vfs.missing)requireState(typeof path==='string');
 fields(s.input,{keysHeld:words,keysLatched:words,keyButtons:map,sources:object,latchedPress:integer,prevButtons:integer,pointer:object,touches:map,events:integer,axes:array,testPads:map,gamepads:array,prevPad:integer,letterbox,logicalW:integer,logicalH:integer,dpr:finite});
 requireState(s.input.axes.length===4&&s.input.axes.every(finite));
 requireState(object(s.host)&&object(s.host.data)&&object(s.host.requests)&&object(s.host.wasm));
 requireState(s.host.requests.entries instanceof Map&&integer(s.host.requests.epoch)&&integer(s.host.requests.bytes)&&integer(s.host.requests.next));
 requireState(s.host.data.textures?.entries instanceof Map&&s.host.data.codeCoverage instanceof Map);
 const wasm=s.host.wasm,m=wasm.memory;
 requireState(object(m)&&integer(m.byteLength)&&m.byteLength%65536===0&&m.pages instanceof Map&&array(wasm.globals)&&array(wasm.tables));
 for(const [at,b] of m.pages)requireState(integer(at)&&at%65536===0&&at+65536<=m.byteLength&&b instanceof Uint8Array&&b.length===65536);
 for(const g of wasm.globals)requireState(typeof g==='number'||typeof g==='bigint'||object(g)&&(typeof g.bits==='number'||typeof g.bits==='bigint'));
 for(const table of wasm.tables)requireState(array(table)&&table.every(i=>i===null||integer(i)));
 requireState(array(s.journal));
 const frame=(v:unknown)=>{requireState(object(v)&&array(v.items)&&integer(v.update)&&integer(v.width)&&integer(v.height)&&letterbox(v.letterbox)&&(v.vertices instanceof Uint8Array||typeof v.vertices==='string'));requireState(typeof v.vertices==='string'||v.vertices.length%20===0);};
 for(const f of s.journal)frame(f);
 if(s.gpuBase!==null){requireState(object(s.gpuBase)&&object(s.gpuBase.surfaces));frame(s.gpuBase.frame);requireState(array(s.gpuBase.surfaces.buffers)&&array(s.gpuBase.surfaces.textures)&&object(s.gpuBase.surfaces.physical));}
}
