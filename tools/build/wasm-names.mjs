// Read only the standard wasm function-name subsection; no engine/module compilation or full IR allocation.
export function stripDwarf(bytes) {
  let p=8;const parts=[bytes.subarray(0,8)];
  const uleb=()=>{let n=0,s=0;for(let i=0;i<5;i++){if(p>=bytes.length)throw new Error('truncated wasm metadata');const b=bytes[p++];n+=(b&127)*2**s;if(!(b&128))return n;s+=7;}throw new Error('oversized wasm metadata');};
  while(p<bytes.length){const begin=p,id=bytes[p++],size=uleb(),end=p+size;if(end>bytes.length)throw new Error('truncated wasm section');
    let discard=false;
    if(id===0){const n=uleb();if(p+n>end)throw new Error('truncated custom section');discard=Buffer.from(bytes.subarray(p,p+n)).toString('utf8').startsWith('.debug_');}
    if(!discard)parts.push(bytes.subarray(begin,end));p=end;
  }
  return Buffer.concat(parts);
}
export function encodeFunctionNames(names) {
  const leb=n=>{const b=[];do{let v=n%128;n=Math.floor(n/128);if(n)v|=128;b.push(v);}while(n);return Buffer.from(b);};
  const string=s=>{const b=Buffer.from(s);return Buffer.concat([leb(b.length),b]);};
  const payload=Buffer.concat([leb(names.length),...names.flatMap(n=>[leb(n.index),string(n.name)])]);
  const body=Buffer.concat([string('name'),Buffer.from([1]),leb(payload.length),payload]);
  return Buffer.concat([Buffer.from([0]),leb(body.length),body]);
}
export function functionNames(bytes) {
  const names=[];let p=8;
  const uleb=(end)=>{let n=0,shift=0;for(let i=0;i<5;i++){if(p>=end)throw new Error('truncated wasm name metadata');const b=bytes[p++];n+=(b&127)*2**shift;if(!(b&128))return n;shift+=7;}throw new Error('oversized wasm metadata integer');};
  const str=(end)=>{const n=uleb(end);if(p+n>end)throw new Error('truncated wasm name');const s=Buffer.from(bytes.subarray(p,p+n)).toString('utf8');p+=n;return s;};
  while(p<bytes.length) {
    const id=bytes[p++],size=uleb(bytes.length),end=p+size;if(end>bytes.length)throw new Error('truncated wasm section');
    if(id===0 && str(end)==='name') {
      while(p<end){const sub=bytes[p++],n=uleb(end),stop=p+n;if(stop>end)throw new Error('truncated name subsection');
        if(sub===1){const count=uleb(stop);for(let i=0;i<count;i++){const index=uleb(stop);names.push({index,name:str(stop)});}}
        p=stop;
      }
    }
    p=end;
  }
  return names;
}
