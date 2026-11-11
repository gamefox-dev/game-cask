// Avoid Chromium's ~2 GiB structured-clone serialization envelope for aggregate states.
// Copy backing buffers individually, retaining aliases/views, with no serialized intermediate.
export function cloneCheckpoint<T>(value:T):T {
  const seen=new Map<object,unknown>();
  function clone(v:unknown):unknown {
    if(!v||typeof v!=='object')return typeof v==='function'?structuredClone(v):v;
    if(seen.has(v))return seen.get(v);
    if(v instanceof ArrayBuffer){const b=v.slice(0);seen.set(v,b);return b;}
    if(v instanceof Uint8Array || v instanceof Uint32Array){
      const buffer=clone(v.buffer) as ArrayBuffer;
      const b=v instanceof Uint8Array?new Uint8Array(buffer,v.byteOffset,v.length):new Uint32Array(buffer,v.byteOffset,v.length);
      seen.set(v,b);return b;
    }
    if(v instanceof Map){const out=new Map();seen.set(v,out);for(const [k,x] of v)out.set(clone(k),clone(x));return out;}
    if(v instanceof Set){const out=new Set();seen.set(v,out);for(const x of v)out.add(clone(x));return out;}
    if(Array.isArray(v)){const out:unknown[]=[];seen.set(v,out);for(const x of v)out.push(clone(x));return out;}
    if(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null){
      const out:Record<string,unknown>={};seen.set(v,out);
      for(const k of Object.keys(v))Object.defineProperty(out,k,{value:clone((v as Record<string,unknown>)[k]),writable:true,enumerable:true,configurable:true});return out;
    }
    const out=structuredClone(v);seen.set(v,out);return out;
  }
  return clone(value) as T;
}
