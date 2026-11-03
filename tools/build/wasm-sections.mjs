// Bounded, non-IR wasm section access. Only MVP function bodies are substituted; no instruction rewriting.
export function uleb(n) {const b=[];do{let v=n%128;n=Math.floor(n/128);if(n)v|=128;b.push(v);}while(n);return Buffer.from(b);}
export function reader(bytes) {
 let p=0; return {get position(){return p;}, set position(v){p=v;},
 byte(){if(p>=bytes.length)throw new Error('truncated wasm');return bytes[p++];},
 uint(){let n=0,s=0;for(let i=0;i<5;i++){if(p>=bytes.length)throw new Error('truncated wasm integer');const b=bytes[p++];n+=(b&127)*2**s;if(!(b&128)){if(n>0xffffffff)throw new Error('oversized wasm integer');return n;}s+=7;}throw new Error('oversized wasm integer');},
 take(n){if(n<0||p+n>bytes.length)throw new Error('truncated wasm payload');const b=bytes.subarray(p,p+n);p+=n;return b;},
 done(){return p===bytes.length;}};
}
export function sections(bytes) {
 const r=reader(bytes);if(!r.take(8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw new Error('invalid wasm header');
 const out=[];while(!r.done()){const id=r.byte(),data=r.take(r.uint());out.push({id,data});}return out;
}
export function encodeSections(list) {return Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0]),...list.flatMap(({id,data})=>[Buffer.from([id]),uleb(data.length),data])]);}
export function codeBodies(data) {const r=reader(data),n=r.uint(),out=[];for(let i=0;i<n;i++)out.push(r.take(r.uint()));if(!r.done())throw new Error('trailing wasm code');return out;}
export function codeSection(bodies) {return Buffer.concat([uleb(bodies.length),...bodies.flatMap(b=>[uleb(b.length),b])]);}
